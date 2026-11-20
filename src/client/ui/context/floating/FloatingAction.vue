<template>
    <div
        class="floating-action"
        :class="{ disabled, small }"
        :style="style"
        @click="disabled ? null : emit('click')"
    >
        <slot />
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getScreenScale } from '@/client/game/utils.ts'

const { top, left, translate, disabled, small } = defineProps<{
    top: number
    left: number
    translate?: string
    disabled?: boolean
    small?: boolean
}>()

const style = computed(() => {
    let transform = `scale(${getScreenScale()})`
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
// Flat : no shadow nor glow, the accent marks the hovered action
.floating-action {
    position: absolute;

    background: var(--ui-floating-bg);
    color: var(--ui-text-on-dark);

    transform-origin: top left;
    box-sizing: border-box;
    height: 45px;
    padding: 12px 18px;

    border: 2px solid var(--ui-floating-border);

    cursor: pointer;
    user-select: none;

    font-size: 14px;
    letter-spacing: 0.3px;

    z-index: 1049;

    &.small {
        height: 26px;
        padding: 4px 5px;
        font-size: 11px;
    }

    &.disabled {
        background: var(--ui-floating-control-bg);
        color: var(--ui-text-on-dark-muted);
        cursor: not-allowed;
    }

    // Blood hint on the light theme, the muted purple accent on the dark one
    &:hover:not(.disabled) {
        border-color: light-dark(rgba($blood-red, 0.35), $ui-accent-border);
        background: light-dark($burgundy-red, $ui-accent);
    }
}
</style>
