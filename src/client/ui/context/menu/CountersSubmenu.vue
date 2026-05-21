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
import { useContextSelection } from '@/client/ui/context/menu/useContextSelection.ts'
import CommandContextMenuButton from '@/client/ui/context/menu/CommandContextMenuButton.vue'

const { commands, firstCard } = useContextSelection()
</script>

<style lang="scss"></style>
