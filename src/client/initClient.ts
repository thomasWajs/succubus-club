import { registerGameState, registerMutationTrigger } from '@/shared/registries.ts'
import { act, actSelf } from '@/client/state/gameMutations.ts'
import { initWasmHasher } from '@/client/gateway/serialization.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'

// Register client code into shared functions
export function initClient() {
    const gameState = useGameStateStore()
    registerGameState(gameState.gameId, gameState)
    registerMutationTrigger({ act, actSelf })
    initWasmHasher()
}
