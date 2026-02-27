import Database from 'better-sqlite3'
import { RoomId } from '@/shared/types/multiplayer.ts'
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
function initTables() {
    // Rooms table
    db.exec(`
        CREATE TABLE IF NOT EXISTS rooms (
            id TEXT PRIMARY KEY,
            name TEXT,
            host_id TEXT,
            is_started INTEGER DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )
    `)

    // Game states table (snapshots)
    db.exec(`
        CREATE TABLE IF NOT EXISTS game_states (
            room_id TEXT PRIMARY KEY,
            state_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
        )
    `)

    // Mutations log table
    db.exec(`
        CREATE TABLE IF NOT EXISTS mutations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id TEXT NOT NULL,
            mutation_id TEXT NOT NULL,
            mutation_json TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
        )
    `)

    // Index for faster queries
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_mutations_room
        ON mutations(room_id, timestamp)
    `)

    // Cleanup old rooms (older than 7 days)
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    db.prepare('DELETE FROM rooms WHERE updated_at < ?').run(sevenDaysAgo)

    console.log('Database tables initialized')
}

initTables()

/**
 * Save room metadata
 */
export function saveRoom(roomId: RoomId, name: string, hostId: string, isStarted: boolean): void {
    const now = Date.now()
    const stmt = db.prepare(`
        INSERT INTO rooms (id, name, host_id, is_started, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            host_id = excluded.host_id,
            is_started = excluded.is_started,
            updated_at = excluded.updated_at
    `)

    stmt.run(roomId, name, hostId, isStarted ? 1 : 0, now, now)
    console.log(`Saved room: ${roomId}`)
}

/**
 * Load room metadata
 */
export function loadRoom(roomId: RoomId): any | null {
    const stmt = db.prepare('SELECT * FROM rooms WHERE id = ?')
    const row = stmt.get(roomId)
    return row || null
}

/**
 * Delete room
 */
export function deleteRoom(roomId: RoomId): void {
    db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId)
    console.log(`🗑Deleted room from DB: ${roomId}`)
}

/**
 * Save game state snapshot
 */
export function saveGameState(roomId: RoomId, state: GameState): void {
    const now = Date.now()
    const stateJson = JSON.stringify(state)

    const stmt = db.prepare(`
        INSERT INTO game_states (room_id, state_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(room_id) DO UPDATE SET
            state_json = excluded.state_json,
            updated_at = excluded.updated_at
    `)

    stmt.run(roomId, stateJson, now)
    console.log(`Saved game state for room: ${roomId}`)
}

/**
 * Load game state snapshot
 */
export function loadGameState(roomId: RoomId): GameState | null {
    const stmt = db.prepare('SELECT state_json FROM game_states WHERE room_id = ?')
    const row = stmt.get(roomId) as { state_json: string } | undefined

    if (!row) {
        return null
    }

    try {
        return JSON.parse(row.state_json)
    } catch (error) {
        console.error(`Failed to parse game state for room ${roomId}:`, error)
        return null
    }
}

/**
 * Save mutation to log
 */
export function saveMutation(roomId: RoomId, mutationId: string, mutationJson: string): void {
    const now = Date.now()
    const stmt = db.prepare(`
        INSERT INTO mutations (room_id, mutation_id, mutation_json, timestamp)
        VALUES (?, ?, ?, ?)
    `)

    stmt.run(roomId, mutationId, mutationJson, now)
}

/**
 * Get recent mutations for a room
 */
export function getRecentMutations(roomId: RoomId, limit: number = 100): any[] {
    const stmt = db.prepare(`
        SELECT mutation_json, timestamp
        FROM mutations
        WHERE room_id = ?
        ORDER BY timestamp DESC
        LIMIT ?
    `)

    const rows = stmt.all(roomId, limit) as Array<{ mutation_json: string; timestamp: number }>

    return rows
        .map(row => {
            try {
                return JSON.parse(row.mutation_json)
            } catch (error) {
                console.error('Failed to parse mutation:', error)
                return null
            }
        })
        .filter(m => m !== null)
}

/**
 * Close database connection (on shutdown)
 */
export function closeDatabase(): void {
    db.close()
    console.log('Database connection closed')
}
