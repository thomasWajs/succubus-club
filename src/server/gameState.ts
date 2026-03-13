import { sendError } from './index.ts'
import { broadcastTailored, ensureRoom, getRoom } from './rooms.ts'
import {
    EMPTY_SEATING,
    PermanentId,
    RoomId,
    ScsGameMutationMessage,
} from '@/shared/types/multiplayer.ts'
import { ConnectionInfo, RateLimitInfo, Room } from './types.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { setupMultiplayerGameState } from '@/shared/state/setup.ts'
import { getUser } from './users.ts'
import { getGameState } from '@/shared/registries.ts'
import { KnownCards } from '@/shared/types/state.ts'
import { anyoneCanSee, canSeeOrPeek } from '@/shared/state/cardVisibility.ts'
import { unpackGameMutation } from '@/shared/serialization.ts'
import * as persistence from './persistence.ts'

const RATE_LIMIT_WINDOW = 1000 // 1 second
const RATE_LIMIT_MAX = 50 // Max mutations per window

/**
 * Track rate limits for each user
 */
const rateLimits = new Map<PermanentId, RateLimitInfo>()

/**
 * Check rate limit for a player
 */
function checkRateLimit(permId: PermanentId): boolean {
    const now = Date.now()
    const info = rateLimits.get(permId)

    if (!info || now - info.windowStart > RATE_LIMIT_WINDOW) {
        // Start new window
        rateLimits.set(permId, { count: 1, windowStart: now })
        return true
    }

    if (info.count >= RATE_LIMIT_MAX) {
        return false // Rate limit exceeded
    }

    info.count++
    return true
}

/**
 * Create initial game state for launching a game
 */
export function createGameState(room: Room): GameState {
    if (!room.seating || room.seating == EMPTY_SEATING) {
        throw new Error(`No seating in game room`)
    }

    const gameState = new GameState()
    const seatedUsers = room.seating.map(permId => getUser(permId))
    setupMultiplayerGameState(gameState, seatedUsers)
    room.gameId = gameState.gameId
    persistence.saveGameState(gameState)
    return gameState
}

/**
 * Get game state for a room (returns undefined if not found)
 */
export function getRoomGameState(roomId: RoomId): GameState | undefined {
    const room = getRoom(roomId)
    if (room && room.gameId) {
        return getGameState(room.gameId)
    }
}

/**
 * In a game state, get cards that are known by a given user
 */
export function getKnownCards(gameState: GameState, permId: PermanentId): KnownCards {
    const userKnownCards: KnownCards = {}
    const playerOid = gameState.usersToPlayer[permId]
    const player = playerOid ? gameState.players[playerOid] : undefined
    for (const card of Object.values(gameState.cards)) {
        if (card.krcgId && (anyoneCanSee(card) || (player && canSeeOrPeek(player, card)))) {
            userKnownCards[card.oid] = card.krcgId
        }
    }
    return userKnownCards
}

/**
 * Handle game mutation from client
 */
export async function handleGameMutation(
    connection: ConnectionInfo,
    message: ScsGameMutationMessage,
) {
    // Check rate limit
    if (!checkRateLimit(connection.permId)) {
        sendError(connection.webSocket, 'Rate limit exceeded')
        console.warn(`Rate limit exceeded for user ${connection.permId}`)
        return
    }

    // Get room and its game state
    const room = ensureRoom(connection.roomId)

    if (!room.gameId) {
        sendError(connection.webSocket, 'Game not launched')
        console.warn(`Game not launched for user ${connection.permId} in room ${room.id}`)
        return
    }

    const gameState = getGameState(room.gameId)
    const mutation = unpackGameMutation(message.gameMutation)

    // Verify mutation author matches sender
    if (mutation.author.permId !== connection.permId) {
        sendError(connection.webSocket, 'Mutation author mismatch')
        console.warn(`Mutation author mismatch: ${mutation.author.permId} !== ${connection.permId}`)
        return
    }

    // Validate mutation
    try {
        const validity = mutation.canApply()
        if (!validity.isValid) {
            sendError(connection.webSocket, `Invalid mutation: ${validity.reason}`)
            console.warn(`Invalid mutation: ${validity.reason}`)
            return
        }
    } catch (error) {
        console.error('Error validating mutation:', error)
        sendError(connection.webSocket, 'Failed to validate mutation')
        return
    }

    // Apply mutation
    mutation.apply()

    console.log(`Applied mutation ${mutation.name} to room ${room.id}`)

    // Persist updated game state
    persistence.saveGameState(gameState)

    // Broadcast mutation to all players in the room
    broadcastTailored(room.id, permId => {
        const knownCards = getKnownCards(gameState, permId)
        return { ...message, knownCards }
    })
}
