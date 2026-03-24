import Database from 'better-sqlite3'
import { Room } from './types.ts'
import { RoomId, Seating, SerializedGameState, UserDecks } from '@/shared/types/multiplayer.ts'
import { GameId } from '@/shared/types/model.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { deserializeGameState, serializeGameState } from '@/shared/serialization.ts'

const DB_PATH = process.env.DB_PATH || './game-server.db'

type GameStateRow = {
    gameId: string
    state: string
}

/**
 * Initialize SQLite database
 */
const db = new Database(DB_PATH)

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL')

console.log(`Database initialized at: ${DB_PATH}`)

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

    console.log('Database tables initialized')

    // Cleanup old data (older than 24 hours)
    const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000

    try {
        const deleteOldRooms = db.prepare('DELETE FROM rooms WHERE updatedAt < ?')
        const deletedRooms = deleteOldRooms.run(twentyFourHoursAgo)

        const deleteOldGameStates = db.prepare('DELETE FROM game_states WHERE updatedAt < ?')
        const deletedGameStates = deleteOldGameStates.run(twentyFourHoursAgo)

        if (deletedRooms.changes > 0 || deletedGameStates.changes > 0) {
            console.log(
                `Cleaned up ${deletedRooms.changes} old rooms and ${deletedGameStates.changes} old game states`,
            )
        }
    } catch (error) {
        console.error('Error cleaning up old data:', error)
    }
}

/**
 * Room persistence
 */

export function saveRoom(room: Room): void {
    try {
        const now = Date.now()
        const stmt = db.prepare(`
            INSERT INTO rooms (id, passwordHash, userDecks, seating, gameId, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                passwordHash = excluded.passwordHash,
                userDecks = excluded.userDecks,
                seating = excluded.seating,
                gameId = excluded.gameId,
                updatedAt = excluded.updatedAt
        `)
        stmt.run(
            room.id,
            room.passwordHash,
            JSON.stringify(room.userDecks),
            JSON.stringify(room.seating),
            room.gameId,
            now,
            now,
        )
    } catch (error) {
        console.error('Error saving room:', error)
    }
}

export function loadRoom(roomId: RoomId): Room | undefined {
    try {
        const stmt = db.prepare('SELECT * FROM rooms WHERE id = ?')
        const row = stmt.get(roomId) as any
        if (!row) {
            return undefined
        }

        return {
            id: row.id,
            players: new Set(), // Will be repopulated as players reconnect
            passwordHash: row.passwordHash,
            userDecks: JSON.parse(row.userDecks) as UserDecks,
            seating: JSON.parse(row.seating) as Seating,
            gameId: row.gameId,
        }
    } catch (error) {
        console.error('Error loading room:', error)
        return undefined
    }
}

export function loadAllRooms(): Room[] {
    try {
        const stmt = db.prepare('SELECT * FROM rooms')
        const rows = stmt.all() as any[]

        return rows.map(row => ({
            id: row.id,
            players: new Set(), // Will be repopulated as players reconnect
            passwordHash: row.passwordHash,
            userDecks: JSON.parse(row.userDecks) as UserDecks,
            seating: JSON.parse(row.seating) as Seating,
            gameId: row.gameId,
        }))
    } catch (error) {
        console.error('Error loading all rooms:', error)
        return []
    }
}

export function deleteRoom(roomId: RoomId): void {
    try {
        const stmt = db.prepare('DELETE FROM rooms WHERE id = ?')
        stmt.run(roomId)
    } catch (error) {
        console.error('Error deleting room:', error)
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
        console.error('Error saving game state:', error)
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
        console.error('Error loading game state:', error)
        return undefined
    }
}

export function loadAllGameStates(): GameState[] {
    try {
        const stmt = db.prepare('SELECT state FROM game_states')
        const rows = stmt.all() as GameStateRow[]
        return rows.map(gameStateFromRow)
    } catch (error) {
        console.error('Error loading all game states:', error)
        return []
    }
}

export function deleteGameState(gameId: GameId): void {
    try {
        const stmt = db.prepare('DELETE FROM game_states WHERE gameId = ?')
        stmt.run(gameId)
    } catch (error) {
        console.error('Error deleting game state:', error)
    }
}

/**
 * Restore all persisted data
 */
export function loadPersistedData(): { rooms: Room[]; gameStates: GameState[] } {
    console.log('Restoring persisted data...')

    const gameStates = loadAllGameStates()
    const rooms = loadAllRooms()

    console.log(`Restored ${rooms.length} rooms and ${gameStates.length} game states`)

    return { rooms, gameStates }
}
