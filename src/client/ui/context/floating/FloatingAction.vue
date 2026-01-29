<template>
    <div
        class="floating-action"
        :class="{ disabled }"
        :style="style"
        @click="disabled ? null : emit('click')"
    >
        <slot />
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { display } from '@/client/game/display.ts'

const { top, left, translate, disabled } = defineProps<{
    top: number
    left: number
    translate?: string
    disabled?: boolean
}>()

const style = computed(() => {
    let transform = `scale(${display.scale})`
    if (translate) {
        transform += ` ${translate}`
    }
    return {
        top: `${top}px`,
        left: `${left}px`,
        transform,
    }
})

/**
 * Expose/Emit
 */

const emit = defineEmits(['click'])
</script>

<style lang="scss">
.floating-action {
    position: absolute;

    background: $ash-grey;
    color: $ghost-white;

    transform-origin: top left;
    box-sizing: border-box;
    height: 45px;
    padding: 12px 18px;

    box-shadow:
        0 4px 12px rgba(0, 0, 0, 0.4),
        0 2px 6px rgba(0, 0, 0, 0.3),
        inset 0 1px 0 rgba(255, 255, 255, 0.05);

    border: 2px solid rgba($blood-red, 0.2);

    backdrop-filter: blur(10px);

    cursor: pointer;
    user-select: none;

    font-size: 14px;
    letter-spacing: 0.3px;

    z-index: 1049;

    &.disabled {
        background: #505050;
        color: $silver-grey;
        cursor: not-allowed;
    }

    &:hover:not(.disabled) {
        box-shadow:
            0 8px 20px rgba($blood-red, 0.2),
            0 4px 10px rgba(black, 0.4),
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
        border-color: rgba($blood-red, 0.35);
        background: $burgundy-red;

        &::before {
            opacity: 0.25;
        }
    }

    // Optional: Add a subtle glow effect
    &::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        border-radius: 16px;
        background: linear-gradient(135deg, $blood-red, $burgundy-red);
        opacity: 0;
        transition: opacity 0.3s ease;
        z-index: -1;
        filter: blur(12px);
    }
}
</style>
