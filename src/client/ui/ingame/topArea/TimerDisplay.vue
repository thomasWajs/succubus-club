<template>
    <div
        v-if="timer.timerEnabled.value"
        class="timer-display"
        :class="{ expired: timer.isExpired.value }"
    >
        {{ timer.formattedTime }}

        <button
            class="game-button small timer-button"
            @click="togglePause"
        >
            {{ gameState.timerIsPaused ? '▶' : '⏸' }}
        </button>
    </div>
</template>

<script setup lang="ts">
import { useGameStateStore } from '@/client/store/gameState.ts'
import { useTimer } from '@/shared/state/useTimer.ts'

const gameState = useGameStateStore()
const timer = useTimer(gameState.gameId)

function togglePause() {
    if (gameState.timerStartTime === null) {
        throw new Error('Timer is not started')
    }
    if (gameState.timerIsPaused) {
        timer.dispatchStartTimer()
    } else {
        timer.dispatchPauseTimer()
    }
}
</script>

<style lang="scss">
.timer-display {
    font-size: 16px;
    font-weight: bold;
    color: black;
    padding: 0.25rem 0.5rem;
    background: rgba($pearl-grey, 0.7);
    border: solid 1px $shadow-grey;
    min-width: 80px;
    text-align: center;

    &.expired {
        color: red;
    }
}

.timer-button {
    margin-left: 5px;
    padding: 2px 5px;
    font-size: 14px;
}
</style>
