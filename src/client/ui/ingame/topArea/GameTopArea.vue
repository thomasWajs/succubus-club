<template>
    <!--
    The v-if handle the case of reconnecting into a multiplayer game,
    and the state is not synced yet.
    In this case, there's no gameState.activePlayer, and that trigger errors.
    -->
    <div
        v-if="!bus.isResyncing"
        v-show="!gameBus.wieldCardStack.show"
        class="game-top-area-wrapper"
        :class="{ 'free-table': gameState.isFreeTable }"
    >
        <button
            v-if="gameState.isFreeTable"
            class="camera-trigger top-area-trigger"
            :title="isCollapsed ? 'Show game controls' : 'Hide game controls'"
            @click="isCollapsed = !isCollapsed"
        >
            {{ isCollapsed ? '▶' : '◀' }}
        </button>

        <div
            v-if="!gameState.isFreeTable || !isCollapsed"
            id="GameTopArea"
            :class="{ 'top-area-positioned': !gameState.isFreeTable }"
            :style="style"
            @pointermove="forwardPointerEvent"
            @pointerdown="forwardPointerEvent"
            @pointerup="forwardPointerEvent"
        >
            <TurnControls />

            <GameControlsBar />

            <CentralBox />
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useBusStore, useGameBusStore } from '@/client/store/bus.ts'
import { TOP_AREA_HEIGHT, TOP_AREA_WIDTH, TOP_AREA_X, WORLD_WIDTH } from '@/shared/const/game.ts'
import { display } from '@/client/game/display.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { WorldAlignment } from '@/client/gateway/db.ts'
import { useUIFeatures } from '@/client/game/composables/useUIFeatures.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import TurnControls from '@/client/ui/ingame/topArea/TurnControls.vue'
import GameControlsBar from '@/client/ui/ingame/topArea/GameControlsBar.vue'
import CentralBox from '@/client/ui/ingame/topArea/CentralBox.vue'

const core = useCoreStore()
const bus = useBusStore()
const gameBus = useGameBusStore()
const gameState = useGameStateStore()

const isCollapsed = ref(false)

const { worldAlignment } = useUIFeatures()

const style = computed(() => {
    const baseStyle = {
        width: `${TOP_AREA_WIDTH}px`,
        maxWidth: `${TOP_AREA_WIDTH}px`,
        height: `${TOP_AREA_HEIGHT}px`,
        maxHeight: `${TOP_AREA_HEIGHT}px`,
        transform: `scale(${display.scale})`,
    }

    if (gameState.isFreeTable) {
        return baseStyle
    }

    let offsetLeft, top
    if (worldAlignment.value == WorldAlignment.TopRight) {
        offsetLeft = display.actualWidth - (WORLD_WIDTH + display.horizontalPadding) * display.scale
        top = 0
    } else {
        offsetLeft = display.horizontalSpaceAvailable / 2
        top = display.verticalSpaceAvailable / 2
    }

    const left = TOP_AREA_X * display.scale + offsetLeft

    return {
        ...baseStyle,
        top: `${top}px`,
        left: `${left}px`,
    }
})

/**
 * Dispatch pointer events to the game.
 * This is overly complicated because of a strange behaviour of Phaser
 * which won't capture some pointer events when some others occured outside the canvas.
 */

let isTrackingMouse = false
function startTrackPointerMove() {
    if (!isTrackingMouse) {
        isTrackingMouse = true
        core.phaserGame.canvas.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
    }
}

function stopTrackPointerMove() {
    if (isTrackingMouse) {
        isTrackingMouse = false
        core.phaserGame.canvas.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
    }
}

function transformEvent(event: PointerEvent) {
    event.preventDefault()
    const game = core.phaserGame
    const newEvent = new PointerEvent(event.type, event)
    // Override the target property to point to the canvas
    Object.defineProperty(newEvent, 'target', {
        value: game.canvas,
        writable: false,
        enumerable: true,
    })
    // game.canvas.dispatchEvent(newEvent) // Needed to get newEvent.target set to canvas
    return { game, newEvent }
}

function onPointerDown(event: PointerEvent) {
    const { game, newEvent } = transformEvent(event)
    startTrackPointerMove()
    // @ts-expect-error - Phaser internal method exists at runtime
    game.input.onMouseDown(newEvent)
}

function onPointerUp(event: PointerEvent) {
    const { game, newEvent } = transformEvent(event)
    stopTrackPointerMove()
    // @ts-expect-error - Phaser internal method exists at runtime
    game.input.onMouseUp(newEvent)
}

function onPointerMove(event: PointerEvent) {
    const { newEvent } = transformEvent(event)
    // @ts-expect-error - Phaser internal method exists at runtime
    core.phaserGame.input.onMouseMove(newEvent)
}

function forwardPointerEvent(event: PointerEvent) {
    switch (event.type) {
        case 'pointerdown':
            onPointerDown(event)
            break
        case 'pointerup':
            onPointerUp(event)
            break
        case 'pointermove':
            onPointerMove(event)
            break
    }
}
</script>

<style lang="scss">
.game-top-area-wrapper {
    display: contents;

    &.free-table {
        position: fixed;
        top: 0;
        left: 0;
        z-index: 1001;
        display: flex;
        flex-direction: row;
        align-items: flex-start;
        gap: 4px;
    }
}

#GameTopArea {
    box-sizing: border-box;
    background-color: transparent;
    padding: 6px 0;
    display: flex;
    flex-direction: column;
    transform-origin: top left;
    overflow: hidden;
}

.top-area-positioned {
    position: absolute;
}
</style>
