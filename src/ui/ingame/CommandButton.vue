<template>
    <button
        class="game-button"
        :disabled="command.isDisabled()"
        @click="command.trigger()"
    >
        <kbd v-if="command.repr">{{ command.repr }}</kbd>
        <slot />
    </button>
</template>

<script setup lang="ts">
import type { Command } from '@/game/composables/useCommands.ts'

defineProps<{
    command: Command
}>()
</script>

<style lang="scss" scoped></style>
