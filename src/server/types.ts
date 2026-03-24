import { PermanentId, RoomId, Seating, UserDecks } from '@/shared/types/multiplayer.ts'
import { WebSocket } from 'ws'
import { GameId } from '@/shared/types/model.ts'

export type ClientId = string

/**
 * One client connection through websocket
 */
export type ConnectionInfo = {
    clientId: ClientId
    webSocket: WebSocket
    permId: PermanentId
    roomId: RoomId | null
}

/**
 * Room structure
 */
export type Room = {
    id: RoomId
    passwordHash: string // empty string == no password
    userDecks: UserDecks
    players: Set<PermanentId>
    seating: Seating
    gameId: GameId | null
}
/**
 * Rate limiting: Track mutations per player
 */
export type RateLimitInfo = {
    count: number
    windowStart: number
}
