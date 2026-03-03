import { sendError } from './index.ts'
import { broadcast, ensureRoom, getRoom } from './rooms.ts'
import {
    EMPTY_SEATING,
    PermanentId,
    RoomId,
    ScsGameMutationMessage,
} from '@/shared/types/multiplayer.ts'
import { ConnectionInfo, RateLimitInfo, Room } from './types.ts'
import { AnyGameMutation } from '@/shared/state/gameMutations.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { setupMultiplayerGameState } from '@/shared/state/setup.ts'
import { getUser } from './users.ts'
import { getGameState } from '@/shared/registries.ts'

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
 * Apply a mutation to a room's game state
 */
export function applyMutation(roomId: RoomId, mutation: AnyGameMutation): void {
    const gameState = getRoomGameState(roomId)

    if (!gameState) {
        return
    }

    // Apply the mutation
    // For now, this is a placeholder.

    console.log(`Applied mutation ${mutation.name} to room ${roomId}`)
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

    // Verify mutation author matches sender
    /*
    const mutation = message.mutation
    if (mutation.author.permId !== connection.userId) {
        sendError(connection.webSocket, 'Mutation author mismatch')
        console.warn(`Mutation author mismatch: ${mutation.author.permId} !== ${connection.userId}`)
        return
    }
     */

    // Get room
    const room = ensureRoom(connection.roomId)

    // Validate mutation
    /*
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
     */

    //const gameState = getGameState(message.roomId)
    // Apply mutation
    // applyMutation(room.id, mutation)

    // Broadcast mutation to all players in the room
    /*
    const broadcastMessage: MutationBroadcast = {
        type: 'mutation',
        mutation: message.mutation,
    }
     */

    broadcast(room.id, message)
}
