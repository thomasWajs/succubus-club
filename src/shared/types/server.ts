import { PermanentId, RoomId, SerializedGameState } from '@/shared/types/multiplayer.ts'

/**
 * WebSocket Message Types
 * These define the protocol between client and server
 */

export type PublishMessage = {
    type: 'publish'
}

// Client → Server messages
export type JoinRoomMessage = {
    type: 'joinRoom'
    roomId: RoomId
    userId: PermanentId
    userName: string
}

export type LeaveRoomMessage = {
    type: 'leaveRoom'
}

export type GameMutationMessage = {
    type: 'mutation'
    // mutation: AnyGameMutation
    mutation: string
}

export type RequestStateMessage = {
    type: 'requestState'
}

export type ClientMessage =
    | PublishMessage
    | JoinRoomMessage
    | LeaveRoomMessage
    | GameMutationMessage
    | RequestStateMessage

// Server → Client messages
export type RoomStateMessage = {
    type: 'roomState'
    players: Array<{ userId: PermanentId; userName: string }>
    isStarted: boolean
}

export type GameStateMessage = {
    type: 'gameState'
    state: SerializedGameState
}

export type MutationBroadcast = {
    type: 'mutation'
    // mutation: AnyGameMutation
    mutation: string
}

export type ChatBroadcast = {
    type: 'chatMessage'
    userId: PermanentId
    userName: string
    text: string
    timestamp: Date
}

export type ErrorMessage = {
    type: 'error'
    message: string
}

export type ServerMessage =
    | PublishMessage
    | RoomStateMessage
    | GameStateMessage
    | MutationBroadcast
    | ChatBroadcast
    | ErrorMessage
