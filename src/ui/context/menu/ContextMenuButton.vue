<template>
    <button
        ref="buttonElement"
        class="context-menu-button"
        @click="onClick"
        @mouseenter="onMouseenter"
    >
        <span>
            <slot />
        </span>
        <span>
            <slot name="right" />
        </span>
    </button>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useGameBusStore } from '@/store/bus.ts'
import { Card } from '@/model/Card.ts'

const gameBus = useGameBusStore()

const { cardAction, closeOnClick } = defineProps<{
    // The action to apply on all selected cards, generally a gameMutation
    cardAction?: (card: Card) => void
    // Should we close the menu after the action
    closeOnClick?: boolean
}>()

const buttonElement = ref<HTMLElement>()

function onClick() {
    if (cardAction) {
        gameBus.contextMenu.cards.forEach(cardAction)
        if (closeOnClick) {
            gameBus.hideContextMenu()
        }
    }
}

// Hide submenu when mouse enters a non-submenu button
function onMouseenter() {
    if (!gameBus.contextMenu.submenu.show) return

    setTimeout(() => {
        if (buttonElement.value && buttonElement.value.matches(':hover')) {
            // Check if this button is inside a context submenu
            const isInsideSubmenu = buttonElement.value.closest('.context-submenu')

            // Check if this button is a submenu button
            const isSubmenuButton = buttonElement.value.classList.contains('submenu-button')

            // Only hide context submenu if the button is NOT inside the submenu AND is NOT a submenu button
            if (!isInsideSubmenu && !isSubmenuButton) {
                gameBus.hideContextSubmenu()
            }
        }
    }, 200)
}
</script>

<style lang="scss">
@use '@/styles/base' as *;

.context-menu-button {
    @extend .game-button;

    display: flex;
    justify-content: space-between;
}
</style>
