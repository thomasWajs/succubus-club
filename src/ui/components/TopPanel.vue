<template>
    <Transition
        name="slide-down"
        appear
    >
        <div
            v-if="isOpen"
            class="top-panel-overlay"
            @click="handleOverlayClick"
        >
            <div
                class="top-panel"
                @click.stop
            >
                <div class="top-panel-header">
                    <div class="top-panel-title">
                        <slot name="title" />
                    </div>
                    <button
                        class="close-button"
                        @click="closePanel"
                    >
                        ×
                    </button>
                </div>
                <div class="top-panel-content">
                    <slot />
                </div>
            </div>
        </div>
    </Transition>
</template>

<script setup lang="ts">
import { watch } from 'vue'

interface Props {
    isOpen: boolean
    closeOnOverlayClick?: boolean
}

const props = withDefaults(defineProps<Props>(), {
    closeOnOverlayClick: true,
})

interface Emits {
    (e: 'close'): void
    (e: 'open'): void
}

const emit = defineEmits<Emits>()

// Watch for isOpen prop changes and emit 'open' when it becomes true
watch(
    () => props.isOpen,
    (newValue, oldValue) => {
        if (newValue && !oldValue) {
            emit('open')
        }
    },
)

const closePanel = () => {
    emit('close')
}

const handleOverlayClick = () => {
    if (props.closeOnOverlayClick) {
        closePanel()
    }
}
</script>
<style lang="scss" scoped>
.top-panel-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(black, 0.8);
    z-index: 1000;
    display: flex;
    justify-content: center;
    align-items: start;
}

.top-panel {
    @include panel;
    border-top: none;
    border-bottom-left-radius: 0.25rem;
    border-bottom-right-radius: 0.25rem;
    width: 100%;
    height: 100%;
    max-width: 80vw;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;

    @media (max-height: 800px) {
        max-height: 95vh;
    }
}

.top-panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 0 1rem 0;
    border-bottom: 1px solid $bone-grey;
    flex-shrink: 0;
}

.top-panel-title {
    flex: 1;
    font-size: 1.25rem;
    font-weight: 300;
    color: $pearl-grey;
    font-family: serif;
    letter-spacing: 0.5px;
}

.close-button {
    @include button-grey;
    font-size: 1.2rem;
    padding: 0.5rem 0.75rem;
    min-width: auto;
}

.top-panel-content {
    flex: 1;
    padding: 1rem 0 0 0;
    overflow-y: auto;
    color: $pearl-grey;
}

// Slide down transition
.slide-down-enter-active,
.slide-down-leave-active {
    transition: all 0.3s ease-out;
}

.slide-down-enter-active .top-panel,
.slide-down-leave-active .top-panel {
    transition: transform 0.3s ease-out;
}

.slide-down-enter-from {
    opacity: 0;
}

.slide-down-enter-from .top-panel {
    transform: translateY(-100%);
}

.slide-down-leave-to {
    opacity: 0;
}

.slide-down-leave-to .top-panel {
    transform: translateY(-100%);
}
</style>
