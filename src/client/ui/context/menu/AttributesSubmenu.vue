<template>
    <div
        v-for="row in rows"
        :key="row.attribute"
        class="attribute-entry"
    >
        <span class="attribute-label">{{ row.label }}</span>
        <PropertyStepper
            :value="row.value"
            @change="changeAttribute(row.attribute, $event)"
        />
    </div>
</template>

<script setup lang="ts">
/**
 * Submenu counterpart of the floating attribute box : one stepper per numeric
 * attribute of the single minion / vampire the context menu targets. Stealth
 * and intercept show for any minion, votes and ballots only for vampires.
 *
 * The steppers keep the submenu open so several nudges land in a row, the same
 * way the counter entries do.
 */
import { computed } from 'vue'
import { useGameBusStore } from '@/client/store/bus.ts'
import { useSelection } from '@/client/game/composables/useSelection.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { CardBaseAttribute } from '@/shared/types/state.ts'
import PropertyStepper from '@/client/ui/components/PropertyStepper.vue'

const gameBus = useGameBusStore()
const { singleCard } = useSelection(() => gameBus.contextMenu.cards)

type AttributeRow = {
    attribute: CardBaseAttribute
    label: string
    value: number
}

const rows = computed<AttributeRow[]>(() => {
    const card = singleCard.value
    if (!card) {
        return []
    }

    const list: AttributeRow[] = []

    if (card.isMinion()) {
        list.push({
            attribute: CardBaseAttribute.Bleed,
            label: 'Bleed',
            value: card.minionAttrs.bleed,
        })
        list.push({
            attribute: CardBaseAttribute.Stealth,
            label: 'Stealth',
            value: card.minionAttrs.stealth,
        })
        list.push({
            attribute: CardBaseAttribute.Intercept,
            label: 'Intercept',
            value: card.minionAttrs.intercept,
        })
        list.push({
            attribute: CardBaseAttribute.Strength,
            label: 'Strength',
            value: card.minionAttrs.strength,
        })
    }

    if (card.isVampire()) {
        list.push({
            attribute: CardBaseAttribute.Hunt,
            label: 'Hunt',
            value: card.vampireAttrs.hunt,
        })
        list.push({
            attribute: CardBaseAttribute.Vote,
            label: 'Votes',
            value: card.vampireAttrs.vote,
        })
        list.push({
            attribute: CardBaseAttribute.Ballot,
            label: 'Ballots',
            value: card.vampireAttrs.ballot,
        })
    }

    return list
})

function changeAttribute(attribute: CardBaseAttribute, amount: number) {
    const card = singleCard.value
    if (card) {
        gameMutations.changeCardAttribute.actSelf({ card, attribute, amount })
    }
}
</script>

<style lang="scss">
// A four-column grid so the buttons line up across every row : the label takes
// the leftover width, then the -1 button, the value, and the +1 button each sit
// in a fixed track. Scoped under .context-submenu to outweigh the flat
// .context-menu .game-button treatment, which would otherwise hide that these
// are buttons.
.context-submenu .attribute-entry {
    display: grid;
    grid-template-columns: 1fr auto minmax(2ch, auto) auto;
    align-items: center;
    column-gap: 8px;
    padding: 3px 5px;

    color: white;

    .attribute-label {
        font-size: 13px;
        font-weight: 600;
    }

    // Centered so a two-digit count doesn't push the +1 button out of line
    strong {
        text-align: center;
    }

    // Restore a proper button look : bordered, filled, and lighting up on hover
    .game-button {
        margin: 0;
        min-width: 34px;
        padding: 2px 0;
        text-align: center;

        border: 1px solid $silver-grey;
        background: $dark-teal;
        color: white;
        cursor: pointer;

        &:hover {
            filter: brightness(1.25);
        }
    }
}
</style>
