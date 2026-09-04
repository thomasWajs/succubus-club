<template>
    <CommandContextMenuButton
        v-if="firstCard.isIn.controlled"
        :command="commands.GainGreenCounter"
    >
        +1 Green Counter
    </CommandContextMenuButton>

    <CommandContextMenuButton
        v-if="firstCard.isIn.controlled"
        :command="commands.BurnGreenCounter"
    >
        -1 Green Counter
    </CommandContextMenuButton>

    <CommandContextMenuButton
        v-if="firstCard.isIn.controlled"
        :command="commands.GainOrangeCounter"
    >
        +1 Orange Counter
    </CommandContextMenuButton>

    <CommandContextMenuButton
        v-if="firstCard.isIn.controlled"
        :command="commands.BurnOrangeCounter"
    >
        -1 Orange Counter
    </CommandContextMenuButton>
</template>

<script setup lang="ts">
import CommandContextMenuButton from '@/client/ui/context/menu/CommandContextMenuButton.vue'
import { useGameBusStore } from '@/client/store/bus.ts'
import { useCommands } from '@/client/game/composables/useCommands.ts'
import { useSelection } from '@/client/game/composables/useSelection.ts'

const gameBus = useGameBusStore()
const commands = useCommands()
const { firstCard } = useSelection(() => gameBus.contextMenu.cards)
</script>

<style lang="scss"></style>
