<template>
    <CentralPanel class="the-edge-hint">
        <div>
            <span
                class="inline-player-name"
                :style="{
                    backgroundColor: gameState.theEdgeController?.rgbaColor,
                }"
            >
                {{ gameState.theEdgeController?.name }}
            </span>
            controls The Edge
            <img
                src="/assets/theEdgeTealSmall.webp"
                class="theEdgeImage"
            />
            and can gain 1 pool from the blood bank
        </div>
    </CentralPanel>
</template>

<script setup lang="ts">
import { useGameStateStore } from '@/client/store/gameState.ts'
import CentralPanel from '@/client/ui/ingame/topArea/central/CentralPanel.vue'

const gameState = useGameStateStore()
</script>

<style lang="scss">
.central-panel.the-edge-hint {
    text-align: center;
    // Draw the eye when The Edge becomes gainable, without leaving the shared
    // surface : flash the border teal instead of the background.
    animation: TheEdgeHintFlash 1s linear;

    .theEdgeImage {
        height: 25px;
        vertical-align: middle;
    }
}

@keyframes TheEdgeHintFlash {
    0% {
        border-color: $shadow-grey;
    }
    10% {
        border-color: $light-teal;
    }
    100% {
        border-color: $shadow-grey;
    }
}
</style>
