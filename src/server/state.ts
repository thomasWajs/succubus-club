import { RoomId } from '@/shared/types/multiplayer.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { AnyGameMutation } from '@/shared/state/gameMutations.ts'
import { generateGameId } from '@/shared/state/ids.ts'
import { registerGameState } from '@/shared/registries.ts'

/**
 * Track game state for each room
 */
const roomStates = new Map<RoomId, GameState>()

/**
 * Get or create game state for a room
 */
export function getOrCreateGameState(roomId: RoomId): GameState {
    let state = roomStates.get(roomId)
    if (!state) {
        state = new GameState()
        state.gameId = generateGameId()
        registerGameState(state.gameId, state)
        roomStates.set(roomId, state)
        console.log(`Created game state for room: ${roomId}`)
    }
    return state
}

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
    const state = getOrCreateGameState(roomId)

    console.log(state)

    // Apply the mutation
    // Note: The mutation's updateGameState method expects a Pinia store,
    // but we're using plain objects here. We'll need to refactor mutations too.
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

/**
 * Get all room states (for debugging/persistence)
 */
export function getAllRoomStates(): Map<RoomId, GameState> {
    return roomStates
}
