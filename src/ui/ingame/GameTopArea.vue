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
        @pointermove="forwardPointerEvent"
        @pointerdown="forwardPointerEvent"
        @pointerup="forwardPointerEvent"
    >
        <!-- Turn/Phase Controls -->
        <div class="turn-controls">
            <div class="turn">
                <CommandButton
                    v-if="gameState.isPlayer"
                    :command="commands.BackTurn"
                >
                    &lt;
                </CommandButton>

                <span class="turn-number"> Turn<br />#{{ gameState.turnNumber }} </span>
                <span
                    :style="{ backgroundColor: gameState.activePlayer?.color.rgba }"
                    class="active-player inline-player-name"
                >
                    {{ gameState.activePlayer?.shortName }}
                </span>

                <CommandButton
                    v-if="gameState.isPlayer"
                    :command="commands.AdvanceTurn"
                >
                    &gt;
                </CommandButton>
            </div>

            <div class="timer">
                <div
                    v-if="timer.timerEnabled.value"
                    class="timer-display"
                    :class="{ expired: timer.isExpired.value }"
                >
                    {{ timer.formattedTime }}

                    <button
                        class="game-button small timer-button"
                        @click="togglePause"
                    >
                        {{ gameState.timerIsPaused ? '▶' : '⏸' }}
                    </button>
                </div>
            </div>

            <div class="phases">
                <CommandButton
                    v-if="gameState.isPlayer"
                    :command="commands.BackTurnPhase"
                />

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

                <CommandButton
                    v-if="gameState.isPlayer"
                    :command="commands.AdvanceTurnPhase"
                />
            </div>
        </div>

        <div
            v-if="glowInPlayEnabled"
            class="cards-during-current-phase"
        >
            <span
                class="cards-count"
                :class="{ 'has-effect': gameState.cardsDuringCurrentPhase.length > 0 }"
                @click="pingCardsDuringCurrentPhase"
            >
                {{ gameState.cardsDuringCurrentPhase.length }} cards with an effect
            </span>
        </div>

        <div class="central-box">
            <!-- Action Infos -->
            <div
                v-if="gameState.action"
                class="action-infos"
            >
                <div class="action-infos-column">
                    <strong>Action : {{ gameState.action.minionAction?.name }}</strong>

                    <span>Acting Minion : {{ gameState.action.actingMinion?.name }}</span>

                    <!-- <span>Is directed ? : {{ gameState.action.minionAction?.isDirected }}</span> -->
                    <!--  <span>Target : {{ gameState.action.minionAction.target?.name }}</span> -->
                    <span>
                        Blocking Minion :
                        <template v-if="gameState.action.blockingMinion">
                            {{ gameState.action.blockingMinion?.name }}
                        </template>
                        <template v-else-if="gameState.action.blockingMinion == NO_BLOCK">
                            No Block
                        </template>
                        <template v-else>?</template>
                    </span>
                </div>

                <div class="action-infos-column">
                    <div class="action-property">
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
                    </div>

                    <div class="action-property">
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
                    </div>

                    <div class="action-property">
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
                        </template>
                    </div>

                    <div
                        v-if="gameState.action.minionAction?.isHunt"
                        class="action-property"
                    >
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
                    </div>

                    <div class="action-property">
                        <span style="white-space: nowrap">
                            Impulse :
                            <span
                                class="inline-player-name"
                                :style="{
                                    backgroundColor: gameState.action.impulsePlayer?.color.rgba,
                                }"
                            >
                                {{ gameState.action.impulsePlayer?.shortName }}
                            </span>
                        </span>

                        <button
                            class="game-button"
                            :disabled="
                                !gameState.action.selfHasImpulse ||
                                !gameState.action.canAttemptBlock
                            "
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
                            :disabled="
                                !gameState.action.selfHasImpulse || gameState.action.canAttemptBlock
                            "
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

            <!-- Combat Infos -->
            <div v-if="gameState.combat">
                <strong>Combat</strong>

                Acting Minion : {{ gameState.combat?.acting?.minion?.name }} <br />
                Strength : {{ gameState.combat?.acting?.strength }} <br />

                Defending Minion : {{ gameState.combat?.defending?.minion?.name }}
                <br />
                Strength : {{ gameState.combat?.defending?.strength }} <br />
            </div>

            <div
                v-if="multiplayer.selfIsHost && !timer.timerChosen.value"
                class="timer-setup"
            >
                <span class="timer-setup-text">Start a 2h timer ? </span>
                <button
                    class="game-button"
                    @click="timer.acceptTimer()"
                >
                    Yes
                </button>
                <button
                    class="game-button"
                    @click="timer.declineTimer()"
                >
                    No
                </button>
            </div>

            <!-- Next Turn -->
            <CommandButton
                v-if="gameState.turnPhase == TurnPhase.Discard && gameState.selfIsActive"
                class="next-turn"
                :command="commands.AdvanceTurn"
            >
                Next Turn
            </CommandButton>

            <!-- The Edge Hint -->
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
                controls The Edge
                <img
                    src="/assets/theEdgeTeal.webp"
                    class="theEdgeImage"
                />
                and can gain 1 pool from the blood bank
            </div>
        </div>

        <!-- Permanent Mutations -->
        <div
            v-if="gameState.isPlayer"
            class="game-mutations"
        >
            <div>
                <CommandButton :command="commands.DecreaseScale"> - </CommandButton>
                {{ `${Math.round(((gameState.selfPlayer?.scale ?? 0) * 100) / 10) * 10}%` }}
                <CommandButton :command="commands.IncreaseScale"> + </CommandButton>
            </div>
            <CommandButton :command="commands.UnlockAll"> Unlock All </CommandButton>
            <CommandButton :command="commands.DiscardAtRandom"> Discard At Random </CommandButton>
            <CommandButton :command="commands.ClearDeclaredTargets"> Clear Targets </CommandButton>
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
import { TOP_AREA_HEIGHT, TOP_AREA_WIDTH, TOP_AREA_X, WORLD_WIDTH } from '@/game/const.ts'
import { gameMutations } from '@/state/gameMutations.ts'
import { TurnPhase, TurnSequence } from '@/model/const.ts'
import { NO_BLOCK } from '@/state/actionState.ts'
import { display } from '@/game/display.ts'
import { useCommands } from '@/game/composables/useCommands.ts'
import CommandButton from '@/ui/ingame/CommandButton.vue'
import { useHistoryStore } from '@/store/history.ts'
import { useCoreStore } from '@/store/core.ts'
import { useMultiplayerStore } from '@/store/multiplayer.ts'
import { useTimer } from '@/game/composables/useTimer.ts'
import { WorldAlignment } from '@/gateway/db.ts'

