<template>
    <CentralPanel>
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
    </CentralPanel>
</template>

<script setup lang="ts">
import { useGameStateStore } from '@/client/store/gameState.ts'
import { useTimer } from '@/shared/state/useTimer.ts'
import CentralPanel from '@/client/ui/ingame/topArea/central/CentralPanel.vue'

const gameState = useGameStateStore()
const timer = useTimer(gameState.gameId)
</script>

<style lang="scss">
.timer-setup {
    display: flex;
    align-items: center;
    gap: 0.5rem;

    .timer-setup-text {
        font-weight: bold;
        color: $shadow-grey;
    }

    .game-button {
        padding: 0.25rem 1rem;
    }
}
</style>
