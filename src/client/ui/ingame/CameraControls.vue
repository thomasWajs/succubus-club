<template>
    <div
        v-if="gameState.isFreeTable"
        v-show="!gameBus.wieldCardStack.show"
        class="camera-controls"
        :style="{ right: `${rightOffset}px` }"
    >
        <button
            class="camera-trigger"
            :class="{ active: isOpen }"
            title="Camera controls"
            @click="isOpen = !isOpen"
        >
            📷
        </button>

        <div
            v-if="isOpen"
            class="camera-panel"
        >
            <div class="camera-panel-header">
                <h2 class="section-title">Camera</h2>
                <button
                    class="close-button"
                    @click="isOpen = false"
                >
                    ×
                </button>
            </div>

            <div class="controls-list">
                <div class="control-item">
                    <span class="action">🖱️ Wheel</span>
                    <span class="result">Zoom in/out</span>
                </div>
                <div class="control-item">
                    <span class="action">🖱️ Middle-click + Move</span>
                    <span class="result">Pan</span>
                </div>
                <div class="control-item">
                    <span class="action"><kbd>Shift</kbd> + Click + Move</span>
                    <span class="result">Rotate</span>
                </div>
            </div>

            <button
                class="game-button reset-camera-button"
                @click="resetFreeTableCamera"
            >
                Reset Camera
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { display, layout } from '@/client/game/display.ts'
import { resetFreeTableCamera } from '@/client/game/camera.ts'
import { useGameBusStore } from '@/client/store/bus.ts'

const gameState = useGameStateStore()
const gameBus = useGameBusStore()

const isOpen = ref(false)

// Same "flush against the right column's left edge" offset as WieldCardStack's
// rightBase, so the trigger tracks the column's width/visibility.
const rightOffset = computed(() => (display.rightColumnVisible ? layout.rightColumnWidth : 0))
</script>

<style lang="scss">
.camera-controls {
    position: fixed;
    top: 0;
    z-index: 1001;
    display: flex;
    flex-direction: row-reverse;
    align-items: flex-start;
}

.camera-trigger {
    padding: 4px 8px;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;

    border: 2px solid $burgundy-red;
    border-top: none;
    background: $midnight-purple;
    color: $pearl-grey;
    opacity: 0.7;

    &:hover,
    &.active {
        opacity: 1;
    }
}

.camera-panel {
    margin-right: 4px;
    min-width: 280px;
    padding: 8px;

    border: solid 2px $shadow-grey;
    background: $right-column-section-bg;
    color: $shadow-grey;
    font-weight: 600;
}

.camera-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 0.5rem;
    padding-bottom: 0.25rem;
    border-bottom: 2px solid $shadow-grey;

    .section-title {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
    }

    .close-button {
        @include button-grey;
        font-size: 1rem;
        padding: 1px 8px;
        min-width: auto;
    }
}

.controls-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-bottom: 0.75rem;
}

.control-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    background: $silver-grey;
    border-radius: 0.25rem;
    padding: 8px 10px;
    font-size: 13px;

    .action {
        display: flex;
        align-items: center;
        gap: 0.25rem;
    }

    .result {
        font-style: italic;
        font-weight: 600;
        text-align: right;
    }
}

.reset-camera-button {
    width: 100%;
}
</style>
