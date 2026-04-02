import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { captureException } from './logging.ts'
import logger from './logger.ts'
import { Room } from './types.ts'
import {
    RoomId,
    Seating,
    SerializedGameState,
    UserDecks,
    VectorClockVersion,
    VersioningId,
} from '@/shared/types/multiplayer.ts'
import { GameId } from '@/shared/types/model.ts'
import { GameState } from '@/shared/state/gameState.ts'
import {
    deserializeGameState,
    deserializeHistory,
    serializeGameState,
    serializeHistory,
} from '@/shared/serialization.ts'
import { LamportClock, VectorClock } from '@/shared/multiplayer/clock.ts'
import { HistoryStore } from '@/shared/state/history.ts'

const DB_PATH = process.env.SCS_DB_PATH || '../../data/game-server.db'

type RoomRow = {
    id: string
    passwordHash: string
    userDecks: string
    seating: string
    gameId: string
    globalClock: string
    objectClocks: string
    history: string
}

type GameStateRow = {
    gameId: string
    state: string
}

/**
 * Initialize SQLite database
 */
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
const db = new Database(DB_PATH)

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL')

/**
 * Create tables if they don't exist
 */
export function initTables() {
    db.exec(`
    CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        passwordHash TEXT NOT NULL,
        userDecks TEXT NOT NULL,
        seating TEXT NOT NULL,
        gameId TEXT,
        globalClock TEXT NOT NULL,
        objectClocks TEXT NOT NULL,
        history TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
    )
`)

    db.exec(`
    CREATE TABLE IF NOT EXISTS game_states (
        gameId TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
    )
`)

    logger.info('Database tables initialized')

    // Cleanup old data (older than 12 hours)
    const twentyFourHoursAgo = Date.now() - 12 * 60 * 60 * 1000

    try {
        const deleteOldRooms = db.prepare('DELETE FROM rooms WHERE updatedAt < ?')
        const deletedRooms = deleteOldRooms.run(twentyFourHoursAgo)

        const deleteOldGameStates = db.prepare('DELETE FROM game_states WHERE updatedAt < ?')
        const deletedGameStates = deleteOldGameStates.run(twentyFourHoursAgo)

        if (deletedRooms.changes > 0 || deletedGameStates.changes > 0) {
            logger.info(
                `Cleaned up ${deletedRooms.changes} old rooms and ${deletedGameStates.changes} old game states`,
            )
        }
    } catch (error) {
        captureException(error)
    }
}

/**
 * Room persistence
 */

export function saveRoom(room: Room): void {
    try {
        const now = Date.now()
        const stmt = db.prepare(`
            INSERT INTO rooms (id, passwordHash, userDecks, seating, gameId, globalClock, objectClocks, history, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                passwordHash = excluded.passwordHash,
                userDecks = excluded.userDecks,
                seating = excluded.seating,
                gameId = excluded.gameId,
                globalClock = excluded.globalClock,
                objectClocks = excluded.objectClocks,
                history = excluded.history,
                updatedAt = excluded.updatedAt
        `)
        stmt.run(
            room.id,
            room.passwordHash,
            JSON.stringify(room.userDecks),
            JSON.stringify(room.seating),
            room.gameId,
            JSON.stringify(room.globalClock),
            JSON.stringify(room.objectClocks),
            JSON.stringify(serializeHistory(room.history, true)),
            now,
            now,
        )
    } catch (error) {
        captureException(error)
    }
}

function loadRoomRow(row: RoomRow): Room {
    const globalClockData = JSON.parse(row.globalClock)
    const globalClock = new LamportClock(globalClockData.permId, globalClockData.tick)

    const objectClocksData: Record<VersioningId, VectorClockVersion> = JSON.parse(row.objectClocks)
    const objectClocks = Object.fromEntries(
        Object.entries(objectClocksData).map(([k, v]) => [k, new VectorClock(v)]),
    )

    const history = new HistoryStore()
    deserializeHistory(row.gameId, JSON.parse(row.history), history)

    return {
        id: row.id,
        players: new Set(), // Will be repopulated as players reconnect
        passwordHash: row.passwordHash,
        userDecks: JSON.parse(row.userDecks) as UserDecks,
        seating: JSON.parse(row.seating) as Seating,
        gameId: row.gameId,
        globalClock,
        objectClocks,
        history,
    }
}

export function loadRoom(roomId: RoomId): Room | undefined {
    try {
        const stmt = db.prepare('SELECT * FROM rooms WHERE id = ?')
        const row = stmt.get(roomId) as RoomRow
        if (!row) {
            return undefined
        }
        return loadRoomRow(row)
    } catch (error) {
        captureException(error)
        return undefined
    }
}

export function loadAllRooms(): Room[] {
    try {
        const stmt = db.prepare('SELECT * FROM rooms')
        const rows = stmt.all() as any[]
        return rows.map(loadRoomRow)
    } catch (error) {
        captureException(error)
        return []
    }
}

export function deleteRoom(roomId: RoomId): void {
    try {
        const stmt = db.prepare('DELETE FROM rooms WHERE id = ?')
        stmt.run(roomId)
    } catch (error) {
        captureException(error)
    }
}

/**
 * GameState persistence
 */

export function saveGameState(gameState: GameState): void {
    try {
        const now = Date.now()
        const stmt = db.prepare(`
            INSERT INTO game_states (gameId, state, createdAt, updatedAt)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(gameId) DO UPDATE SET
                state = excluded.state,
                updatedAt = excluded.updatedAt
        `)
        const serializedGameState = serializeGameState(gameState)
        stmt.run(gameState.gameId, JSON.stringify(serializedGameState), now, now)
    } catch (error) {
        captureException(error)
    }
}

function gameStateFromRow(row: GameStateRow) {
    const serializedGameState = JSON.parse(row.state) as SerializedGameState
    const gameState = new GameState()
    deserializeGameState(serializedGameState, gameState)
    return gameState
}

export function loadGameState(gameId: GameId): GameState | undefined {
    try {
        const stmt = db.prepare('SELECT state FROM game_states WHERE gameId = ?')
        const row = stmt.get(gameId) as GameStateRow
        if (!row) {
            return undefined
        }

        return gameStateFromRow(row)
    } catch (error) {
        captureException(error)
        return undefined
    }
}

export function loadAllGameStates(): GameState[] {
    try {
        const stmt = db.prepare('SELECT state FROM game_states')
        const rows = stmt.all() as GameStateRow[]
        return rows.map(gameStateFromRow)
    } catch (error) {
        captureException(error)
        return []
    }
}

export function deleteGameState(gameId: GameId): void {
    try {
        const stmt = db.prepare('DELETE FROM game_states WHERE gameId = ?')
        stmt.run(gameId)
    } catch (error) {
        captureException(error)
    }
}

/**
 * Restore all persisted data
 */
export function loadPersistedData(): { rooms: Room[]; gameStates: GameState[] } {
    const gameStates = loadAllGameStates()
    const rooms = loadAllRooms()

    logger.info(`Restored ${rooms.length} rooms and ${gameStates.length} game states`)

    return { rooms, gameStates }
}
