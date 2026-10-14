import { computed } from 'vue'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { GameType } from '@/shared/types/state.ts'

/**
 * Whether the game is played with the rules engine ( GameType.Engine ) : the engine decides what
 * is legal and moves the table, the user's moves on it are read as its decisions.
 */
export function useEngineMode() {
    const gameState = useGameStateStore()
    return { isEngine: computed(() => gameState.gameType == GameType.Engine) }
}
