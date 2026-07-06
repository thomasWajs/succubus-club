<template>
    <div
        ref="containerEl"
        class="popup-menu-container"
    >
        <button
            class="game-button popup-menu-trigger"
            @click="toggle"
        >
            <slot name="trigger">
                {{ label }}
            </slot>
            <span class="popup-caret">{{ isOpen ? '&#x25BC;' : '&#x25B2;' }}</span>
        </button>

        <div
            v-if="isOpen"
            class="context-menu popup-menu-panel"
            @mousedown.stop
        >
            <slot />
        </div>
    </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

defineProps<{
    label: string
}>()

const isOpen = ref(false)
const containerEl = ref<HTMLElement>()

function toggle() {
    isOpen.value = !isOpen.value
}

function onClickOutside(event: MouseEvent) {
    if (containerEl.value && !containerEl.value.contains(event.target as Node)) {
        isOpen.value = false
    }
}

onMounted(() => {
    document.addEventListener('pointerdown', onClickOutside)
})

onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onClickOutside)
})
</script>

<style lang="scss">
.popup-menu-container {
    position: relative;
}

.popup-menu-trigger {
    display: flex;
    align-items: center;
    gap: 4px;
}

.popup-caret {
    font-size: 8px;
    line-height: 1;
}

.popup-menu-panel {
    position: absolute;
    bottom: 100%;
    left: 0;
    margin-bottom: 4px;
    min-width: 150px;
    white-space: nowrap;
}
</style>
