<template>
    <CentralPanel
        class="action-infos"
        :class="{ 'bot-display': botDisplay }"
    >
        <div class="action-minions">
            <div class="acting-minion">
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
            <div class="blocking-minion">
                <template v-if="blockingDecisions.length">
                    <div
                        v-for="decision in blockingDecisions"
                        :key="decision.player.oid"
                        class="block-decision"
                    >
                        <strong
                            class="inline-player-name block-decision-player"
                            :style="{ backgroundColor: decision.player.rgbaColor }"
                        >
                            {{ decision.player.shortName }}
                        </strong>
                        <template v-if="decision.minionName">
                            <strong>Block</strong> with
                            <span class="cryptCard">{{ decision.minionName }}</span>
                        </template>
                        <strong v-else> No Block </strong>
                    </div>
                </template>
                <div
                    v-else
                    class="waiting-block-decision"
                >
                    No block declaration
                </div>
            </div>
        </div>

        <!--
        Stealth / bleed / intercept are shown for every action ( human or bot )
        so any player can adjust them as the action plays out. The block state
        and the No block button are shown to every non-active player too ; only
        the impulse sequencing below stays bot-only ( fullDisplay ).
        -->
        <div class="action-properties">
            <span class="action-property">
                <PropertyStepper
                    :value="action.stealth"
                    label="Stealth"
                    @change="changeProperty(ActionProperty.Stealth, $event)"
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
                    @change="changeProperty(ActionProperty.Bleed, $event)"
                />

                <PropertyStepper
                    v-if="actions.isHunt(action.minionAction)"
                    :value="action.hunt"
                    label="Hunt"
                    @change="changeProperty(ActionProperty.Hunt, $event)"
                />
            </span>

            <!--
            Kept in the flow but only made visible once a minion attempts the
            block, so revealing it does not shift the other steppers.
            -->
            <span
                class="action-property"
                :style="{ visibility: hasBlockingMinion ? 'visible' : 'hidden' }"
            >
                <PropertyStepper
                    :value="action.intercept"
                    label="Intercept"
                    @change="changeProperty(ActionProperty.Intercept, $event)"
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
                    v-if="payableActionCard"
                    class="game-button"
                    @click="payActionCost"
                >
                    Pay action cost
                </button>

                <button
                    class="game-button is-danger"
                    @click="gameMutations.ACTION_endAction.actSelf({})"
                >
                    End action
                </button>
            </div>

            <div
                v-if="botDisplay || selfCanAttemptBlock()"
                class="impulse-decision"
            >
                <span
                    v-if="botDisplay"
                    class="impulse-player"
                >
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
                    v-if="selfCanAttemptBlock()"
                    :disabled="botDisplay && selfDeclinedBlock"
                    class="game-button"
                    @click="
                        gameMutations.ACTION_declareBlock.actSelf({
                            block: NO_BLOCK,
                        })
                    "
                >
                    No block
                </button>

                <button
                    v-if="botDisplay"
                    class="game-button"
                    :disabled="!selfHasImpulse || !selfCanAttemptBlock()"
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
import { usePlayersStore } from '@/client/state/players.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { ACTION_TYPES, ActionVerb } from '@/shared/const/model.ts'
import {
    ActionProperty,
    ActionState,
    MinionActionType,
    NO_BLOCK,
    NO_REACTION,
} from '@/shared/types/state.ts'
import * as actions from '@/shared/state/minionActions.ts'
import { selfCanAttemptBlock, selfSecureName } from '@/client/state/self.ts'
import PropertyStepper from '@/client/ui/components/PropertyStepper.vue'
import CentralPanel from '@/client/ui/ingame/topArea/central/CentralPanel.vue'
import { getBlockingDecision } from '@/shared/state/actionState.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { LibraryCard } from '@/shared/model/Card.ts'
import { useUIFeatures } from '@/client/game/composables/useUIFeatures.ts'
import { useGameBusStore } from '@/client/store/bus.ts'

const props = defineProps<{
    action: ActionState
}>()

const gameState = useGameStateStore()
const players = usePlayersStore()
const gameBus = useGameBusStore()
const { automaticCostPaymentEnabled } = useUIFeatures()

function changeProperty(propertyName: ActionProperty, amount: number) {
    gameMutations.ACTION_changeProperty.actSelf({ propertyName, amount })
}

