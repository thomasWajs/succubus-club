<template>
    <div
        v-show="!core.gameIsReady"
        class="loading-screen"
    >
        <div class="loading-container">
            <div class="loading-symbol">
                <div class="vampiric-ankh">☥</div>
            </div>
            <div class="loading-text">Loading</div>
            <div class="loading-ellipsis">
                <span>.</span>
                <span>.</span>
                <span>.</span>
            </div>
        </div>
    </div>

    <!--
    Wait for the game state to be ready, so can load card images correctly.
    This is only needed when joining a loaded multiplayer game.
    -->
    <div
        v-if="core.gameStateIsReady"
        v-show="core.gameIsReady"
        id="Game"
        @click="onClick"
    >
        <!-- <TopBar /> -->
        <Tabletop />
        <GameGameRightColumn />
        <GameTopArea />
    </div>
</template>

<script setup lang="ts">
import Tabletop from '@/game/Tabletop.vue'
import GameGameRightColumn from '@/ui/ingame/rightColumn/GameRightColumn.vue'
import { useGameBusStore } from '@/store/bus.ts'
import GameTopArea from '@/ui/ingame/GameTopArea.vue'
import { useCoreStore } from '@/store/core.ts'

const core = useCoreStore()
const gameBus = useGameBusStore()

function onClick(event: Event) {
    if (
        gameBus.changePool.show &&
        event.target instanceof Element &&
        event.target.id != 'PoolSelector'
    ) {
        gameBus.changePool.show = false
    }

    if (
        gameBus.changeTheEdge.show &&
        event.target instanceof Element &&
        event.target.id != 'TheEdgeSelector'
    ) {
        gameBus.changeTheEdge.show = false
    }
}
</script>

<style lang="scss" scoped>
#Game {
    width: 100%;
    height: 100vh;
    overflow: hidden;
    display: flex;
    color: $shadow-grey;
}

.loading-screen {
    @include flex-center;

    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;

    z-index: 1000;
}

.loading-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2rem;
    z-index: 1;
}

.loading-symbol {
    position: relative;
}

.vampiric-ankh {
    font-size: 6rem;
    color: $ghost-white;
    text-shadow:
        0 0 20px rgba($ghost-white, 0.5),
        2px 2px 4px rgba(black, 0.8);
    animation: gothic-pulse 2s ease-in-out infinite;
    font-family: serif;
    font-weight: bold;
}

.loading-text {
    font-size: 1.8rem;
    color: $ghost-white;
    font-family: serif;
    font-weight: 300;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    text-shadow: 2px 2px 4px rgba(black, 0.8);
    opacity: 0.9;
}

.loading-ellipsis {
    display: flex;
    gap: 0.3rem;
    margin-top: -1rem;

    span {
        font-size: 2rem;
        color: $mist-grey;
        animation: ellipsis-fade 1.5s ease-in-out infinite;
        font-family: serif;
        text-shadow: 1px 1px 2px rgba(black, 0.8);

        &:nth-child(2) {
            animation-delay: 0.3s;
        }

        &:nth-child(3) {
            animation-delay: 0.6s;
        }
    }
}

@keyframes gothic-pulse {
    0%,
    100% {
        transform: scale(1);
        opacity: 0.8;
    }
    50% {
        transform: scale(1.05);
        opacity: 1;
        text-shadow:
            0 0 30px rgba($ghost-white, 0.8),
            2px 2px 4px rgba(black, 0.8);
    }
}

@keyframes ellipsis-fade {
    0%,
    80%,
    100% {
        opacity: 0.3;
    }
    40% {
        opacity: 1;
    }
}
</style>
