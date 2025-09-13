<template>
    <Scene
        key="Play"
        name="Play"
        :autoStart="false"
        @init="init"
        @update="update"
    >
        <HandGO
            v-if="gameState.selfPlayer"
            key="Hand"
        />

        <template v-if="playerSeats.bottomLeft">
            <PlayAreaGO
                key="PlayAreaBottomLeft"
                :player="playerSeats.bottomLeft"
                :scale="OTHER_PLAYERS_SCALE"
                :x="PLAY_AREA_X - OTHER_PLAYERS_GUTTER"
                :y="WORLD_HEIGHT / 2 + GRID_SIZE * 2"
                :rotation="Math.PI / 2"
            />
        </template>

        <template v-if="playerSeats.topLeft">
            <PlayAreaGO
                key="PlayAreaTopLeft"
                :player="playerSeats.topLeft"
                :scale="OTHER_PLAYERS_SCALE"
                :x="PLAY_AREA_X - OTHER_PLAYERS_GUTTER"
                :y="GRID_SIZE / 2"
                :rotation="Math.PI / 2"
            />
        </template>

        <template v-if="playerSeats.topRight">
            <PlayAreaGO
                key="PlayAreaTopRight"
                :player="playerSeats.topRight"
                :scale="OTHER_PLAYERS_SCALE"
                :x="PLAY_AREA_X + PLAY_AREA_WIDTH + OTHER_PLAYERS_GUTTER"
                :y="WORLD_HEIGHT / 2 - GRID_SIZE / 2"
                :rotation="-Math.PI / 2"
            />
        </template>

        <template v-if="playerSeats.bottomRight">
            <PlayAreaGO
                key="PlayAreaBottomRight"
                :player="playerSeats.bottomRight"
                :scale="OTHER_PLAYERS_SCALE"
                :x="PLAY_AREA_X + PLAY_AREA_WIDTH + OTHER_PLAYERS_GUTTER"
                :y="WORLD_HEIGHT + GRID_SIZE"
                :rotation="-Math.PI / 2"
            />
        </template>

        <PlayAreaGO
            v-if="gameState.selfPlayer"
            key="PlayAreaCenter"
            :player="gameState.selfPlayer"
            :x="PLAY_AREA_X"
            :y="PLAY_AREA_Y"
        />

        <ContextMenu v-show="sceneReady" />
        <ContextSubmenu v-show="sceneReady" />
        <WieldCardStack
            v-if="gameBus.wieldCardStack.show"
            :cardRegion="gameBus.wieldCardStack.cardRegion!"
        />

        <!-- Selection Area -->
        <Rectangle
            v-if="gameBus.selectionArea.show"
            :origin="0"
            :x="gameBus.selectionAreaRect.x"
            :y="gameBus.selectionAreaRect.y"
            :width="gameBus.selectionAreaRect.width"
            :height="gameBus.selectionAreaRect.height"
            :lineWidth="SELECTION_AREA_LINE_THICKNESS"
            :strokeColor="SELECTION_AREA_COLOR.color"
            :fillColor="SELECTION_AREA_COLOR.color"
            :fillAlpha="0.075"
        />
    </Scene>
</template>

<script setup lang="ts">
import Phaser from 'phaser'
import { Rectangle, Scene } from 'phavuer'
import { useGameStateStore } from '@/store/gameState.ts'
import {
    OTHER_PLAYERS_GUTTER,
    OTHER_PLAYERS_SCALE,
    PLAY_AREA_WIDTH,
    PLAY_AREA_X,
    PLAY_AREA_Y,
    SELECTION_AREA_COLOR,
    SELECTION_AREA_LINE_THICKNESS,
    GRID_SIZE,
    WORLD_HEIGHT,
} from '@/game/const.ts'
import { useGameBusStore } from '@/store/bus.ts'
import HandGO from '@/game/objects/HandGO.vue'
import PlayAreaGO from '@/game/objects/PlayAreaGO.vue'
import { computed, ref } from 'vue'
import ContextMenu from '@/ui/context/ContextMenu.vue'
import ContextSubmenu from '@/ui/context/ContextSubmenu.vue'
import WieldCardStack from '@/game/objects/WieldCardStack.vue'
import { useCoreStore } from '@/store/core.ts'
import { setupKeyboardHandlers, setupPointerHandlers } from '@/game/input.ts'
import { setupCamera } from '@/game/camera.ts'

const core = useCoreStore()
const gameState = useGameStateStore()
const gameBus = useGameBusStore()

const sceneReady = ref(false)

function init(scene: Phaser.Scene) {
    setupCamera(scene)
    setupPointerHandlers(scene)
    setupKeyboardHandlers(scene)
}

let firstUpdate = true
function update() {
    if (firstUpdate) {
        sceneReady.value = true
        core.phaserIsReady = true
        firstUpdate = false
    }
}

/**
 * Player seating
 */

const playerSeats = computed(() => {
    return {
        bottomLeft: gameState.orderedPlayers.length >= 4 ? gameState.getNthNeighbour(1) : null,
        topLeft:
            gameState.orderedPlayers.length == 2 || gameState.orderedPlayers.length == 3 ?
                gameState.getNthNeighbour(1)
            : gameState.orderedPlayers.length > 3 ? gameState.getNthNeighbour(2)
            : null,
        topRight:
            gameState.orderedPlayers.length == 3 ? gameState.getNthNeighbour(2)
            : gameState.orderedPlayers.length >= 4 ? gameState.getNthNeighbour(3)
            : null,
        bottomRight: gameState.orderedPlayers.length >= 5 ? gameState.getNthNeighbour(4) : null,
    }
})
</script>
