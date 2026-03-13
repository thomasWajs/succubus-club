import Database from 'better-sqlite3'
import { Room } from './types.ts'
import { RoomId, Seating } from '@/shared/types/multiplayer.ts'
import { GameId } from '@/shared/types/model.ts'
import { GameState } from '@/shared/state/gameState.ts'

const DB_PATH = process.env.DB_PATH || './game-server.db'

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
        password_hash TEXT NOT NULL,
        seating TEXT NOT NULL,
        game_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    )
`)

    db.exec(`
    CREATE TABLE IF NOT EXISTS game_states (
        game_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    )
`)

    console.log('Database tables initialized')

    // Cleanup old data (older than 24 hours)
    const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000

    try {
        const deleteOldRooms = db.prepare('DELETE FROM rooms WHERE updated_at < ?')
        const deletedRooms = deleteOldRooms.run(twentyFourHoursAgo)

        const deleteOldGameStates = db.prepare('DELETE FROM game_states WHERE updated_at < ?')
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
            INSERT INTO rooms (id, password_hash, seating, game_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                password_hash = excluded.password_hash,
                seating = excluded.seating,
                game_id = excluded.game_id,
                updated_at = excluded.updated_at
        `)
        stmt.run(room.id, room.passwordHash, JSON.stringify(room.seating), room.gameId, now, now)
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
            passwordHash: row.password_hash,
            seating: JSON.parse(row.seating) as Seating,
            gameId: row.game_id,
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
            passwordHash: row.password_hash,
            seating: JSON.parse(row.seating) as Seating,
            gameId: row.game_id,
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
            INSERT INTO game_states (game_id, state, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(game_id) DO UPDATE SET
                state = excluded.state,
                updated_at = excluded.updated_at
        `)
        stmt.run(gameState.gameId, JSON.stringify(gameState), now, now)
    } catch (error) {
        console.error('Error saving game state:', error)
    }
}

export function loadGameState(gameId: GameId): GameState | undefined {
    try {
        const stmt = db.prepare('SELECT state FROM game_states WHERE game_id = ?')
        const row = stmt.get(gameId) as any
        if (!row) {
            return undefined
        }

        return Object.assign(new GameState(), JSON.parse(row.state))
    } catch (error) {
        console.error('Error loading game state:', error)
        return undefined
    }
}

export function loadAllGameStates(): GameState[] {
    try {
        const stmt = db.prepare('SELECT state FROM game_states')
        const rows = stmt.all() as any[]

        return rows.map(row => Object.assign(new GameState(), JSON.parse(row.state)))
    } catch (error) {
        console.error('Error loading all game states:', error)
        return []
    }
}

export function deleteGameState(gameId: GameId): void {
    try {
        const stmt = db.prepare('DELETE FROM game_states WHERE game_id = ?')
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
