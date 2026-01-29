import { computed, ref } from 'vue'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { getGameState } from '@/shared/registries.ts'
import { GameId } from '@/shared/types/model.ts'

const TIMER_DURATION = 2 * 60 * 60 * 1000 // 2 hours in milliseconds
const timerChosen = ref(false)
let intervalId: number | null = null

export function useTimer(gameId: GameId) {
    const gameState = getGameState(gameId)

    const remainingTime = computed(() => gameState.timerRemainingTime ?? 0)
    const timerEnabled = computed(() => gameState.timerRemainingTime !== null)
    const isExpired = computed(() => remainingTime.value <= 0)

    const declineTimer = () => {
        timerChosen.value = true
        gameState.timerRemainingTime = null
    }

    const acceptTimer = () => {
        timerChosen.value = true
        dispatchStartTimer(TIMER_DURATION)
    }

    /**
     * We use a dispatch/apply architecture to propagate the timer state changes between players.
     */

    const dispatchStartTimer = (time: number) => {
        gameMutations.UI_startTimer.actSelf({
            remainingTime: time,
            date: new Date(),
        })
    }

    const dispatchPauseTimer = (time: number) => {
        gameMutations.UI_pauseTimer.actSelf({
            remainingTime: time,
            date: new Date(),
        })
    }

    const applyStartTimer = (time: number) => {
        gameState.timerRemainingTime = time
        gameState.timerIsPaused = false

        if (intervalId === null) {
            intervalId = window.setInterval(() => {
                if (!gameState.timerIsPaused && remainingTime.value > 0) {
                    gameState.timerRemainingTime = Math.max(0, remainingTime.value - 1000)
                }
            }, 1000)
        }
    }

    const applyPauseTimer = (time: number) => {
        gameState.timerRemainingTime = time
        gameState.timerIsPaused = true

        if (intervalId) {
            clearInterval(intervalId)
            intervalId = null
        }
    }

    const resetTimer = () => {
        gameState.timerRemainingTime = null
        gameState.timerIsPaused = true
        timerChosen.value = false

        if (intervalId) {
            clearInterval(intervalId)
        }
    }

    const formattedTime = computed(() => formatTime(remainingTime.value))

    const formatTime = (time: number) => {
        const totalSeconds = Math.floor(time / 1000)
        const hours = Math.floor(totalSeconds / 3600)
        const minutes = Math.floor((totalSeconds % 3600) / 60)
        const seconds = totalSeconds % 60

        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    }

    return {
        timerChosen,
        timerEnabled,
        isExpired,
        acceptTimer,
        declineTimer,
        dispatchStartTimer,
        dispatchPauseTimer,
        applyStartTimer,
        applyPauseTimer,
        resetTimer,
        formatTime,
        formattedTime,
    }
}
