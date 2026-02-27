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
}

export type GameMutationMessage = {
    type: 'gameMutation'
    mutation: AnyGameMutation
}

export type ChatMessage = {
    type: 'chat'
    text: string
}

export type RequestStateMessage = {
    type: 'requestState'
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
    players: Array<{ userId: PermanentId; userName: string }>
    isStarted: boolean
}

export type GameStateMessage = {
    type: 'gameState'
    state: SerializedGameState
}

export type MutationBroadcast = {
    type: 'mutation'
    mutation: AnyGameMutation
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
