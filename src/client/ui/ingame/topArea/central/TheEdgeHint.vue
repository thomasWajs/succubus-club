<template>
    <div id="TheEdgeHint">
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
</template>

<script setup lang="ts">
import { useGameStateStore } from '@/client/store/gameState.ts'

const gameState = useGameStateStore()
</script>

<style lang="scss">
#TheEdgeHint {
    background-color: $silver-grey;
    color: $shadow-grey;
    display: inline-block;
    text-align: center;
    border: solid 1px $shadow-grey;
    padding: 4px 2px;
    animation: TheEdgeHintAppear 1s linear;

    .theEdgeImage {
        height: 25px;
        vertical-align: middle;
    }
}

@keyframes TheEdgeHintAppear {
    0% {
        background-color: $silver-grey;
    }
    10% {
        background-color: $light-teal;
    }
    100% {
        background-color: $silver-grey;
    }
}
</style>