const core = useCoreStore()
const gameState = useGameStateStore()
const history = useHistoryStore()
const bus = useBusStore()
const gameBus = useGameBusStore()
const multiplayer = useMultiplayerStore()
const commands = useCommands()
const timer = useTimer()

const glowInPlayEnabled = computed(() => core.userProfile.preferences.glowInPlay ?? true)
const worldAlignment = computed(
    () => core.userProfile.preferences.worldAlignment ?? WorldAlignment.Center,
)

const style = computed(() => {
    let offsetLeft, top
    if (worldAlignment.value == WorldAlignment.TopRight) {
        offsetLeft = display.actualWidth - (WORLD_WIDTH + display.horizontalPadding) * display.scale
        top = 0
    } else {
        offsetLeft = display.horizontalSpaceAvailable / 2
        top = display.verticalSpaceAvailable / 2
    }

    const left = TOP_AREA_X * display.scale + offsetLeft

    return {
        width: `${TOP_AREA_WIDTH}px`,
        maxWidth: `${TOP_AREA_WIDTH}px`,
        height: `${TOP_AREA_HEIGHT}px`,
        maxHeight: `${TOP_AREA_HEIGHT}px`,
        top: `${top}px`,
        left: `${left}px`,
        transform: `scale(${display.scale})`,
    }
})

/**
 * Timer
 */

function togglePause() {
    if (gameState.timerRemainingTime === null) {
        throw new Error('Timer is not started')
    }
    if (gameState.timerIsPaused) {
        timer.dispatchStartTimer(gameState.timerRemainingTime)
    } else {
        timer.dispatchPauseTimer(gameState.timerRemainingTime)
    }
}

/**
 * Cards during current phase
 */

function pingCardsDuringCurrentPhase() {
    for (const card of gameState.cardsDuringCurrentPhase) {
        // We ping directly through the game bus, and not through a gameMutation
        // because we don't want to spam other players.
        gameBus.pingCard(card.oid)
    }
}

/**
 * Dispatch pointer events to the game.
 * This is overly complicated because of a strange behaviour of Phaser
 * which won't capture some pointer events when some others occured outside the canvas.
 */

let isTrackingMouse = false
function startTrackPointerMove() {
    if (!isTrackingMouse) {
        isTrackingMouse = true
        core.phaserGame.canvas.addEventListener('pointermove', onPointerMove)
        window.addEventListener('pointerup', onPointerUp)
    }
}

