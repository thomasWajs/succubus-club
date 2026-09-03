<template>
    <div
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

        <div
            v-if="fullDisplay"
            class="action-properties"
        >
            <span class="action-property">
                <ActionPropertyStepper
                    :property="ActionProperty.stealth"
                    :value="action.stealth"
                    label="Stealth"
                />
            </span>

            <span class="action-property">
                <ActionPropertyStepper
                    v-if="actions.isBleed(action.minionAction)"
                    :property="ActionProperty.bleed"
                    :value="action.bleed"
                    label="Bleed"
                />

                <ActionPropertyStepper
                    v-if="actions.isHunt(action.minionAction)"
                    :property="ActionProperty.hunt"
                    :value="action.hunt"
                    label="Hunt"
                />
            </span>

            <span class="action-property">
                <ActionPropertyStepper
                    :property="ActionProperty.intercept"
                    :value="action.intercept"
                    label="Intercept"
                />
            </span>
        </div>

        <div class="action-impulse">
            <div>
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
    </div>
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
import ActionPropertyStepper from '@/client/ui/ingame/topArea/central/ActionPropertyStepper.vue'

const props = defineProps<{
    action: ActionState
}>()

const gameState = useGameStateStore()
const players = usePlayersStore()

const fullDisplay = computed(() => props.action.minionAction.actingMinion.controller.isBot)
const blockingMinion = computed(() => getBlockingMinion(gameState))
const selfHasImpulse = computed(() => props.action.impulsePlayer == players.selfPlayer)
</script>

<style lang="scss">
.action-infos {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 0 30px;

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
        justify-content: space-between;
    }

    .action-property {
        display: inline-flex;
        gap: 0.25rem;
    }

    .action-impulse {
        display: flex;
        justify-content: center;
        align-items: center;

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
