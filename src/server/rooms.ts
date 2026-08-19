import {
    DeckMessage,
    EMPTY_SEATING,
    JoinRoomMessage,
    MultiplayerMessageType,
    PermanentId,
    RollSeatingMessage,
    RoomId,
    RoomSeat,
    ScsServerMessage,
    ScsSetupGameMessage,
} from '@/shared/types/multiplayer.ts'
import { MAX_PLAYERS } from '@/shared/const/model.ts'
import { send, sendError } from './wsServer.ts'
import { ConnectionInfo, Room, SERVER_PERM_ID } from './types.ts'
import logger from './logger.ts'
import { getUser, getUserConnection } from './users.ts'
import * as persistence from './persistence.ts'
import { hasRoom, loadRoom } from './persistence.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { shuffleArray } from '@/shared/utils.ts'
import { LamportClock } from '@/shared/multiplayer/clock.ts'
import { HistoryStore } from '@/shared/state/history.ts'
import { GameId } from '@/shared/types/model.ts'
import { createGameState, getSerializedGame } from './gameState.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { deleteGameState } from '@/shared/registries.ts'

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
 * Get room by GameId
 */

export function getRoomByGameId(gameId: GameId | null): Room | undefined {
    for (const room of rooms.values()) {
        if (room.gameId == gameId) {
            return room
        }
    }
    return undefined
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
export function getOrCreateRoom(roomId: RoomId, passwordHash: string, hostId: PermanentId): Room {
    let room = rooms.get(roomId)
    if (!room) {
        // This should not happen, except from malicious actor
        if (hasRoom(roomId)) {
            throw new Error('RoomId already in use, please generate another one')
        }

        // The first user to join is the host : createGameRoom joins SCS before
        // publishing the room, so nobody else can know the roomId yet.
        room = {
            id: roomId,
            hostId,
            players: new Set(),
            seats: {},
            passwordHash,
            seating: EMPTY_SEATING,
            gameId: null,
            userDecks: {},
            globalClock: new LamportClock(SERVER_PERM_ID),
            objectClocks: {},
            gameState: null,
            history: new HistoryStore(),
            isSavedGame: false,
        }
        rooms.set(roomId, room)
        persistence.saveRoom(room)
        logger.info(`Created room: ${roomId}`)
    }
    return room
}

/**
 * Load saved room from persistence
 */
export function loadSavedGameRoom(roomId: RoomId, gameId: GameId) {
    let room = rooms.get(roomId)

    // It's not in memory, but it's probably in cold storage
    if (!room) {
        room = loadRoom(roomId)
    }

    if (!room) {
        throw new RoomNotFound(`Room ${roomId} not found`)
    }

    if (!room.gameState) {
        throw new Error(`No game state in this room`)
    }

    if (room.gameId != gameId) {
        throw new Error(`Incorrect game id ${gameId}`)
    }

    room.isSavedGame = true
    rooms.set(roomId, room)
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

    // If room is empty, delete it from memory.
    // Keep it in persistence in case players want to load it later
    if (room.players.size === 0) {
        if (room.gameId) {
            deleteGameState(room.gameId)
        }
        rooms.delete(room.id)
        logger.info(`Deleted empty room: ${room.id}`)
    }
}

/**
 * Get an edulcorated deck list, that is only the number of cards in each stack, without details
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
    const { roomId, passwordHash, savedGameId } = message

    let room: Room
    if (savedGameId) {
        room = loadSavedGameRoom(roomId, savedGameId)
    } else {
        room = getOrCreateRoom(roomId, passwordHash, connection.permId)
    }

    // Ensure players knows the password when there's one
    if (room.passwordHash && room.passwordHash != passwordHash) {
        sendError(connection.webSocket, 'Incorrect Password')
        return
    }

    // Send the decklists of other connected players to the new player
    for (const permId of room.players.values()) {
        const userDeck = room.userDecks[permId]
        if (!userDeck) {
            continue
        }
        send(connection.webSocket, {
            type: MultiplayerMessageType.Deck,
            permId: permId,
            deckList: getEdulcoratedDeckList(userDeck),
        })
    }

    // Add player to room
    connection.roomId = roomId
    room.players.add(connection.permId)

    logger.info(`Player ${user?.name} joined room ${roomId}`)
}

/**
 * Handle player leaving a room
 */
export async function handleLeaveRoom(connection: ConnectionInfo) {
    const user = getUser(connection.permId)
    const roomId = connection.roomId
    leaveRoom(connection)
    connection.roomId = null
    logger.info(`Player ${user?.name} left room ${roomId}`)
}

/**
 * Handle setting deck list
 */
export async function handleDeck(connection: ConnectionInfo, message: DeckMessage) {
    const room = ensureRoom(connection.roomId)
    room.userDecks[connection.permId] = message.deckList

    logger.info(`Player ${connection.permId} set their deck.`)

    broadcast(room.id, {
        type: MultiplayerMessageType.Deck,
        permId: connection.permId,
        deckList: getEdulcoratedDeckList(message.deckList),
    })
}

/**
 * Handle roll seating
 */
export async function handleRollSeating(connection: ConnectionInfo, message: RollSeatingMessage) {
    const room = ensureRoom(connection.roomId)
    const user = getUser(connection.permId)

    // Only the host rolls the seating. The client checks this too, but the candidates
    // come from the client, so a peer could otherwise dictate who sits at the table.
    if (connection.permId != room.hostId) {
        sendError(connection.webSocket, 'Only the host can roll the seating')
        return
    }

    // room.players is every connected websocket, judges and spectators included, so the
    // client declares who the players are.
    const declared = message.candidates
    const candidates = declared.filter(permId => room.players.has(permId))

    if (candidates.length == 0 || candidates.length > MAX_PLAYERS) {
        sendError(connection.webSocket, 'Invalid players to seat')
        return
    }

    // Generate random seating from players
    const seating = shuffleArray(candidates)

    // Store the seating in the room
    room.seating = seating
    persistence.saveRoom(room)

    logger.info(`Player ${user?.name} rolled seating in room ${room.id}`)

    // Broadcast the seating to all players
    broadcast(room.id, {
        type: MultiplayerMessageType.RollSeating,
        seating: seating,
    })
}

/**
 * Handle game launching
 */
function setupSavedGame(room: Room): GameState {
    const gameState = room.gameState

    if (!gameState) {
        throw new Error(`No game state in this room`)
    }

    // Validate that all competing (non-ousted) players are connected
    for (const player of gameState.competingPlayers) {
        if (!room.players.has(player.permId)) {
            throw new Error(`Competing player ${player.permId} is not in the room`)
        }
    }

    return gameState
}

function setupNewGame(room: Room): GameState {
    // Enforce seating: only allow launching if seating is set and matches current players
    if (!room.seating || room.seating === EMPTY_SEATING) {
        throw new Error('Seating must be set before launching the game')
    }

    // Validate that all seated players are in the room
    for (const permId of room.seating) {
        if (!room.players.has(permId)) {
            throw new Error(`Seated player ${permId} is not in the room`)
        }
    }

    // The declared seats must agree with the seating, else the host is desynced
    const seatedPlayers = Object.entries(room.seats)
        .filter(([, seat]) => seat == RoomSeat.Player)
        .map(([permId]) => permId)
    if (seatedPlayers.toSorted().join() != [...room.seating].toSorted().join()) {
        throw new Error(`Declared player seats do not match the seating`)
    }

    return createGameState(room)
}

export async function handleSetupGame(connection: ConnectionInfo, message: ScsSetupGameMessage) {
    const room = ensureRoom(connection.roomId)

    // Only the host launches the game, and so only the host declares the seats.
    // Without this, any user in the room could grant themselves a judge's vision.
    if (connection.permId != room.hostId) {
        sendError(connection.webSocket, 'Only the host can launch the game')
        return
    }

    room.seats = message.seats
    const gameState = room.isSavedGame ? setupSavedGame(room) : setupNewGame(room)

    broadcastTailored(room.id, permId => ({
        type: MultiplayerMessageType.LaunchGame,
        serializedGame: getSerializedGame(gameState, room, permId),
    }))
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

    logger.debug(`Broadcasting to room ${roomId}`)

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
