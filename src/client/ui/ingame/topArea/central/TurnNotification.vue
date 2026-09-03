<template>
    <div class="turn-notification">
        <span class="turn-notification-label">Turn #{{ gameState.turnNumber }}</span>
        <span
            class="inline-player-name turn-notification-player"
            :style="{ backgroundColor: gameState.activePlayer?.rgbaColor }"
        >
            {{ gameState.activePlayer?.name }}
        </span>
    </div>
</template>

<script setup lang="ts">
import { useGameStateStore } from '@/client/store/gameState.ts'

const gameState = useGameStateStore()
</script>

<style lang="scss">
.turn-notification {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 1.5rem;
    padding: 1rem 1.5rem;
    border: solid 2px $light-teal;
    border-radius: 4px;
    background: rgba($pearl-grey, 0.85);
    box-shadow: 0 0 12px rgba($light-teal, 0.9);
    font-size: 26px;
    font-weight: bold;
    color: $shadow-grey;
    white-space: nowrap;
    animation: TurnNotificationAppear 0.5s ease-out;

    .turn-notification-label {
        text-transform: uppercase;
        letter-spacing: 1px;
    }

    .turn-notification-player {
        font-size: 22px;
        padding: 2px 10px;
        border-radius: 2px;
        animation: TurnNotificationPulse 1s ease-in-out infinite;
    }
}

@keyframes TurnNotificationAppear {
    0% {
        opacity: 0;
        transform: translate(-50%, -50%) scale(0.7);
    }
    60% {
        transform: translate(-50%, -50%) scale(1.08);
    }
    100% {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
    }
}

@keyframes TurnNotificationPulse {
    0%,
    100% {
        transform: scale(1);
    }
    50% {
        transform: scale(1.08);
    }
}
</style>
