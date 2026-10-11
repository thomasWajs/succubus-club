<template>
    <template v-if="pending">
        <!-- The allocation of points under way, answered whole -->
        <CentralPanel
            v-if="allocation"
            class="engine-choices"
            title="Referendum terms"
        >
            <div
                v-if="pending.prompt"
                class="engine-choices-prompt"
            >
                <EngineText :text="pending.prompt" />
            </div>
            <div class="engine-choices-hint">
                Allocate {{ allocation.points }} points{{
                    allocation.min_nonzero > 1 ? ` among ${allocation.min_nonzero} or more` : ''
                }}
            </div>
            <div
                v-for="(recipient, i) in allocation.recipients"
                :key="i"
                class="engine-choices-row"
                @mouseenter="hoverRecipient(i)"
                @mouseleave="hoverEngineCard(null)"
            >
                <span class="engine-choices-name">{{ recipient.name }}</span>
                <button
                    class="game-button small"
                    :disabled="amounts[i] == 0"
                    @click="amounts[i]--"
                >
                    −
                </button>
                <strong class="engine-choices-amount">{{ amounts[i] }}</strong>
                <button
                    class="game-button small"
                    :disabled="left == 0 || amounts[i] >= (recipient.cap ?? Infinity)"
                    @click="amounts[i]++"
                >
                    +
                </button>
            </div>
            <button
                class="game-button"
                :disabled="!!allocationProblem"
                @click="allocate()"
            >
                {{ allocationProblem || 'Allocate' }}
            </button>
        </CentralPanel>

        <!-- All the votes one way : a standing order for the polling ; the Edge's and the card's -->
        <CentralPanel
            v-if="pending.votes || methuselahVotes.length > 0"
            class="engine-choices"
        >
            <div
                v-if="pending.votes"
                class="engine-choices-buttons"
            >
                <button
                    v-if="pending.votes.favor > 0"
                    class="game-button"
                    @click="voteAllEngine(true)"
                >
                    All my votes in favour ( {{ pending.votes.favor }} )
                </button>
                <button
                    v-if="pending.votes.against > 0"
                    class="game-button"
                    @click="voteAllEngine(false)"
                >
                    All my votes against ( {{ pending.votes.against }} )
                </button>
            </div>
            <!-- The votes no vampire casts : the Edge's, the political action card's -->
            <div
                v-if="methuselahVotes.length > 0"
                class="engine-choices-buttons"
            >
                <button
                    v-for="option in methuselahVotes"
                    :key="option.index"
                    class="game-button"
                    @click="choose(option)"
                >
                    {{ option.text }}
                </button>
            </div>
            <div
                v-if="pending.votes"
                class="engine-choices-hint"
            >
                Play cards first : a vampire's bonus votes count only before it votes.
            </div>
        </CentralPanel>

        <!-- A value for X -->
        <CentralPanel
            v-if="xValues.length > 0"
            class="engine-choices"
            title="Choose X"
        >
            <div class="engine-choices-row">
                <button
                    class="game-button small"
                    :disabled="xAt == 0"
                    @click="xAt--"
                >
                    −
                </button>
                <strong class="engine-choices-amount">{{ xValues[xAt]?.amount }}</strong>
                <button
                    class="game-button small"
                    :disabled="xAt >= xValues.length - 1"
                    @click="xAt++"
                >
                    +
                </button>
                <button
                    class="game-button"
                    @click="choose(xValues[xAt])"
                >
                    {{ xValues[xAt]?.text }}
                </button>
            </div>
        </CentralPanel>

        <!-- The steps of a combat ( and what follows a block ), the cards to play or use then -->
        <CentralPanel
            v-if="combatOptions.length > 0 || pending.combat"
            class="engine-choices"
            :title="combatTitle"
        >
            <!-- Each side : its strike, once declared ( the opponent's, to answer it ), what it has -->
            <div
                v-if="pending.combat && pending.combat.sides.length > 0"
                class="engine-combat-sides"
            >
                <div
                    v-for="(side, i) in pending.combat.sides"
                    :key="i"
                    class="engine-combat-side"
                    :class="{ own: side.own, opponent: !side.own }"
                >
                    <span class="engine-combat-name">{{ side.name }}</span>
                    <span
                        v-if="side.strike"
                        class="engine-combat-strike"
                        >{{ side.strike }}</span
                    >
                    <span
                        v-else
                        class="engine-combat-choosing"
                        >choosing…</span
                    >
                    <span
                        v-if="side.maneuvers > 0 || side.presses > 0"
                        class="engine-combat-banked"
                    >
                        {{ banked(side) }}
                    </span>
                </div>
            </div>
            <div class="engine-choices-buttons">
                <button
                    v-for="option in combatOptions"
                    :key="option.index"
                    class="game-button"
                    @click="choose(option)"
                    @mouseenter="hoverEngineCard(engineOptionCards(option)[0])"
                    @mouseleave="hoverEngineCard(null)"
                >
                    {{ option.text }}
                </button>
                <!-- A strike from a weapon, a card from hand : its choice goes on in the central box -->
                <button
                    v-for="choice in pending.combat ? cards : []"
                    :key="choice.key"
                    class="game-button"
                    @click="stage(choice)"
                    @mouseenter="hoverEngineCard(choice.card)"
                    @mouseleave="hoverEngineCard(null)"
                >
                    {{ choice.label }}
                </button>
            </div>
            <div
                v-if="pending.combat && cards.length == 0"
                class="engine-choices-hint"
            >
                Strike cards and maneuvers from your hand glow : click or drag them.
            </div>
        </CentralPanel>

        <!-- During an action : the cards to play or use now ( a modifier, a reaction… ) -->
        <CentralPanel
            v-if="!pending.combat && cards.length > 0"
            class="engine-choices"
            :title="pending.window"
        >
            <div class="engine-choices-buttons">
                <button
                    v-for="choice in cards"
                    :key="choice.key"
                    class="game-button small"
                    @click="stage(choice)"
                    @mouseenter="hoverEngineCard(choice.card)"
                    @mouseleave="hoverEngineCard(null)"
                >
                    {{ choice.label }}
                </button>
            </div>
        </CentralPanel>

        <!-- What nothing else answers : a search, an exchange, a cost, a draw alternative… -->
        <CentralPanel
            v-if="leftovers.length > 0"
            class="engine-choices"
            :title="pending.window"
        >
            <div
                v-if="pending.prompt"
                class="engine-choices-prompt"
            >
                <EngineText :text="pending.prompt" />
            </div>
            <div class="engine-choices-buttons">
                <button
                    v-for="option in leftovers"
                    :key="option.index"
                    class="game-button small"
                    @click="choose(option)"
                    @mouseenter="hoverEngineCard(engineOptionCards(option)[0])"
                    @mouseleave="hoverEngineCard(null)"
                >
                    {{ option.text }}
                </button>
            </div>
        </CentralPanel>
    </template>
</template>

<script setup lang="ts">
/**
 * The choices of a game with the rules engine that are no card of the table,
 * in the central box : an allocation of points, all the votes one way, a value
 * for X, the steps of a combat, and what nothing else answers ( leftoverOptions ). The rest is
 * on the table ( see engine/interaction.ts ), and every option in the console.
 */
import { computed, ref, watch } from 'vue'
import { hoverEngineCard } from '@/client/engine/cardNames.ts'
import EngineText from '@/client/ui/ingame/EngineText.vue'
import CentralPanel from '@/client/ui/ingame/topArea/central/CentralPanel.vue'
import { EngineCombatSideView, useEngineStore } from '@/client/store/engine.ts'
import {
    allocateEngine,
    chooseEngineOption,
    engineOptionCards,
    voteAllEngine,
} from '@/client/engine/driver.ts'
import {
    cardChoices,
    combatOptions as combatOf,
    leftoverOptions,
    methuselahVoteOptions,
    narrowStaging,
    StagingChoice,
    xOptions,
} from '@/client/engine/interaction.ts'
import { EngineOption } from '@/client/engine/protocol.ts'

const engine = useEngineStore()

const pending = computed(() => engine.pending)
const leftovers = leftoverOptions
const methuselahVotes = methuselahVoteOptions

// The allocation of points under way : the amounts per recipient, all 0 at first
const allocation = computed(() => pending.value?.allocation)
const amounts = ref<number[]>([])
watch(
    allocation,
    current => {
        amounts.value = current?.recipients.map(() => 0) ?? []
    },
    { immediate: true },
)
const left = computed(
    () => (allocation.value?.points ?? 0) - amounts.value.reduce((sum, n) => sum + n, 0),
)
// Why the amounts can't be allocated yet, if they can't
const allocationProblem = computed(() => {
    const current = allocation.value
    if (!current) {
        return ''
    }
    if (left.value > 0) {
        return `${left.value} ${left.value == 1 ? 'point' : 'points'} left`
    }
    const given = amounts.value.filter(n => n > 0).length
    if (given < current.min_nonzero) {
        return `Points to ${current.min_nonzero} of them at least`
    }
    return ''
})

function allocate() {
    if (!allocationProblem.value) {
        hoverEngineCard(null)
        allocateEngine([...amounts.value])
    }
}

// Show on the table the card a recipient is ( a location or an equipment )
function hoverRecipient(i: number) {
    const card = allocation.value?.recipients[i].card
    hoverEngineCard(
        card ? engineOptionCards({ index: -1, kind: 'allocate_to_card', text: '', card })[0] : null,
    )
}

const xValues = computed(() => xOptions(pending.value?.options ?? []))
const xAt = ref(0)
watch(xValues, () => (xAt.value = 0))

const combatOptions = computed(() => combatOf(pending.value?.options ?? []))

// What a side has for the round
function banked(side: EngineCombatSideView): string {
    const parts = []
    if (side.maneuvers > 0) {
        parts.push(`${side.maneuvers} maneuver${side.maneuvers > 1 ? 's' : ''}`)
    }
    if (side.presses > 0) {
        parts.push(`${side.presses} press${side.presses > 1 ? 'es' : ''}`)
    }
    return parts.join(', ')
}
const combatTitle = computed(() => {
    const combat = pending.value?.combat
    return combat ?
            `${combat.minions[0]} vs ${combat.minions[1]} — round ${combat.round}, ${combat.range} range`
        :   'After the block'
})

// The cards to play or use now, during a combat or an action ( see cardChoices )
const cards = computed(() => cardChoices(pending.value?.options ?? []))

// A card's choice, as a click on the card starts it ( a single option is taken )
function stage(choice: StagingChoice) {
    hoverEngineCard(null)
    narrowStaging(choice.options)
}

function choose(option: EngineOption) {
    hoverEngineCard(null)
    chooseEngineOption(option.index)
}
</script>

<style lang="scss">
.central-panel.engine-choices {
    gap: 6px;

    // What the allocation is for : the panel's question
    .engine-choices-prompt {
        font-size: 15px;
        font-weight: bold;
        text-align: center;
    }

    .engine-choices-hint {
        font-size: 14px;
    }

    .engine-choices-row {
        display: flex;
        align-items: center;
        gap: 6px;
    }

    .engine-choices-name {
        min-width: 8rem;
    }

    .engine-choices-amount {
        min-width: 1.5em;
        text-align: center;
    }

    // The combat's sides, the acting minion first : the opponent's strike stands out
    .engine-combat-sides {
        align-self: stretch;
        display: flex;
        justify-content: center;
        gap: 12px;
        font-size: 14px;
    }

    .engine-combat-side {
        display: flex;
        flex-direction: column;
        align-items: center;
        min-width: 0;
        flex: 1 1 0;
        padding: 3px 8px;
        border: 1px solid rgba($shadow-grey, 0.4);

        .engine-combat-name {
            font-weight: bold;
        }

        .engine-combat-choosing {
            font-style: italic;
            opacity: 0.7;
        }

        .engine-combat-banked {
            font-size: 12px;
        }

        &.opponent .engine-combat-strike {
            font-size: 16px;
            font-weight: bold;
            color: $crimson-red;
        }
    }

    .engine-choices-buttons {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 6px;
    }
}
</style>
