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
                    v-if="players.isPlayer"
                    :command="commands.BackTurn"
                >
                    &lt;
                </CommandButton>

                <span class="turn-number"> Turn<br />#{{ gameState.turnNumber }} </span>
                <span
                    :style="{ backgroundColor: gameState.activePlayer?.rgbaColor }"
                    class="active-player inline-player-name"
                >
                    {{ gameState.activePlayer?.shortName }}
                </span>

                <CommandButton
                    v-if="players.isPlayer"
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
                    v-if="players.isPlayer"
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
                    v-if="players.isPlayer"
                    :command="commands.AdvanceTurnPhase"
                />
            </div>
        </div>

        <div class="game-controls">
            <!-- Permanent Mutations -->
            <div
                v-if="players.isPlayer"
                class="game-mutations"
            >
                <CommandButton
                    class="is-danger cancel-button"
                    :command="commands.Cancel"
                    :disabled="!history.nextCancellableMutation"
                >
                    Cancel
                </CommandButton>

                <PopupMenu label="Display">
                    <div class="scale-controls">
                        <span class="scale-label">Card Scale</span>
                        <div class="scale-buttons">
                            <CommandButton :command="commands.DecreaseScale"> - </CommandButton>
                            <span class="scale-text">{{
                                `${Math.round(((players.selfPlayer?.scale ?? 0) * 100) / 10) * 10}%`
                            }}</span>
                            <CommandButton :command="commands.IncreaseScale"> + </CommandButton>
                        </div>
                    </div>
                    <CommandButton
                        :command="commands.FocusMode"
                        class="align-center"
                    >
                        Focus Mode
                    </CommandButton>
                    <button
                        class="game-button align-center"
                        @click="resetLayout"
                    >
                        Reset Layout
                    </button>
                </PopupMenu>

                <PopupMenu label="Game">
                    <CommandButton :command="commands.DiscardAtRandom">
                        Discard At Random
                    </CommandButton>
                    <CommandButton :command="commands.ClearDeclaredTargets">
                        Clear Targets
                    </CommandButton>
                    <button
                        class="game-button"
                        @click="rollRandomResult('coin')"
                    >
                        Flip A Coin
                    </button>
                    <button
                        class="game-button"
                        @click="rollRandomResult('d6')"
                    >
                        Roll A D6
                    </button>
                </PopupMenu>
            </div>

            <!-- Right-anchored controls, aligned under the phases block -->
            <div class="right-controls">
                <CommandButton
                    class="unlock-all-button"
                    :command="commands.UnlockAll"
                >
                    Unlock All
                </CommandButton>

                <!-- Cards with an effect -->
                <div
                    v-if="glowInPlayEnabled"
                    class="cards-during-current-phase"
                    :class="{ 'has-effect': gameState.cardsDuringCurrentPhase.length > 0 }"
                    @click="pingCardsDuringCurrentPhase"
                >
                    {{ gameState.cardsDuringCurrentPhase.length }} cards with an effect
                </div>
            </div>
        </div>

        <div
            :class="{
                'full-display': fullDisplay,
                'bg-visible': centralContent.action || centralContent.declarationHint,
            }"
            class="central-box"
        >
            <!-- The Edge Hint -->
            <div
                v-if="aidsEnabled && centralContent.theEdge"
                id="TheEdgeHint"
            >
                <span
                    class="inline-player-name"
                    :style="{
                        backgroundColor: gameState.theEdgeController?.rgbaColor,
                    }"
                >
                    {{ gameState.theEdgeController?.name }}
                </span>
                controls The Edge
                <img
                    src="/assets/theEdgeTealSmall.webp"
                    class="theEdgeImage"
                />
                and can gain 1 pool from the blood bank
            </div>

            <!-- Declaration hint -->
            <div class="declaration-hint">
                <template
                    v-if="gameBus.actionDeclaration.type && gameBus.actionDeclaration.validTargets"
                >
                    Select
                    <strong>{{ MinionActionNames[gameBus.actionDeclaration.type] }}</strong> target
                </template>

                <template
                    v-if="
                        gameBus.actionDeclaration.type == MinionActionType.ActionCardFromHand &&
                        gameBus.actionDeclaration.actingMinion
                    "
                >
                    Choose an <strong>action card</strong> from your <strong>hand</strong>
                </template>

                <template
                    v-if="
                        gameBus.actionDeclaration.type == MinionActionType.ActionInPlay &&
                        gameBus.actionDeclaration.actingMinion
                    "
                >
                    Choose a <strong>card in play</strong> that provides an action
                </template>
            </div>

            <!-- Action Infos -->
            <div
                v-if="gameState.action"
                class="action-infos"
            >
                <div class="action-minions">
                    <div>
                        <span
                            :class="
                                gameState.action.minionAction.actingMinion.isCrypt ?
                                    'cryptCard'
                                :   'libraryCard'
                            "
                        >
                            {{ gameState.action.minionAction.actingMinion.name }} </span
                        >:
                        <template
                            v-if="
                                gameState.action.minionAction.type ==
                                MinionActionType.ActionCardFromHand
                            "
                        >
                            {{
                                ActionVerb[
                                    gameState.action.minionAction.card
                                        .type as keyof typeof ActionVerb
                                ] + ' '
                            }}
                        </template>

                        <strong>{{ actions.getName(gameState.action.minionAction) }}</strong>
                        <template v-if="gameState.action.minionAction.target">
                            {{ ' on ' + selfSecureName(gameState.action.minionAction.target) }}
                        </template>

                        <template
                            v-if="
                                gameState.action.minionAction.type ==
                                    MinionActionType.ActionInPlay &&
                                gameState.action.minionAction.card
                            "
                        >
                            Provided By
                            {{ gameState.action.minionAction.card.name }}
                        </template>
                    </div>

                    <!-- <span>Is directed ? : {{ gameState.action.minionAction?.isDirected }}</span> -->
                    <!--  <span>Target : {{ gameState.action.minionAction.target?.name }}</span> -->
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
                        <strong>{{ gameState.action.stealth }} Stealth</strong>
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
                    </span>

                    <span class="action-property">
                        <template v-if="actions.isBleed(gameState.action.minionAction)">
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
                            <strong>{{ gameState.action.bleed }} Bleed</strong>
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
                        </template>

                        <template v-if="actions.isHunt(gameState.action.minionAction)">
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
                            <strong>{{ gameState.action.hunt }} Hunt</strong>
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
                        </template>
                    </span>

                    <span class="action-property">
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
                        <strong>{{ gameState.action?.intercept }} Intercept</strong>
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
                                    color: gameState.action.impulsePlayer?.rgbaColor,
                                }"
                            >
                                {{ gameState.action.impulsePlayer?.shortName }}
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

            <!-- Combat Infos -->
            <!--
            <div v-if="gameState.combat">
                <strong>Combat</strong>

                Acting Minion : {{ gameState.combat?.acting?.minion?.name }} <br />
                Strength : {{ gameState.combat?.acting?.strength }} <br />

                Defending Minion : {{ gameState.combat?.defending?.minion?.name }}
                <br />
                Strength : {{ gameState.combat?.defending?.strength }} <br />
            </div>
            -->

            <div
                v-if="centralContent.timer"
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
                v-if="centralContent.nextTurn"
                class="next-turn"
                :command="commands.AdvanceTurn"
            >
                Next Turn
            </CommandButton>

            <!-- New Turn Notification -->
            <div
                v-if="centralContent.turnNotification"
                class="turn-notification"
            >
                <span class="turn-notification-label">Turn #{{ gameState.turnNumber }}</span>
                <span
                    class="inline-player-name turn-notification-player"
                    :style="{ backgroundColor: gameState.activePlayer?.rgbaColor }"
                >
                    {{ gameState.activePlayer?.name }}
                </span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useBusStore, useGameBusStore } from '@/client/store/bus.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { TOP_AREA_HEIGHT, TOP_AREA_WIDTH, TOP_AREA_X, WORLD_WIDTH } from '@/shared/const/game.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { ActionVerb, TurnPhase, TurnSequence } from '@/shared/const/model.ts'
