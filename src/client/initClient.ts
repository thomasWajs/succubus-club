import { registerGameState, registerMutationTrigger } from '@/shared/registries.ts'
import { act, actSelf } from '@/client/state/gameMutations.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { initWasmHasher } from '@/shared/serialization.ts'

// Register client code into shared functions
export function initClient() {
    const gameState = useGameStateStore()
    registerGameState(gameState.gameId, gameState)
    registerMutationTrigger({ act, actSelf })
    initWasmHasher()
}
