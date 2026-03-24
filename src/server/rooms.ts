import {
    DeckMessage,
    EMPTY_SEATING,
    JoinRoomMessage,
    MultiplayerMessageType,
    PermanentId,
    RoomId,
    ScsServerMessage,
} from '@/shared/types/multiplayer.ts'
import { send, sendError } from './index.ts'
import { ConnectionInfo, Room } from './types.ts'
import { createGameState, getKnownCards } from './gameState.ts'
import { getUser, getUserConnection } from './users.ts'
import { serializeGameState } from '@/shared/serialization.ts'
import { GAME_STATE_VERSION } from '@/shared/const/multiplayer.ts'
import { GameState } from '@/shared/state/gameState.ts'
import * as persistence from './persistence.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { shuffleArray } from '@/shared/utils.ts'

export class RoomNotFound extends Error {}

// Active rooms
const rooms = new Map<RoomId, Room>()

/**
 * Restore rooms from persistence
 */
export function restoreRooms(persistedRooms: Room[]): void {
    for (const room of persistedRooms) {
        rooms.set(room.id, room)
    }
}

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
            userDecks: {},
        }
        rooms.set(roomId, room)
        persistence.saveRoom(room)
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
    delete room.userDecks[connection.permId]

    // If room is empty, delete it
    if (room.players.size === 0) {
        if (room.gameId) {
            persistence.deleteGameState(room.gameId)
        }
        persistence.deleteRoom(room.id)
        rooms.delete(room.id)
        console.log(`Deleted empty room: ${room.id}`)
    }
}

/**
 * Leave Room
 */

export function getEdulcoratedDeckList(deckList: DeckList) {
    const edulcoratedDeck: DeckList = {}
    for (const [cardId, quantity] of Object.entries(deckList)) {
        const cardIdNum = parseInt(cardId)
        if (!isNaN(cardIdNum) && Number.isInteger(quantity)) {
            const firstNum = cardIdNum.toString()[0]
            if (!edulcoratedDeck[firstNum]) {
                edulcoratedDeck[firstNum] = 0
            }
            edulcoratedDeck[firstNum] += quantity
        }
    }
    return edulcoratedDeck
}

/**
 * Handle player joining a room
 */
export async function handleJoinRoom(connection: ConnectionInfo, message: JoinRoomMessage) {
    if (connection.roomId) {
        throw new Error(`Connection is already in another room ${connection.roomId}`)
    }

    const user = getUser(connection.permId)
    const { roomId, passwordHash } = message

    const room = getOrCreateRoom(roomId, passwordHash)

    // Ensure players knows the password when there's one
    if (room.passwordHash && room.passwordHash != passwordHash) {
        sendError(connection.webSocket, 'Incorrect Password')
        return
    }

    // Send the decklists of other connected players to the new player
    for (const permId of room.players.values()) {
        send(connection.webSocket, {
            type: MultiplayerMessageType.Deck,
            permId: permId,
            deckList: getEdulcoratedDeckList(room.userDecks[permId]),
        })
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
 * Handle setting deck list
 */
export async function handleDeck(connection: ConnectionInfo, message: DeckMessage) {
    const room = ensureRoom(connection.roomId)
    room.userDecks[connection.permId] = message.deckList

    console.log(`Player ${connection.permId} set their deck.`)

    broadcast(room.id, {
        type: MultiplayerMessageType.Deck,
        permId: connection.permId,
        deckList: getEdulcoratedDeckList(message.deckList),
    })
}

/**
 * Handle roll seating
 */
export async function handleRollSeating(connection: ConnectionInfo) {
    const room = ensureRoom(connection.roomId)
    const user = getUser(connection.permId)

    // Generate random seating from players
    const players = Array.from(room.players)
    const seating = shuffleArray(players)

    // Store the seating in the room
    room.seating = seating
    persistence.saveRoom(room)

    console.log(`Player ${user?.name} rolled seating in room ${room.id}`)

    // Broadcast the seating to all players
    broadcast(room.id, {
        type: MultiplayerMessageType.RollSeating,
        seating: seating,
    })
}

/**
 * Handle game launching
 */
export async function handleSetupGame(connection: ConnectionInfo) {
    const room = ensureRoom(connection.roomId)

    // Enforce seating: only allow launching if seating is set and matches current players
    if (!room.seating || room.seating === EMPTY_SEATING) {
        throw new Error('Seating must be set before launching the game')
    }

    // Validate that all seated players are in the room
    const seatingArray = Array.isArray(room.seating) ? room.seating : []
    for (const permId of seatingArray) {
        if (!room.players.has(permId)) {
            throw new Error(`Seated player ${permId} is not in the room`)
        }
    }

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
