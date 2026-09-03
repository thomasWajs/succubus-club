<template>
    <div class="timer-setup">
        <span class="timer-setup-text">Start a 2h timer ? </span>
        <button
            class="game-button"
            @click="timer.acceptTimer()"
        >
            Yes
        </button>
        <button
            class="game-button"
            @click="timer.declineTimer()"
        >
            No
        </button>
    </div>
</template>

<script setup lang="ts">
import { useGameStateStore } from '@/client/store/gameState.ts'
import { useTimer } from '@/shared/state/useTimer.ts'

const gameState = useGameStateStore()
const timer = useTimer(gameState.gameId)
</script>

<style lang="scss">
.timer-setup {
    align-self: center;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: rgba($pearl-grey, 0.7);
    padding: 0.5rem 1rem;
    border: solid 1px $shadow-grey;
    border-radius: 2px;

    .timer-setup-text {
        font-weight: bold;
        color: $shadow-grey;
    }

    .game-button {
        padding: 0.25rem 1rem;
    }
}
</style>
