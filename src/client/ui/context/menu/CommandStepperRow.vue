<template>
    <div
        class="stepper-entry"
        :style="color ? { color } : undefined"
    >
        <span class="stepper-label">{{ label }}</span>
        <PropertyStepper
            :value="value"
            :decreaseKey="burn.repr"
            :increaseKey="gain.repr"
            @change="onChange"
        />
    </div>
</template>

<script setup lang="ts">
/**
 * Context menu row stepping a card value with a pair of commands. A click
 * applies the matching command to every card of the context menu, and the
 * shortcut of each command is printed in its button.
 *
 * The menu stays open so several nudges land in a row.
 *
 * `color` tints the label and the value ; the buttons keep their own colors.
 */
import PropertyStepper from '@/client/ui/components/PropertyStepper.vue'
import { useGameBusStore } from '@/client/store/bus.ts'
import { Command } from '@/client/game/composables/useCommands.ts'

const { gain, burn } = defineProps<{
    label: string
    value: number | string
    gain: Command
    burn: Command
    color?: string
}>()

const gameBus = useGameBusStore()

function onChange(amount: number) {
    const command = amount > 0 ? gain : burn
    gameBus.contextMenu.cards.forEach(command.cardAction)
}
</script>
