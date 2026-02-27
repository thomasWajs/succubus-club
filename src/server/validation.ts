import { WebSocket } from 'ws'
import { ConnectionInfo, GameMutationMessage, MutationBroadcast } from '@/shared/types/server.ts'
import { sendError } from './index.ts'
import { broadcast, getRoom } from './rooms.ts'
import { getOrCreateGameState } from './state.ts'

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
export async function handleGameMutation(
    ws: WebSocket,
    message: GameMutationMessage,
    connections: Map<WebSocket, ConnectionInfo>,
) {
    const connInfo = connections.get(ws)
    if (!connInfo) {
        sendError(ws, 'Connection not found')
        return
    }

    // Verify user is in the room
    if (connInfo.roomId !== message.roomId) {
        sendError(ws, 'Not in this room')
        return
    }

    // Check rate limit
    if (!checkRateLimit(connInfo.userId)) {
        sendError(ws, 'Rate limit exceeded')
        console.warn(`Rate limit exceeded for user ${connInfo.userId}`)
        return
    }

    // Verify mutation author matches sender
    const mutation = message.mutation
    if (mutation.author.permId !== connInfo.userId) {
        sendError(ws, 'Mutation author mismatch')
        console.warn(`Mutation author mismatch: ${mutation.author.permId} !== ${connInfo.userId}`)
        return
    }

    // Get room
    const room = getRoom(message.roomId)
    if (!room) {
        sendError(ws, 'Room not found')
        return
    }

    // Validate mutation
    // Note: This requires refactoring gameMutations.ts to work with plain objects
    // For now, we'll just check if the mutation can be applied
    const gameState = getOrCreateGameState(message.roomId)

    console.log(gameState)

    try {
        const validity = mutation.canApply()
        if (!validity.isValid) {
            sendError(ws, `Invalid mutation: ${validity.reason}`)
            console.warn(`Invalid mutation: ${validity.reason}`)
            return
        }
    } catch (error) {
        console.error('Error validating mutation:', error)
        sendError(ws, 'Failed to validate mutation')
        return
    }

    // Apply mutation (placeholder - needs refactoring)
    // applyMutation(message.roomId, mutation)

    // Broadcast mutation to all players in the room
    const broadcastMessage: MutationBroadcast = {
        type: 'mutation',
        roomId: message.roomId,
        mutation,
    }
    broadcast(message.roomId, broadcastMessage)

    console.log(`Validated and broadcast mutation: ${mutation.name}`)
}
