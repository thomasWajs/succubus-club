import { GameMutationMessage, MutationBroadcast } from '@/shared/types/server.ts'
import { ConnectionInfo, sendError } from './index.ts'
import { broadcast, getRoom } from './rooms.ts'
import { applyMutation } from './state.ts'

/**
 * Rate limiting: Track mutations per player
 */
type RateLimitInfo = {
    count: number
    windowStart: number
}

const RATE_LIMIT_WINDOW = 1000 // 1 second
const RATE_LIMIT_MAX = 50 // Max mutations per window

const rateLimits = new Map<string, RateLimitInfo>()

/**
 * Check rate limit for a player
 */
function checkRateLimit(userId: string): boolean {
    const now = Date.now()
    const info = rateLimits.get(userId)

    if (!info || now - info.windowStart > RATE_LIMIT_WINDOW) {
        // Start new window
        rateLimits.set(userId, { count: 1, windowStart: now })
        return true
    }

    if (info.count >= RATE_LIMIT_MAX) {
        return false // Rate limit exceeded
    }

    info.count++
    return true
}

/**
 * Handle game mutation from client
 */
export async function handleGameMutation(connection: ConnectionInfo, message: GameMutationMessage) {
    // Check rate limit
    if (!checkRateLimit(connection.userId)) {
        sendError(connection.webSocket, 'Rate limit exceeded')
        console.warn(`Rate limit exceeded for user ${connection.userId}`)
        return
    }

    // Verify mutation author matches sender
    const mutation = message.mutation
    if (mutation.author.permId !== connection.userId) {
        sendError(connection.webSocket, 'Mutation author mismatch')
        console.warn(`Mutation author mismatch: ${mutation.author.permId} !== ${connection.userId}`)
        return
    }

    // Get room
    const room = getRoom(connection.roomId)
    if (!room) {
        sendError(connection.webSocket, 'Room not found')
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

    //const gameState = getGameState(message.roomId)
    // Apply mutation
    applyMutation(room.id, mutation)

    // Broadcast mutation to all players in the room
    const broadcastMessage: MutationBroadcast = {
        type: 'mutation',
        mutation,
    }
    broadcast(room.id, broadcastMessage)

    console.log(`Validated and broadcast mutation: ${mutation.name}`)
}
