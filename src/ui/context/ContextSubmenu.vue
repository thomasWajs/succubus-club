<template>
    <!-- Submenu content -->
    <div
        v-if="gameBus.contextMenu.submenu.show && gameBus.contextMenu.submenu.component"
        class="context-menu context-submenu"
        :style="{
            left: gameBus.contextMenu.submenu.x + 'px',
            top: gameBus.contextMenu.submenu.y + 'px',
        }"
    >
        <component :is="gameBus.contextMenu.submenu.component" />
    </div>
</template>

<script setup lang="ts">
import { useGameBusStore } from '@/store/bus.ts'

const gameBus = useGameBusStore()
</script>

<style lang="scss">
.context-submenu {
    width: 150px;
}
</style>
