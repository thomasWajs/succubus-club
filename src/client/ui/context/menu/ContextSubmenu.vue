<template>
    <!-- Submenu content -->
    <div
        v-if="gameBus.contextMenu.submenu.show && gameBus.contextMenu.submenu.component"
        class="context-menu context-submenu"
        :style="{
            left: gameBus.contextMenu.submenu.x + 'px',
            top: gameBus.contextMenu.submenu.y + 'px',
        }"
        @mousedown="onMouseDown"
        @mouseup="onMouseUp"
        @touchstart.stop
    >
        <component :is="gameBus.contextMenu.submenu.component" />
    </div>
</template>

<script setup lang="ts">
import { useGameBusStore } from '@/client/store/bus.ts'
import { useCanvasShield } from '@/client/game/composables/useCanvasShield.ts'

const gameBus = useGameBusStore()
const { onMouseDown, onMouseUp } = useCanvasShield()
</script>
