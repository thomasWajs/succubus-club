import { PermanentId, RoomId, SerializedGameState } from '@/shared/types/multiplayer.ts'
import { AnyGameMutation } from '@/shared/state/gameMutations.ts'

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
    roomId: RoomId
}

export type GameMutationMessage = {
    type: 'gameMutation'
    roomId: RoomId
    mutation: AnyGameMutation
}

export type ChatMessage = {
    type: 'chat'
    roomId: RoomId
    text: string
}

export type RequestStateMessage = {
    type: 'requestState'
    roomId: RoomId
}

export type ClientMessage =
    | PublishMessage
    | JoinRoomMessage
    | LeaveRoomMessage
    | GameMutationMessage
    | ChatMessage
    | RequestStateMessage

// Server → Client messages
export type RoomStateMessage = {
    type: 'roomState'
    roomId: RoomId
    players: Array<{ userId: PermanentId; userName: string }>
    isStarted: boolean
}

export type GameStateMessage = {
    type: 'gameState'
    roomId: RoomId
    state: SerializedGameState
}

export type MutationBroadcast = {
    type: 'mutation'
    roomId: RoomId
    mutation: AnyGameMutation
}

export type ChatBroadcast = {
    type: 'chatMessage'
    roomId: RoomId
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

/**
 * Internal server types
 */
export type ConnectionInfo = {
    userId: PermanentId
    userName: string
    roomId: RoomId | null
}
