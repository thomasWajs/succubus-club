import {
    PermanentId,
    RoomId,
    RoomSeats,
    Seating,
    UserDecks,
    VersioningId,
} from '@/shared/types/multiplayer.ts'
import { WebSocket } from 'ws'
import { GameId } from '@/shared/types/model.ts'
import { LamportClock, VectorClock } from '@/shared/multiplayer/clock.ts'
import { HistoryStore } from '@/shared/state/history.ts'
import { GameState } from '@/shared/state/gameState.ts'

export const SERVER_PERM_ID = '0000_SCS'

export type ClientId = string

/**
 * One client connection through websocket
 */
export type ConnectionInfo = {
    clientId: ClientId
    webSocket: WebSocket
    remoteAddress: string
    permId: PermanentId
    roomId: RoomId | null
}

/**
 * Room structure
 */
export type Room = {
    id: RoomId
    passwordHash: string // empty string == no password
    hostId: PermanentId // The user who created the room, and the only one allowed to launch
    userDecks: UserDecks
    players: Set<PermanentId> // Currently connected users, whatever their seat
    seats: RoomSeats // permId -> seat, declared by the host when launching
    seating: Seating
    gameId: GameId | null
    globalClock: LamportClock
    objectClocks: Record<VersioningId, VectorClock>
    gameState: GameState | null
    history: HistoryStore
    isSavedGame: boolean
}

export type StartedRoom = Room & {
    gameId: GameId
    gameState: GameState
}

/**
 * Rate limiting: Track mutations per player
 */
export type RateLimitInfo = {
    count: number
    windowStart: number
}
