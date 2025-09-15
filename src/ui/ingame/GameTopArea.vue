<template>
    <!--
    The v-if handle the case of reconnecting into a multiplayer game,
    and the state is not synced yet.
    In this case, there's no gameState.activePlayer, and that trigger errors.
     -->
    <div
        v-if="!bus.isResyncing"
        v-show="!gameBus.wieldCardStack.show"
        id="GameTopArea"
        :style="style"
    >
        <div class="turn-infos">
            <div class="turn">
                <CommandButton :command="commands.BackTurn"> &lt; </CommandButton>

                <span class="turn-number"> Turn #{{ gameState.turnNumber }} </span>
                <span
                    :style="{ backgroundColor: gameState.activePlayer?.color.rgba }"
                    class="active-player inline-player-name"
                >
                    {{ gameState.activePlayer?.name }}
                </span>

                <CommandButton :command="commands.AdvanceTurn"> &gt; </CommandButton>
            </div>

            <div class="phases">
                <CommandButton :command="commands.BackTurnPhase" />

                <template
                    v-for="(phase, index) of TurnSequence"
                    :key="phase"
                >
                    <span
                        v-if="phase == gameState.turnPhase"
                        class="phase-box active"
                        >{{ gameState.turnPhase }}</span
                    >
                    <span
                        v-else
                        class="phase-box"
                        @click="gameMutations.goToTurnPhase.actSelf({ index })"
                    >
                        <!-- Disambiguate Master and Minion with the second letter -->
                        {{ phase.charAt(0).toUpperCase()
                        }}<template v-if="index == 1 || index == 2">{{ phase.charAt(1) }}</template>
                    </span>
                </template>

                <CommandButton :command="commands.AdvanceTurnPhase" />
            </div>

            <!--
            <br />
            MPA : {{ gameState.turnResources.mpa }} | Transfers :
            {{ gameState.turnResources.transfers }} | DPA :
            {{ gameState.turnResources.dpa }}
            -->
        </div>

        <div
            v-if="gameState.action"
            :style="{ display: 'flex' }"
        >
            <div>
                <strong>Action : {{ gameState.action.minionAction?.name }}</strong>
                <br />
                Acting Minion : {{ gameState.action.actingMinion?.name }} <br />
                Is directed ? : {{ gameState.action.minionAction?.isDirected }}
                <br />
                Target : {{ gameState.action.minionAction.target?.name }} <br />
                Impulse : {{ gameState.action.impulsePlayer?.name }} <br />

                Blocking Minion :
                <span v-if="gameState.action.blockingMinion">
                    {{ gameState.action.blockingMinion?.name }}
                </span>
                <span v-else-if="gameState.action.blockingMinion == NO_BLOCK"> No Block </span>
                <span v-else>?</span>

                <br />
            </div>

            <div>
                Stealth : {{ gameState.action.stealth }}
                <button
                    class="game-button small"
                    @click="
                        gameMutations.ACTION_changeProperty.actSelf({
                            propertyName: ActionProperty.stealth,
                            amount: +1,
                        })
                    "
                >
                    +1
                </button>
                <button
                    class="game-button small"
                    @click="
                        gameMutations.ACTION_changeProperty.actSelf({
                            propertyName: ActionProperty.stealth,
                            amount: -1,
                        })
                    "
                >
                    -1
                </button>
                <br />

                Intercept : {{ gameState.action?.intercept }}
                <button
                    class="game-button small"
                    @click="
                        gameMutations.ACTION_changeProperty.actSelf({
                            propertyName: ActionProperty.intercept,
                            amount: +1,
                        })
                    "
                >
                    +1
                </button>
                <button
                    class="game-button small"
                    @click="
                        gameMutations.ACTION_changeProperty.actSelf({
                            propertyName: ActionProperty.intercept,
                            amount: -1,
                        })
                    "
                >
                    -1
                </button>
                <br />

                <template v-if="gameState.action.minionAction?.isBleed">
                    Bleed : {{ gameState.action.bleed }}
                    <button
                        class="game-button small"
                        @click="
                            gameMutations.ACTION_changeProperty.actSelf({
                                propertyName: ActionProperty.bleed,
                                amount: +1,
                            })
                        "
                    >
                        +1
                    </button>
                    <button
                        class="game-button small"
                        @click="
                            gameMutations.ACTION_changeProperty.actSelf({
                                propertyName: ActionProperty.bleed,
                                amount: -1,
                            })
                        "
                    >
                        -1
                    </button>
                    <br />
                </template>
                <template v-if="gameState.action.minionAction?.isHunt">
                    Hunt : {{ gameState.action.hunt }}
                    <button
                        class="game-button small"
                        @click="
                            gameMutations.ACTION_changeProperty.actSelf({
                                propertyName: ActionProperty.hunt,
                                amount: +1,
                            })
                        "
                    >
                        +1
                    </button>
                    <button
                        class="game-button small"
                        @click="
                            gameMutations.ACTION_changeProperty.actSelf({
                                propertyName: ActionProperty.hunt,
                                amount: -1,
                            })
                        "
                    >
                        -1
                    </button>
                    <br />
                </template>

                <button
                    class="game-button"
                    :disabled="!gameState.action.canAttemptBlock"
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
                    :disabled="gameState.action.canAttemptBlock"
                    @click="
                        gameMutations.ACTION_declareReaction.actSelf({
                            reaction: NO_REACTION,
                        })
                    "
                >
                    Pass impulse
                </button>

                <!--
                <button
                    class="gameMutation"
                    :disabled="!gameState.action"
                    @click="gameMutations.ACTION_declareBlock.actSelf({blockingDecision: BLOCK_DECLINED})"
                >
                    Attempt block...
                </button>
                -->
            </div>
        </div>

        <div v-if="gameState.combat">
            <strong>Combat</strong>

            Acting Minion : {{ gameState.combat?.acting?.minion?.name }} <br />
            Strength : {{ gameState.combat?.acting?.strength }} <br />

            Defending Minion : {{ gameState.combat?.defending?.minion?.name }}
            <br />
            Strength : {{ gameState.combat?.defending?.strength }} <br />
        </div>

        <CommandButton
            v-if="gameState.turnPhase == TurnPhase.Discard && gameState.selfIsActive"
            class="next-turn"
            :command="commands.AdvanceTurn"
        >
            Next Turn
        </CommandButton>

        <div
            v-if="
                gameState.turnPhase == TurnPhase.Unlock &&
                gameState.theEdgeController &&
                gameState.theEdgeController == gameState.activePlayer
            "
            id="TheEdgeHint"
        >
            <span
                class="inline-player-name"
                :style="{
                    backgroundColor: gameState.theEdgeController.color.rgba,
                }"
            >
                {{ gameState.theEdgeController.name }}
            </span>
            control The Edge 🗡️ and can gain 1 pool from the blood bank
        </div>

        <div class="game-mutations">
            <CommandButton :command="commands.GainBlood"> Gain Blood </CommandButton>
            <CommandButton :command="commands.BurnBlood"> Burn Blood </CommandButton>
            <CommandButton :command="commands.Influence"> Influence </CommandButton>
            <CommandButton :command="commands.UnlockAll"> Unlock All </CommandButton>
            <CommandButton :command="commands.DiscardAtRandom"> Discard At Random </CommandButton>
            <CommandButton
                class="is-danger"
                :command="commands.Cancel"
                :disabled="!history.nextCancellableMutation"
            >
                Cancel
            </CommandButton>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useBusStore, useGameBusStore } from '@/store/bus.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { PLAY_AREA_WIDTH, PLAY_AREA_X, PLAY_AREA_Y } from '@/game/const.ts'
