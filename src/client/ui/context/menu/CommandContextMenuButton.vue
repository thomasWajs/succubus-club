<template>
    <ContextMenuButton
        :cardAction="command.cardAction"
        :disabled="command.isDisabled()"
        :closeOnClick="closeOnClick"
    >
        <slot>
            {{ command.label }}
        </slot>

        <template #right>
            <kbd v-if="command.repr">{{ command.repr }}</kbd>
        </template>
    </ContextMenuButton>
</template>

<script setup lang="ts">
import ContextMenuButton from '@/client/ui/context/menu/ContextMenuButton.vue'
import { Command } from '@/client/game/composables/useCommands.ts'

const { command, closeOnClick } = defineProps<{
    command: Command
    closeOnClick?: boolean
}>()
</script>

<style lang="scss"></style>
