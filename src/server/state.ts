import { RoomId } from '@/shared/types/multiplayer.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { AnyGameMutation } from '@/shared/state/gameMutations.ts'

/**
 * Track game state for each room
 */
const roomStates = new Map<RoomId, GameState>()

/**
 * Get game state for a room (returns undefined if not found)
 */
export function getGameState(roomId: RoomId): GameState | undefined {
    return roomStates.get(roomId)
}

/**
 * Apply a mutation to a room's game state
 */
export function applyMutation(roomId: RoomId, mutation: AnyGameMutation): void {
    const gameState = getGameState(roomId)

    if (!gameState) {
        return
    }

    // Apply the mutation
    // For now, this is a placeholder.

    console.log(`Applied mutation ${mutation.name} to room ${roomId}`)
}

/**
 * Delete game state for a room
 */
export function deleteGameState(roomId: RoomId): void {
    roomStates.delete(roomId)
    console.log(`🗑Deleted game state for room: ${roomId}`)
}
