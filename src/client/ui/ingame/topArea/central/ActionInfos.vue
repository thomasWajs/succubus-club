<template>
    <CentralPanel
        class="action-infos"
        :class="{ 'full-display': fullDisplay }"
    >
        <div class="action-minions">
            <div>
                <span
                    :class="action.minionAction.actingMinion.isCrypt ? 'cryptCard' : 'libraryCard'"
                >
                    {{ action.minionAction.actingMinion.name }} </span
                >:
                <template v-if="action.minionAction.type == MinionActionType.ActionCardFromHand">
                    {{ ActionVerb[action.minionAction.card.type as keyof typeof ActionVerb] + ' ' }}
                </template>

                <strong>{{ actions.getName(action.minionAction) }}</strong>
                <template v-if="action.minionAction.target">
                    {{ ' on ' + selfSecureName(action.minionAction.target) }}
                </template>

                <template
                    v-if="
                        action.minionAction.type == MinionActionType.ActionInPlay &&
                        action.minionAction.card
                    "
                >
                    Provided By
                    {{ action.minionAction.card.name }}
                </template>
            </div>

            <!-- <span>Is directed ? : {{ action.minionAction?.isDirected }}</span> -->
            <!--  <span>Target : {{ action.minionAction.target?.name }}</span> -->
            <div
                v-if="fullDisplay"
                class="blocking-minion"
            >
                <template v-if="blockingMinion">
                    <strong>Block</strong> with
                    <span class="cryptCard">{{ blockingMinion.name }}</span>
                </template>
                <template v-else> No Block </template>
            </div>
        </div>

        <!--
        Stealth / bleed / intercept are shown for every action ( human or bot )
        so any player can adjust them as the action plays out. The block /
        impulse decision below stays bot-only ( fullDisplay ).
        -->
        <div class="action-properties">
            <span class="action-property">
                <PropertyStepper
                    :value="action.stealth"
                    label="Stealth"
                    @change="changeProperty(ActionProperty.stealth, $event)"
                />
            </span>

            <span
                v-if="actions.isBleed(action.minionAction) || actions.isHunt(action.minionAction)"
                class="action-property"
            >
                <PropertyStepper
                    v-if="actions.isBleed(action.minionAction)"
                    :value="action.bleed"
                    label="Bleed"
                    @change="changeProperty(ActionProperty.bleed, $event)"
                />

                <PropertyStepper
                    v-if="actions.isHunt(action.minionAction)"
                    :value="action.hunt"
                    label="Hunt"
                    @change="changeProperty(ActionProperty.hunt, $event)"
                />
            </span>

            <span class="action-property">
                <PropertyStepper
                    :value="action.intercept"
                    label="Intercept"
                    @change="changeProperty(ActionProperty.intercept, $event)"
                />
            </span>
        </div>

        <div class="action-impulse">
            <div class="action-buttons">
                <button
                    v-if="politicalActionCard"
                    class="game-button"
                    @click="callReferendum"
                >
                    Start referendum
                </button>

                <button
                    class="game-button is-danger"
                    @click="gameMutations.ACTION_endAction.actSelf({})"
                >
                    End action
                </button>
            </div>

            <div
                v-if="fullDisplay"
                class="impulse-decision"
            >
                <span class="impulse-player">
                    Impulse
                    <strong
                        :style="{
                            color: action.impulsePlayer?.rgbaColor,
                        }"
                    >
                        {{ action.impulsePlayer?.shortName }}
                    </strong>
                </span>

                <button
                    class="game-button"
                    :disabled="!selfHasImpulse || !selfCanAttemptBlock(gameState)"
                    @click="
                        gameMutations.ACTION_declareBlock.actSelf({
                            blockingMinion: NO_BLOCK,
                        })
                    "
                >
                    No block
                </button>

                <button
                    class="game-button"
                    :disabled="!selfHasImpulse || selfCanAttemptBlock(gameState)"
                    @click="
                        gameMutations.ACTION_declareReaction.actSelf({
                            reaction: NO_REACTION,
                        })
                    "
                >
                    Pass impulse
                </button>
            </div>
        </div>
    </CentralPanel>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { ActionVerb } from '@/shared/const/model.ts'
import { getBlockingMinion, selfCanAttemptBlock } from '@/shared/state/actionState.ts'
import {
    ActionProperty,
    ActionState,
    MinionActionType,
    NO_BLOCK,
    NO_REACTION,
} from '@/shared/types/state.ts'
import * as actions from '@/shared/state/minionActions.ts'
import { selfSecureName } from '@/client/state/self.ts'
import PropertyStepper from '@/client/ui/components/PropertyStepper.vue'
import CentralPanel from '@/client/ui/ingame/topArea/central/CentralPanel.vue'

const props = defineProps<{
    action: ActionState
}>()

const gameState = useGameStateStore()
const players = usePlayersStore()

function changeProperty(propertyName: ActionProperty, amount: number) {
    gameMutations.ACTION_changeProperty.actSelf({ propertyName, amount })
}

const fullDisplay = computed(() => props.action.minionAction.actingMinion.controller.isBot)
const politicalActionCard = computed(() =>
    actions.getPoliticalActionCard(props.action.minionAction),
)

// The political action card is what the referendum is logged as coming from
function callReferendum() {
    const card = politicalActionCard.value
    if (card) {
        gameMutations.REFERENDUM_call.actSelf({ card })
    }
}
const blockingMinion = computed(() => getBlockingMinion(gameState))
const selfHasImpulse = computed(() => props.action.impulsePlayer == players.selfPlayer)
</script>

<style lang="scss">
.central-panel.action-infos {
    // Rows are laid out vertically with generous spacing ; the shared surface
    // provides the outer padding. Stretch the rows so the ones using
    // space-between ( properties, minions ) can spread across the full width.
    align-items: stretch;
    gap: 1rem;

    .cryptCard {
        color: $crypt-orange;
        font-weight: bold;
    }
    .libraryCard {
        color: $library-green;
        font-weight: bold;
    }

    .action-minions {
        display: flex;
        justify-content: center;
        font-size: 20px;

        .blocking-minion {
            min-width: 130px;
        }
    }

    .action-properties {
        display: flex;
        justify-content: space-around;
    }

    .action-property {
        display: inline-flex;
        gap: 0.25rem;
    }

    .action-impulse {
        display: flex;
        justify-content: center;
        align-items: center;

        .action-buttons {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .impulse-decision {
            border: dotted 2px $purple-grey;
            padding: 5px;

            .impulse-player {
                margin-right: 25px;
            }

            button {
                margin-left: 10px;
            }
        }
    }

    &.full-display {
        .action-minions,
        .action-impulse {
            justify-content: space-between;
        }

        .action-minions {
            font-size: 18px;
        }
    }
}
</style>
