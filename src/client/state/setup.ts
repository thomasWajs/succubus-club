import { useGameStateStore } from '@/client/store/gameState.ts'
import { useCoreStore } from '@/client/store/core.ts'
import router, { ROUTES } from '@/client/ui/router.ts'
import { useHistoryStore } from '@/client/store/history.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { startClock, stopClock, useTimer } from '@/shared/state/useTimer.ts'
import { hasGameState } from '@/shared/registries.ts'
import { stopEngine } from '@/client/engine/driver.ts'

export function resetState() {
    const core = useCoreStore()
    const gameState = useGameStateStore()

    if (hasGameState(gameState.gameId)) {
        useTimer(gameState.gameId).resetTimer()
    }

    useGameStateStore().$reset()
    useHistoryStore().$reset()
    useGameBusStore().$reset()

    stopEngine()

    core.gameIsStarted = false
    core.phaserIsReady = false
    core.gameStateIsReady = false
}

export function startGame() {
    const core = useCoreStore()

    if (core.gameIsStarted) {
        throw new Error(`Game is already started`)
    }

    // Run the clock in the background while the game is running, performance cost is negligible.
    startClock()

    core.gameIsStarted = true
    router.push({ name: ROUTES.Game })
}

export function leaveGame(redirectToMenu: boolean = false) {
    const core = useCoreStore()

    if (!core.gameIsStarted) {
        return
    }

    stopClock()
    resetState()

    if (redirectToMenu) {
        router.push({ name: ROUTES.MainMenu })
    }
}
