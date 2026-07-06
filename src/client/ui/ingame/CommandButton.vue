<template>
    <button
        class="game-button"
        :disabled="command.isDisabled()"
        @click="command.trigger()"
    >
        <slot />
        <kbd v-if="command.repr">{{ command.repr }}</kbd>
    </button>
</template>

<script setup lang="ts">
import type { Command } from '@/client/game/composables/useCommands.ts'

defineProps<{
    command: Command
}>()
</script>

<style lang="scss" scoped></style>