/**
 * "Automatic cost payment" preference ( experimental ) : action cards.
 *
 * An action's cost is paid only if it goes through ( unblocked ), so it cannot
 * be paid automatically. Instead the acting player gets a "Pay action cost"
 * button that spends the cost and shows the floating indicator above the card.
 */

// The action's card when it is an action card ( ACTION_TYPES ) with a cost the
// self player ( the acting controller ) can pay by hand.
const payableActionCard = computed<LibraryCard | null>(() => {
    if (!automaticCostPaymentEnabled.value) {
        return null
    }

    const minionAction = props.action.minionAction
    if (
        minionAction.type != MinionActionType.ActionCardFromHand ||
        minionAction.actingMinion.controller.oid != players.selfPlayer?.oid
    ) {
        return null
    }

    const card = minionAction.card
    if (!(card instanceof LibraryCard) || !card.type || !ACTION_TYPES.includes(card.type)) {
        return null
    }

    if (card.bloodCost <= 0 && card.poolCost <= 0) {
        return null
    }

    return card
})

function payActionCost() {
    const card = payableActionCard.value
    if (!card) {
        return
    }

    const actingMinion = props.action.minionAction.actingMinion
    // Only the costs actually spent are shown : a mutation is rejected when the
    // minion has not enough blood or the player not enough pool.
    const bloodPaid =
        card.bloodCost > 0 &&
        gameMutations.changeBlood.actSelf({ card: actingMinion, amount: -card.bloodCost }).isValid
    const poolPaid =
        card.poolCost > 0 &&
        gameMutations.changePool.actSelf({
            player: actingMinion.controller,
            amount: -card.poolCost,
        }).isValid
    gameBus.showCardCost(card.oid, bloodPaid ? card.bloodCost : 0, poolPaid ? card.poolCost : 0)
}

const botDisplay = computed(() => props.action.minionAction.actingMinion.controller.isBot)
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
const selfHasImpulse = computed(() => props.action.impulsePlayer == players.selfPlayer)
const selfDeclinedBlock = computed(
    () =>
        !!players.selfPlayer &&
        getBlockingDecision(gameState, players.selfPlayer)?.block == NO_BLOCK,
)

// Every recorded block decision, flattened for display : the declaring player
// and the blocking minion name, or null when they declined.
const blockingDecisions = computed(() =>
    props.action.blockingDecisions.map(decision => ({
        player: decision.player,
        minionName: decision.block === NO_BLOCK ? null : decision.block.name,
    })),
)

// The intercept only matters once a minion is actually attempting the block.
const hasBlockingMinion = computed(() =>
    blockingDecisions.value.some(decision => decision.minionName !== null),
)
</script>

<style lang="scss">
.central-panel.action-infos {
    // Rows are laid out vertically with generous spacing ; the shared surface
    // provides the outer padding. Stretch the rows so the ones using
    // space-between ( properties, minions ) can spread across the full width.
    align-items: stretch;
    gap: 1rem;
    padding: 0.5rem;

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
        font-size: 18px;
        gap: 0.5rem;

        // Fixed 50 - 50 split, independent of content : flex-basis 0 with equal
        // grow, and min-width 0 so a growing block list never widens the column.
        .acting-minion {
            flex: 1 1 0;
            min-width: 0;
        }

        .blocking-minion {
            flex: 1 1 0;
            min-width: 0;
            border-left: solid 1px rgba($shadow-grey, 0.4);
            padding-left: 0.5rem;
            text-align: left;

            .waiting-block-decision {
                text-align: center;
            }

            // Decisions stack ; keep each on its own line and small so the row
            // stays compact, letting a long name overflow past the ellipsis.
            .block-decision {
                font-size: 14px;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                margin-bottom: 0.25rem;

                .block-decision-player {
                    margin-right: 4px;
                }
            }
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
            padding: 5px;

            .impulse-player {
                margin-right: 25px;
            }

            button {
                margin-left: 10px;
            }
        }
    }

    &.bot-display {
        .action-impulse {
            justify-content: space-between;
        }

        .action-minions {
            font-size: 18px;
        }

        // The impulse sequencing is only wired for bots ; its dotted frame
        // would look out of place around the lone No block button a human sees.
        .impulse-decision {
            border: dotted 2px $purple-grey;
        }
    }
}
</style>