function stopTrackPointerMove() {
    if (isTrackingMouse) {
        isTrackingMouse = false
        core.phaserGame.canvas.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
    }
}

function transformEvent(event: PointerEvent) {
    event.preventDefault()
    const game = core.phaserGame
    const newEvent = new PointerEvent(event.type, event)
    // Override the target property to point to the canvas
    Object.defineProperty(newEvent, 'target', {
        value: game.canvas,
        writable: false,
        enumerable: true,
    })
    // game.canvas.dispatchEvent(newEvent) // Needed to get newEvent.target set to canvas
    return { game, newEvent }
}

function onPointerDown(event: PointerEvent) {
    const { game, newEvent } = transformEvent(event)
    startTrackPointerMove()
    // @ts-expect-error - Phaser internal method exists at runtime
    game.input.onMouseDown(newEvent)
}

function onPointerUp(event: PointerEvent) {
    const { game, newEvent } = transformEvent(event)
    stopTrackPointerMove()
    // @ts-expect-error - Phaser internal method exists at runtime
    game.input.onMouseUp(newEvent)
}

function onPointerMove(event: PointerEvent) {
    const { newEvent } = transformEvent(event)
    // @ts-expect-error - Phaser internal method exists at runtime
    core.phaserGame.input.onMouseMove(newEvent)
}

function forwardPointerEvent(event: PointerEvent) {
    switch (event.type) {
        case 'pointerdown':
            onPointerDown(event)
            break
        case 'pointerup':
            onPointerUp(event)
            break
        case 'pointermove':
            onPointerMove(event)
            break
    }
}
</script>

<style lang="scss">
#GameTopArea {
    position: absolute;
    box-sizing: border-box;
    background-color: transparent;
    padding: 6px 0;
    display: flex;
    flex-direction: column;
    transform-origin: top left;
    overflow: hidden;
}

.turn-controls {
    color: $shadow-grey;
    font-weight: bold;
    font-size: 14px;

    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
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
            white-space: nowrap;
        }

        .active-player {
            display: block;
            text-align: center;
            line-height: 35px;
            width: 100px;
            max-width: 100px;
            padding: 0 5px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
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
            width: 32px;
            height: 35px;
        }

        .phase-box {
            @include flex-center;
            width: 32px;
            height: 35px;
            border: solid 1px $shadow-grey;
            background: $pearl-grey;
            color: $ash-grey;
            box-sizing: border-box;

            opacity: 0.7;

            &.active {
                background: $lighter-teal;
                color: black;
                width: 70px;
                opacity: 1;
            }
            &:not(.active) {
                cursor: pointer;
            }
        }
    }

    .timer-display {
        font-size: 16px;
        font-weight: bold;
        color: black;
        padding: 0.25rem 0.5rem;
        background: rgba($pearl-grey, 0.7);
        border: solid 1px $shadow-grey;
        min-width: 80px;
        text-align: center;

        &.expired {
            color: red;
        }
    }

    .timer-button {
        margin-left: 5px;
        padding: 2px 5px;
        font-size: 14px;
    }
}

.cards-during-current-phase {
    display: flex;
    justify-content: end;
    padding-top: 5px;

    .cards-count {
        background-color: $pale-grey;
        padding: 3px 5px;

        &.has-effect {
            background-color: darken(desaturate(rgba(180, 90, 40, 0.8), 15%), 5%);
            transition: background-color 0.4s linear;
            cursor: pointer;
        }
    }
}

.central-box {
    @include flex-center;
    flex-grow: 1;
}

.action-infos {
    display: flex;
    justify-content: space-between;
}

.action-infos-column {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 0.1rem;
}

.action-property {
    display: flex;
    gap: 0.1rem;
    justify-content: right;
    align-items: center;
}

.timer-setup {
    align-self: center;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: rgba($pearl-grey, 0.7);
    padding: 0.5rem 1rem;
    border: solid 1px $shadow-grey;
    border-radius: 2px;

    .timer-setup-text {
        font-weight: bold;
        color: $shadow-grey;
    }

    .game-button {
        padding: 0.25rem 1rem;
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

    .theEdgeImage {
        height: 25px;
        vertical-align: middle;
    }
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

    .game-button {
        font-size: 12px;
    }

    .game-button:has(kbd):has(img) {
        padding: 0 5px;
        display: flex;
        align-items: center;
        gap: 0.5rem;

        img {
            height: 22px;
            width: auto;
        }
    }
}
</style>
