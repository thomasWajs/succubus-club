import { registerGameState, registerLogger, registerMutationTrigger } from '@/shared/registries.ts'
import { act, actSelf } from '@/client/state/gameMutations.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { initWasmHasher } from '@/shared/serialization.ts'
import { captureException, captureMessage } from '@/client/logging.ts'

// Register client code into shared functions
export function initClient() {
    const gameState = useGameStateStore()

    registerLogger({ captureException, captureMessage })
    registerGameState(gameState.gameId, gameState)
    registerMutationTrigger({ act, actSelf })
    initWasmHasher()
}

export function hasWebGL(): boolean {
    try {
        const canvas = document.createElement('canvas')
        return !!(
            window.WebGLRenderingContext &&
            (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
        )
    } catch {
        return false
    }
}
