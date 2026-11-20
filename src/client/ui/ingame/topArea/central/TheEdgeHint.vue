<template>
    <CentralPanel class="the-edge-hint">
        <div>
            <span
                class="inline-player-name"
                :style="playerTagStyle(gameState.theEdgeController)"
            >
                {{ gameState.theEdgeController?.name }}
            </span>
            controls The Edge
            <span class="theEdgeDisc">
                <img
                    src="/assets/theEdgeEmblem.webp"
                    class="theEdgeImage"
                />
            </span>
            and can gain 1 pool from the blood bank
        </div>
    </CentralPanel>
</template>

<script setup lang="ts">
import { useGameStateStore } from '@/client/store/gameState.ts'
import CentralPanel from '@/client/ui/ingame/topArea/central/CentralPanel.vue'
import { playerTagStyle } from '@/client/colors.ts'

const gameState = useGameStateStore()
</script>

<style lang="scss">
.central-panel.the-edge-hint {
    text-align: center;
    // Draw the eye when The Edge becomes gainable, without leaving the shared
    // surface : flash the border teal instead of the background.
    animation: TheEdgeHintFlash 1s linear;

    // The disc is drawn, not baked in the image, so it follows the UI theme ( like the
    // controlled Edge on the table, see RegionTheEdgeGO.vue ). The emblem is not square and is
    // centered on its own enclosing circle, hence the flex centering.
    .theEdgeDisc {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 25px;
        height: 25px;
        vertical-align: middle;
        border-radius: 50%;
        background: light-dark($light-teal, $ui-accent);
    }

    .theEdgeImage {
        height: 22px;
    }
}

@keyframes TheEdgeHintFlash {
    0% {
        border-color: var(--ui-border);
    }
    10% {
        border-color: var(--ui-highlight-border);
    }
    100% {
        border-color: var(--ui-border);
    }
}
</style>
