<template>
    <ContextMenuButton
        :cardAction="command.cardAction"
        :disabled="command.isDisabled()"
        :closeOnClick="closeOnClick"
    >
        <slot />

        <template #right>
            <kbd>{{ command.repr }}</kbd>
        </template>
    </ContextMenuButton>
</template>

<script setup lang="ts">
import ContextMenuButton from '@/ui/context/ContextMenuButton.vue'
import { Command } from '@/game/composables/useCommands.ts'

const { command, closeOnClick } = defineProps<{
    command: Command
    closeOnClick?: boolean
}>()
</script>

<style lang="scss"></style>