import { getBlockingMinion, selfCanAttemptBlock } from '@/shared/state/actionState.ts'
import {
    ActionProperty,
    MinionActionNames,
    MinionActionType,
    NO_BLOCK,
    NO_REACTION,
} from '@/shared/types/state.ts'
import { display, resetLayout } from '@/client/game/display.ts'
import { useCommands } from '@/client/game/composables/useCommands.ts'
import CommandButton from '@/client/ui/ingame/CommandButton.vue'
import PopupMenu from '@/client/ui/components/PopupMenu.vue'
import { useHistoryStore } from '@/client/store/history.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { useTimer } from '@/shared/state/useTimer.ts'
import { WorldAlignment } from '@/client/gateway/db.ts'
import * as actions from '@/shared/state/minionActions.ts'
import { selfSecureName } from '@/client/state/self.ts'
import { useUIFeatures } from '@/client/game/composables/useUIFeatures.ts'
import { rollRandomResult } from '@/client/state/gameMutations.ts'

const core = useCoreStore()
const gameState = useGameStateStore()
const players = usePlayersStore()
const history = useHistoryStore()
const bus = useBusStore()
const gameBus = useGameBusStore()
const multiplayer = useMultiplayerStore()
const commands = useCommands()
const timer = useTimer(gameState.gameId)

