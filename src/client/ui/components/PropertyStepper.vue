<template>
    <button
        class="game-button small"
        @click="emit('change', -1)"
    >
        -1
    </button>
    <strong>{{ label ? `${value} ${label}` : value }}</strong>
    <button
        class="game-button small"
        @click="emit('change', +1)"
    >
        +1
    </button>
</template>

<script setup lang="ts">
/**
 * Dumb -1 / +1 stepper around a numeric game value.
 *
 * It only reports the delta : the caller owns the mutation to dispatch, which
 * is what lets the same stepper drive action properties and referendum votes.
 */
defineProps<{
    value: number
    label?: string
}>()

/**
 * Expose/Emit
 */

interface Emits {
    (e: 'change', amount: number): void
}
const emit = defineEmits<Emits>()
</script>
