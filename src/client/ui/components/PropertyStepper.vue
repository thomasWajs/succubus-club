<template>
    <button
        class="game-button small"
        @click="emit('change', -1)"
    >
        <kbd v-if="decreaseKey">{{ decreaseKey }}</kbd>
        -1
    </button>
    <strong>{{ label ? `${value} ${label}` : value }}</strong>
    <button
        class="game-button small"
        @click="emit('change', +1)"
    >
        +1
        <kbd v-if="increaseKey">{{ increaseKey }}</kbd>
    </button>
</template>

<script setup lang="ts">
/**
 * Dumb -1 / +1 stepper around a numeric game value.
 *
 * It only reports the delta : the caller owns the mutation to dispatch, which
 * is what lets the same stepper drive action properties and referendum votes.
 *
 * `decreaseKey` / `increaseKey` print the keyboard shortcut of each button, so
 * a menu using the stepper still teaches the shortcuts the way a plain menu
 * entry does.
 */
defineProps<{
    value: number | string
    label?: string
    decreaseKey?: string
    increaseKey?: string
}>()

/**
 * Expose/Emit
 */

interface Emits {
    (e: 'change', amount: number): void
}
const emit = defineEmits<Emits>()
</script>
