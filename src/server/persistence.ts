import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { captureException } from './capture.ts'
import logger from './logger.ts'
import { Room } from './types.ts'
import {
    RoomId,
    RoomSeats,
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
    hostId: string
    userDecks: string
    seats: string
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
 * Initialize SQLite database (single, long-lived connection)
 */
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
const db = new Database(DB_PATH)

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL')

logger.info(`Database initialized at: ${DB_PATH}`)

/**
 * Close the database connection, checkpointing the WAL cleanly.
 * Call once on graceful shutdown.
 */
export function closeDb(): void {
    db.close()
}

/**
 * Cleanup old tables & rooms
 */

export function cleanupOldGames() {
    try {
        const twoWeeksAgo = Date.now() - TWO_WEEKS

        const deleteOldRooms = db.prepare('DELETE FROM rooms WHERE updatedAt < ?')
        const deletedRooms = deleteOldRooms.run(twoWeeksAgo)

        if (deletedRooms.changes > 0) {
            logger.info(`Cleaned up ${deletedRooms.changes} old rooms`)
        }

        const deleteExpired = db.prepare('DELETE FROM bans WHERE bannedUntil <= ?')
        const deletedBans = deleteExpired.run(Date.now())
        if (deletedBans.changes > 0) {
            logger.info(`Cleaned up ${deletedBans.changes} expired bans`)
        }
    } catch (error) {
        captureException(error)
    }
}

/**
 * Create tables if they don't exist
 */
export function initTables() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS rooms (
            id TEXT PRIMARY KEY,
            passwordHash TEXT NOT NULL,
            hostId TEXT NOT NULL,
            userDecks TEXT NOT NULL,
            seats TEXT NOT NULL,
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

    db.exec(`
        CREATE TABLE IF NOT EXISTS bans (
            ip TEXT PRIMARY KEY,
            bannedUntil INTEGER NOT NULL
        )
    `)

    cleanupOldGames()

    logger.info('Database tables initialized')
}

/**
 * Room persistence
 */

export function hasRoom(id: string): boolean {
    try {
        const stmt = db.prepare('SELECT 1 FROM rooms WHERE id = ?')
        const row = stmt.get(id)
        return !!row
    } catch (error) {
        captureException(error)
        return false
    }
}

export function saveRoom(room: Room): void {
    try {
        const now = Date.now()
        const stmt = db.prepare(`
                INSERT INTO rooms (id, passwordHash, hostId, userDecks, seats, seating, gameId, globalClock, objectClocks, gameState, history, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    passwordHash = excluded.passwordHash,
                    hostId = excluded.hostId,
                    userDecks = excluded.userDecks,
                    seats = excluded.seats,
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
            room.hostId,
            JSON.stringify(room.userDecks),
            JSON.stringify(room.seats),
            JSON.stringify(room.seating),
            room.gameId,
            JSON.stringify(room.globalClock),
            JSON.stringify(room.objectClocks),
            serializedGameState,
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

    const serializedGameState = JSON.parse(row.gameState) as SerializedGameState
    const gameState = new GameState()
    deserializeGameState(serializedGameState, gameState)

    const history = new HistoryStore()
    deserializeHistory(row.gameId, JSON.parse(row.history), history)

    return {
        id: row.id,
        players: new Set(), // Will be repopulated as players reconnect
        passwordHash: row.passwordHash,
        hostId: row.hostId,
        userDecks: JSON.parse(row.userDecks) as UserDecks,
        seats: JSON.parse(row.seats) as RoomSeats,
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

export function loadRecentRooms(): Room[] {
    try {
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
 * Ban persistence
 */

export type BanRecord = {
    ip: string
    bannedUntil: number
}

export function saveBan(ip: string, bannedUntil: number): void {
    try {
        const stmt = db.prepare(`
            INSERT INTO bans (ip, bannedUntil)
            VALUES (?, ?)
            ON CONFLICT(ip) DO UPDATE SET bannedUntil = excluded.bannedUntil
        `)
        stmt.run(ip, bannedUntil)
    } catch (error) {
        captureException(error)
    }
}

/**
 * Load bans that are still active (not yet expired).
 */
export function loadActiveBans(): BanRecord[] {
    try {
        const stmt = db.prepare('SELECT ip, bannedUntil FROM bans WHERE bannedUntil > ?')
        return stmt.all(Date.now()) as BanRecord[]
    } catch (error) {
        captureException(error)
        return []
    }
}

/**
 * Restore recent persisted data
 */

export function loadPersistedData(): { rooms: Room[]; bans: BanRecord[] } {
    const rooms = loadRecentRooms()
    const bans = loadActiveBans()
    return { rooms, bans }
}