const { aidsEnabled, worldAlignment, glowInPlayEnabled, turnNotificationEnabled } = useUIFeatures()
const blockingMinion = computed(() => getBlockingMinion(gameState))
const fullDisplay = computed(
    () => gameState.action && gameState.action.minionAction.actingMinion.controller.isBot,
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
 * New turn notification
 *
 * When a new turn begins (turnNumber increases by 1), we briefly show an
 * eye-catching notification with the new active player. While it's visible it
 * takes over the central box, so timer-setup and TheEdgeHint are hidden.
 */

const TURN_NOTIFICATION_DURATION = 3500
const turnNotificationVisible = ref(false)
let turnNotificationTimeout: ReturnType<typeof setTimeout> | undefined

watch(
    () => gameState.turnNumber,
    (newTurn, oldTurn) => {
        // Only trigger when advancing to the next turn, not on rewind or resync jumps.
        if (!turnNotificationEnabled.value || (oldTurn && newTurn !== oldTurn + 1)) {
            return
        }

        turnNotificationVisible.value = true
        clearTimeout(turnNotificationTimeout)
        turnNotificationTimeout = setTimeout(() => {
            turnNotificationVisible.value = false
        }, TURN_NOTIFICATION_DURATION)
    },
    { immediate: true },
)

onUnmounted(() => clearTimeout(turnNotificationTimeout))

/**
 * What is displayed in the central box ?
 */

const centralContent = computed(() => ({
    action: !!gameState.action,
    declarationHint: !!gameBus.actionDeclaration.type,
    turnNotification: turnNotificationVisible.value,
    timer:
        !turnNotificationVisible.value &&
        multiplayer.selfIsHost &&
        !timer.timerChosen.value &&
        gameState.timerStartTime === null,
    nextTurn: gameState.turnPhase == TurnPhase.Discard && players.selfIsActive,
    theEdge:
        !turnNotificationVisible.value &&
        gameState.turnPhase == TurnPhase.Unlock &&
        gameState.theEdgeController &&
        gameState.theEdgeController == gameState.activePlayer,
}))

/**
 * Minion Action
 */

const selfHasImpulse = computed(() => gameState.action?.impulsePlayer == players.selfPlayer)

/**
 * Timer
 */

function togglePause() {
    if (gameState.timerStartTime === null) {
        throw new Error('Timer is not started')
    }
    if (gameState.timerIsPaused) {
        timer.dispatchStartTimer()
    } else {
        timer.dispatchPauseTimer()
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
        width: 225px;
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

.game-controls {
    display: flex;
    justify-content: space-between;
    padding-top: 5px;
}

.right-controls {
    display: flex;
    align-items: stretch;
    gap: 5px;
    // Anchor the group to the right so it stays in place even when
    // .game-mutations is hidden (non-player view).
    margin-left: auto;
    // Match the fixed width of .phases (2 nav buttons + 5 phase boxes) so the
    // group's left edge lines up with the left edge of the phases block above.
    width: 262px;

    .unlock-all-button {
        // Grow to fill the space left of the cards indicator, so the button's
        // left edge aligns with .phases while staying adjacent to the cards.
        flex: 1;
        white-space: nowrap;
    }
}

.cards-during-current-phase {
    display: flex;
    align-items: center;
    background-color: $pale-grey;
    padding: 0 5px;

    &.has-effect {
        background-color: darken(desaturate(rgba(180, 90, 40, 0.8), 15%), 5%);
        transition: background-color 0.4s linear;
        cursor: pointer;
    }
}

.game-mutations {
    display: flex;
    width: 225px;
    justify-content: space-between;

    .popup-menu-trigger,
    .cancel-button {
        height: 100%;
    }

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

    .popup-menu-panel .game-button {
        width: 100%;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 15px;
    }

    .scale-controls {
        background-color: $purple-grey;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 45px;
        padding: 4px 5px;
        color: white;
        font-size: 12px;
        font-weight: 600;
        width: 190px;

        .scale-label {
            white-space: nowrap;
        }

        .scale-buttons {
            display: flex;
            align-items: center;
            gap: 4px;
            flex: 1;

            .scale-text {
                padding: 5px;
                flex: 1;
                text-align: center;
            }

            .game-button {
                flex: 1;
                min-width: 20px;
                justify-content: center;
            }
        }
    }
}

.central-box {
    @include flex-center;
    flex-grow: 1;
    flex-direction: column;
    gap: 0.5rem;
    position: relative;

    margin: 15px 0;
    padding: 5px;

    &.bg-visible {
        background: rgba(#dddddd, 0.4);
    }

    .cryptCard {
        color: $crypt-orange;
        font-weight: bold;
    }
    .libraryCard {
        color: $library-green;
        font-weight: bold;
    }

    .declaration-hint {
        font-size: 20px;
        color: $midnight-blue;
        text-decoration: underline;
    }

    .action-infos {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 1rem;
        padding: 0 30px;
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

.turn-notification {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 1.5rem;
    padding: 1rem 1.5rem;
    border: solid 2px $light-teal;
    border-radius: 4px;
    background: rgba($pearl-grey, 0.85);
    box-shadow: 0 0 12px rgba($light-teal, 0.9);
    font-size: 26px;
    font-weight: bold;
    color: $shadow-grey;
    white-space: nowrap;
    animation: TurnNotificationAppear 0.5s ease-out;

    .turn-notification-label {
        text-transform: uppercase;
        letter-spacing: 1px;
    }

    .turn-notification-player {
        font-size: 22px;
        padding: 2px 10px;
        border-radius: 2px;
        animation: TurnNotificationPulse 1s ease-in-out infinite;
    }
}

@keyframes TurnNotificationAppear {
    0% {
        opacity: 0;
        transform: translate(-50%, -50%) scale(0.7);
    }
    60% {
        transform: translate(-50%, -50%) scale(1.08);
    }
    100% {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
    }
}

@keyframes TurnNotificationPulse {
    0%,
    100% {
        transform: scale(1);
    }
    50% {
        transform: scale(1.08);
    }
}
</style>
