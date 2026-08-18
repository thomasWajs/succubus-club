import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { captureException } from './capture.ts'
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
    gameState: string
    history: string
}

const ONE_HOUR = 60 * 60 * 1000
const ONE_DAY = 24 * ONE_HOUR
const TWO_WEEKS = 14 * ONE_DAY

/**
 * Open the database, run a callback, then close it immediately.
 * This prevents a persistent open connection that would keep Railway awake.
 */
function withDb<T>(fn: (db: Database.Database) => T): T {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
    const db = new Database(DB_PATH)
    // WAL mode: better concurrency, and WAL checkpoint flushes are isolated to this call
    db.pragma('journal_mode = WAL')
    try {
        return fn(db)
    } finally {
        db.close()
    }
}

/**
 * Cleanup old tables & rooms
 */

export function cleanupOldGames() {
    try {
        withDb(db => {
            const twoWeeksAgo = Date.now() - TWO_WEEKS

            const deleteOldRooms = db.prepare('DELETE FROM rooms WHERE updatedAt < ?')
            const deletedRooms = deleteOldRooms.run(twoWeeksAgo)

            if (deletedRooms.changes > 0) {
                logger.info(`Cleaned up ${deletedRooms.changes} old rooms`)
            }
        })
    } catch (error) {
        captureException(error)
    }
}

/**
 * Create tables if they don't exist
 */
export function initTables() {
    withDb(db => {
        db.exec(`
        CREATE TABLE IF NOT EXISTS rooms (
            id TEXT PRIMARY KEY,
            passwordHash TEXT NOT NULL,
            userDecks TEXT NOT NULL,
            seating TEXT NOT NULL,
            gameId TEXT,
            globalClock TEXT NOT NULL,
            objectClocks TEXT NOT NULL,
            gameState TEXT,
            history TEXT NOT NULL,
            createdAt INTEGER NOT NULL,
            updatedAt INTEGER NOT NULL
        )
    `)
    })

    cleanupOldGames()

    logger.info('Database tables initialized')
}

/**
 * Room persistence
 */

export function hasRoom(id: string): boolean {
    try {
        return withDb(db => {
            const stmt = db.prepare('SELECT 1 FROM rooms WHERE id = ?')
            const row = stmt.get(id)
            return !!row
        })
    } catch (error) {
        captureException(error)
        return false
    }
}

export function saveRoom(room: Room): void {
    try {
        withDb(db => {
            const now = Date.now()
            const stmt = db.prepare(`
                INSERT INTO rooms (id, passwordHash, userDecks, seating, gameId, globalClock, objectClocks, gameState, history, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    passwordHash = excluded.passwordHash,
                    userDecks = excluded.userDecks,
                    seating = excluded.seating,
                    gameId = excluded.gameId,
                    globalClock = excluded.globalClock,
                    objectClocks = excluded.objectClocks,
                    gameState = excluded.gameState,
                    history = excluded.history,
                    updatedAt = excluded.updatedAt
            `)
            const serializedGameState =
                room.gameState ? JSON.stringify(serializeGameState(room.gameState)) : null
            stmt.run(
                room.id,
                room.passwordHash,
                JSON.stringify(room.userDecks),
                JSON.stringify(room.seating),
                room.gameId,
                JSON.stringify(room.globalClock),
                JSON.stringify(room.objectClocks),
                serializedGameState,
                JSON.stringify(serializeHistory(room.history, true)),
                now,
                now,
            )
        })
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

    const serializedGameState = JSON.parse(row.gameState) as SerializedGameState
    const gameState = new GameState()
    deserializeGameState(serializedGameState, gameState)

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
        gameState,
        history,
        isSavedGame: false,
    }
}

export function loadRoom(roomId: RoomId): Room | undefined {
    try {
        return withDb(db => {
            const stmt = db.prepare('SELECT * FROM rooms WHERE id = ?')
            const row = stmt.get(roomId) as RoomRow
            if (!row) {
                return undefined
            }
            return loadRoomRow(row)
        })
    } catch (error) {
        captureException(error)
        return undefined
    }
}

export function loadRecentRooms(): Room[] {
    try {
        return withDb(db => {
            const sixHoursAgo = Date.now() - 6 * ONE_HOUR
            const stmt = db.prepare('SELECT * FROM rooms WHERE updatedAt >= ?')
            const rows = stmt.all(sixHoursAgo) as RoomRow[]

            const validRooms: Room[] = []
            for (const row of rows) {
                try {
                    validRooms.push(loadRoomRow(row))
                } catch (error) {
                    logger.warn(`Failed to load room ${row.id}, skipping...`)
                    captureException(error)
                }
            }

            return validRooms
        })
    } catch (error) {
        captureException(error)
        return []
    }
}

export function deleteRoom(roomId: RoomId): void {
    try {
        withDb(db => {
            const stmt = db.prepare('DELETE FROM rooms WHERE id = ?')
            stmt.run(roomId)
        })
    } catch (error) {
        captureException(error)
    }
}

/**
 * Restore recent persisted data
 */
export function loadPersistedData(): { rooms: Room[] } {
    const rooms = loadRecentRooms()
    return { rooms }
}
