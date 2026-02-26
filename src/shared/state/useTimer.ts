import { computed, ref } from 'vue'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { getGameState } from '@/shared/registries.ts'
import { GameId } from '@/shared/types/model.ts'

const TIMER_DURATION = 2 * 60 * 60 * 1000 // 2 hours in milliseconds
const timerChosen = ref(false)
// Reactive "now" tick — drives display updates without affecting timer accuracy
const now = ref(Date.now())
let intervalId: number | null = null

export function startClock() {
    if (intervalId === null) {
        intervalId = window.setInterval(() => {
            now.value = Date.now()
        }, 500) // 500 is plenty for a seconds-precision display
    }
}

export function stopClock() {
    if (intervalId !== null) {
        clearInterval(intervalId)
        intervalId = null
    }
}

export function useTimer(gameId: GameId) {
    const gameState = getGameState(gameId)

    const timerEnabled = computed(() => gameState.timerStartTime !== null)

    function getRemainingTimeAt(time: number) {
        if (gameState.timerStartTime === null) return 0

        const elapsed =
            (gameState.timerIsPaused && gameState.timerPausedAt ? gameState.timerPausedAt : time) -
            gameState.timerStartTime -
            gameState.timerTotalPausedMs

        return Math.max(0, TIMER_DURATION - elapsed)
    }

    const remainingTime = computed(() => {
        return getRemainingTimeAt(now.value)
    })

    const isExpired = computed(() => remainingTime.value <= 0)

    const declineTimer = () => {
        timerChosen.value = true
        gameState.timerStartTime = null
    }

    const acceptTimer = () => {
        timerChosen.value = true
        dispatchStartTimer()
    }

    /**
     * We use a dispatch/apply architecture to propagate the timer state changes between players.
     */

    const dispatchStartTimer = () => {
        gameMutations.UI_startTimer.actSelf({
            date: new Date(),
        })
    }

    const dispatchPauseTimer = () => {
        gameMutations.UI_pauseTimer.actSelf({
            date: new Date(),
        })
    }

    const applyStartTimer = (date: Date) => {
        const timestamp = date.getTime()

        if (gameState.timerStartTime === null) {
            // Fresh start
            gameState.timerStartTime = timestamp
            gameState.timerTotalPausedMs = 0
        } else {
            // Resume: accumulate the pause duration
            gameState.timerTotalPausedMs += timestamp - (gameState.timerPausedAt ?? timestamp)
        }

        gameState.timerIsPaused = false
        gameState.timerPausedAt = null
    }

    const applyPauseTimer = (date: Date) => {
        gameState.timerPausedAt = date.getTime()
        gameState.timerIsPaused = true
    }

    // Resume the timer where it was at a given time.
    // Useful for loading savedGames
    const resumeTimer = (date: Date) => {
        // The timer was not launched, or it was already paused when saving, nothing to do
        if (gameState.timerStartTime === null || gameState.timerIsPaused) {
            return
        }

        // Update the pause time to take into acount for elapsed time since save game
        gameState.timerPausedAt = date.getTime()
        // Restart the timer now
        applyStartTimer(new Date())
    }

    const resetTimer = () => {
        gameState.timerStartTime = null
        gameState.timerIsPaused = true
        gameState.timerPausedAt = null
        gameState.timerTotalPausedMs = 0
        timerChosen.value = false
    }

    const formatTime = (time: number) => {
        const totalSeconds = Math.floor(time / 1000)
        const hours = Math.floor(totalSeconds / 3600)
        const minutes = Math.floor((totalSeconds % 3600) / 60)
        const seconds = totalSeconds % 60

        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    }

    const formattedTime = computed(() => formatTime(remainingTime.value))

    return {
        timerChosen,
        timerEnabled,
        remainingTime,
        isExpired,
        getRemainingTimeAt,
        acceptTimer,
        declineTimer,
        dispatchStartTimer,
        dispatchPauseTimer,
        applyStartTimer,
        applyPauseTimer,
        resumeTimer,
        resetTimer,
        formatTime,
        formattedTime,
    }
}
