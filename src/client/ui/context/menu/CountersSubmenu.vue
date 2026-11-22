<template>
    <template v-if="firstCard.isIn.controlled">
        <CommandStepperRow
            label="Green"
            :value="singleCard ? singleCard.greenCounter : '-'"
            :gain="commands.GainGreenCounter"
            :burn="commands.BurnGreenCounter"
            :color="GREEN_COUNTER_FILL_COLOR"
        />

        <CommandStepperRow
            label="Orange"
            :value="singleCard ? singleCard.orangeCounter : '-'"
            :gain="commands.GainOrangeCounter"
            :burn="commands.BurnOrangeCounter"
            :color="ORANGE_COUNTER_FILL_COLOR"
        />

        <CommandStepperRow
            label="Purple"
            :value="singleCard ? singleCard.purpleCounter : '-'"
            :gain="commands.GainPurpleCounter"
            :burn="commands.BurnPurpleCounter"
            :color="PURPLE_COUNTER_FILL_COLOR"
        />
    </template>
</template>

<script setup lang="ts">
/**
 * One stepper per counter color. The count is only shown for a single card :
 * the commands apply to every card of the selection, so no single value stands
 * for a multiple selection.
 *
 * Each row takes the color of its counter on the cards.
 */
import {
    GREEN_COUNTER_FILL_COLOR,
    ORANGE_COUNTER_FILL_COLOR,
    PURPLE_COUNTER_FILL_COLOR,
} from '@/shared/const/game.ts'
import CommandStepperRow from '@/client/ui/context/menu/CommandStepperRow.vue'
import { useGameBusStore } from '@/client/store/bus.ts'
import { useCommands } from '@/client/game/composables/useCommands.ts'
import { useSelection } from '@/client/game/composables/useSelection.ts'

const gameBus = useGameBusStore()
const commands = useCommands()
const { firstCard, singleCard } = useSelection(() => gameBus.contextMenu.cards)
</script>
