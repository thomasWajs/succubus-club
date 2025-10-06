<template>
    <ContextMenuButton
        ref="buttonComponent"
        class="submenu-button"
        :closeOnClick="false"
        :disabled="disabled"
        @mouseenter="showSubmenu"
        @click="showSubmenu"
    >
        <slot />
        <template #right><span class="caret">❯</span></template>
    </ContextMenuButton>
</template>

<script setup lang="ts">
import ContextMenuButton from '@/ui/context/ContextMenuButton.vue'
import { useGameBusStore } from '@/store/bus.ts'
import { Component, ref, markRaw } from 'vue'
import { positionContextMenu } from '@/game/utils.ts'

const gameBus = useGameBusStore()

const { submenuComponent, disabled } = defineProps<{
    submenuComponent: Component // Vue component for submenu content
    disabled?: boolean
}>()

const buttonComponent = ref<typeof ContextMenuButton>()

function calculateSubmenuPosition() {
    if (!buttonComponent.value || disabled) return

    const rect = buttonComponent.value.$el.getBoundingClientRect()

    gameBus.contextMenu.submenu.show = true

    const setXY = (x: number, y: number) => {
        gameBus.contextMenu.submenu.x = x
        gameBus.contextMenu.submenu.y = y
    }

    positionContextMenu(
        rect.right + 5, // 5px gap from the button
        rect.top,
        rect.bottom,
        '.context-submenu',
        setXY,
    )
}

function showSubmenu() {
    if (!gameBus.contextMenu.submenu.show && !disabled) {
        gameBus.contextMenu.submenu.component = markRaw(submenuComponent)
        calculateSubmenuPosition()
    }
}
</script>

<style lang="scss">
.caret {
    font-size: 1rem;
    color: $silver-grey;
    margin-right: 6px;
}
</style>
