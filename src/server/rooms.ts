import {
    EMPTY_SEATING,
    JoinRoomMessage,
    MultiplayerMessageType,
    PermanentId,
    RoomId,
    ScsServerMessage,
    ScsSetupGameMessage,
} from '@/shared/types/multiplayer.ts'
import { send, sendError } from './index.ts'
import { ConnectionInfo, Room } from './types.ts'
import { createGameState, getKnownCards } from './gameState.ts'
import { getUser, getUserConnection } from './users.ts'
import { deleteGameState } from '@/shared/registries.ts'
import { serializeGameState } from '@/shared/serialization.ts'
import { GAME_STATE_VERSION } from '@/shared/const/multiplayer.ts'
import { GameState } from '@/shared/state/gameState.ts'

export class RoomNotFound extends Error {}

// Active rooms
const rooms = new Map<RoomId, Room>()

/**
 * Get room by ID
 */
export function getRoom(roomId: RoomId | null): Room | undefined {
    if (!roomId) {
        return undefined
    }
    return rooms.get(roomId)
}

/**
 * Get room by ID, and throw an exception if undefined
 */
export function ensureRoom(roomId: RoomId | null): Room {
    const room = getRoom(roomId)
    if (!room) {
        throw new RoomNotFound(`Room  ${roomId} not found`)
    }
    return room
}

/**
 * Get or create a room
 */
export function getOrCreateRoom(roomId: RoomId, passwordHash: string): Room {
    let room = rooms.get(roomId)
    if (!room) {
        room = {
            id: roomId,
            players: new Set(),
            passwordHash,
            seating: EMPTY_SEATING,
            gameId: null,
        }
        rooms.set(roomId, room)
        console.log(`Created room: ${roomId}`)
    }
    return room
}

/**
 * Leave Room
 */
export function leaveRoom(connection: ConnectionInfo): Room | undefined {
    const room = getRoom(connection.roomId)
    if (!room) {
        return
    }

    // Remove player from room
    room.players.delete(connection.permId)

    // If room is empty, delete it
    if (room.players.size === 0) {
        deleteGameState(room.id)
        rooms.delete(room.id)
        console.log(`Deleted empty room: ${room.id}`)
    }
}

/**
 * Handle player joining a room
 */
export async function handleJoinRoom(connection: ConnectionInfo, message: JoinRoomMessage) {
    const user = getUser(connection.permId)
    const { roomId, passwordHash } = message

    const room = getOrCreateRoom(roomId, passwordHash)

    // Ensure players knows the password when there's one
    if (room.passwordHash && room.passwordHash != passwordHash) {
        sendError(connection.webSocket, 'Incorrect Password')
        return
    }

    // Add player to room
    connection.roomId = roomId
    room.players.add(connection.permId)
    console.log(`Player ${user?.name} joined room ${roomId}`)
}

/**
 * Handle player leaving a room
 */
export async function handleLeaveRoom(connection: ConnectionInfo) {
    const user = getUser(connection.permId)
    const roomId = connection.roomId
    leaveRoom(connection)
    connection.roomId = null
    console.log(`Player ${user?.name} left room ${roomId}`)
}

/**
 * Handle game launching
 */
export async function handleSetupGame(connection: ConnectionInfo, message: ScsSetupGameMessage) {
    const room = ensureRoom(connection.roomId)
    room.seating = message.seating
    const gameState = createGameState(room)

    broadcastTailored(room.id, permId => {
        const knownCards = getKnownCards(gameState, permId)
        const userGameState = { ...gameState, knownCards } as GameState
        const serializedGameState = serializeGameState(userGameState)
        const serializedGame = {
            version: GAME_STATE_VERSION,
            gameState: serializedGameState,
            history: {
                stringPool: [],
                logEntries: [],
                gameMutations: [],
            },
            objectClocks: {},
            mutationVersions: {},
        }

        return {
            type: MultiplayerMessageType.LaunchGame,
            serializedGame: serializedGame,
        }
    })
}

/**
 * Broadcast a message to all players in a room
 */
type MessageGetter = (permId: PermanentId) => ScsServerMessage | undefined

// Broadcast with a callback to personnalize the message ( for gameState.knownCards )
export function broadcastTailored(roomId: RoomId, getMessage: MessageGetter) {
    const room = getRoom(roomId)
    if (!room) {
        return
    }

    console.log(`Broadcasting to room ${roomId}`)

    for (const permId of room.players.values()) {
        const connection = getUserConnection(permId)
        if (connection) {
            const message = getMessage(permId)
            if (message) {
                send(connection.webSocket, message)
            }
        }
    }
}

export function broadcast(roomId: RoomId, message: ScsServerMessage) {
    broadcastTailored(roomId, () => message)
}
