<template>
    <CommandButton
        class="next-turn"
        :command="commands.AdvanceTurn"
    >
        Next Turn
    </CommandButton>
</template>

<script setup lang="ts">
import { useCommands } from '@/client/game/composables/useCommands.ts'
import CommandButton from '@/client/ui/ingame/CommandButton.vue'

const commands = useCommands()
</script>

<style lang="scss">
.next-turn {
    align-self: center;
    border-width: 2px;
    padding: 14px 26px;
    font-weight: bold;

    kbd {
        font-size: 18px;
        margin-right: 8px;
    }
}
</style>
