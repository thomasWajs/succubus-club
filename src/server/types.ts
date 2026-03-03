import { PermanentId, RoomId, Seating } from '@/shared/types/multiplayer.ts'
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
 * One client connection through websocket
 */
/*
export type ScsUser = {
    permId: PermanentId
    name: string
    isReady: boolean
    deckList: DeckList | null
}
 */

/**
 * Room structure
 */
export type Room = {
    id: RoomId
    players: Set<PermanentId>
    passwordHash: string // empty string == no password
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