import { gameMutations } from '@/state/gameMutations.ts'
import { TurnPhase, TurnSequence } from '@/model/const.ts'
import { ActionProperty, NO_BLOCK, NO_REACTION } from '@/state/actionState.ts'
import { display } from '@/game/display.ts'
import { useCommands } from '@/game/composables/useCommands.ts'
import CommandButton from '@/ui/ingame/CommandButton.vue'
import { useHistoryStore } from '@/store/history.ts'

const gameState = useGameStateStore()
const history = useHistoryStore()
const bus = useBusStore()
const gameBus = useGameBusStore()
const commands = useCommands()

const style = computed(() => {
    return {
        width: `${PLAY_AREA_WIDTH}px`,
        height: `${PLAY_AREA_Y}px`,
        top: `0px`,
        left: `${PLAY_AREA_X * display.scale}px`,
        transform: `scale(${display.scale})`,
    }
})
</script>

<style lang="scss">
#GameTopArea {
    position: absolute;
    box-sizing: border-box;
    background-color: transparent;
    padding: 6px 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    transform-origin: top left;
}

.turn-infos {
    color: $shadow-grey;
    font-weight: bold;

    display: grid;
    grid-template-columns: 1fr 1fr;
    align-items: center;
    justify-items: center;

    .turn {
        height: 35px;
        justify-self: left;
        @include flex-center;
        align-items: stretch;

        .turn-number {
            @include flex-center;
            background: $lighter-teal;
            padding: 0 5px;
        }

        .active-player {
            @include flex-center;
            padding: 0 5px;
        }

        .game-button {
            height: 35px;
            padding: 0 5px;
            font-size: 18px;

            kbd {
                font-size: 16px;
            }
        }
    }

    .phases {
        height: 35px;
        justify-self: right;
        display: flex;
        align-items: stretch;

        .game-button {
            padding: 0 5px;
            width: 35px;
            height: 35px;
        }

        .phase-box {
            @include flex-center;
            height: 35px;
            width: 35px;
            border: solid 1px $shadow-grey;
            background: $pearl-grey;
            color: $ash-grey;
            box-sizing: border-box;

            opacity: 0.7;

            &.active {
                background: $lighter-teal;
                color: black;
                width: 90px;
                opacity: 1;
            }
            &:not(.active) {
                cursor: pointer;
            }
        }
    }
}

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

#TheEdgeHint {
    background-color: $silver-grey;
    color: $shadow-grey;
    display: inline-block;
    text-align: center;
    border: solid 1px $shadow-grey;
    padding: 4px 2px;
    animation: TheEdgeHintAppear 1s linear;
}

@keyframes TheEdgeHintAppear {
    0% {
        background-color: $silver-grey;
    }
    10% {
        background-color: $light-teal;
    }
    100% {
        background-color: $silver-grey;
    }
}

.game-mutations {
    display: flex;
    justify-content: space-between;
}
</style>
