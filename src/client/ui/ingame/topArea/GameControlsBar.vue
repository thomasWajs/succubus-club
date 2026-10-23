<template>
    <div class="game-controls">
        <!-- Permanent Mutations -->
        <div
            v-if="players.isPlayer"
            class="game-mutations"
        >
            <!-- Enabled by the command : the last mutation, or with the rules engine the user's last
                 decision when it can be taken back -->
            <CommandButton
                class="is-danger cancel-button"
                :command="commands.Cancel"
            >
                Cancel
            </CommandButton>

            <PopupMenu label="Display">
                <div
                    v-if="!gameState.isFreeTable"
                    class="scale-controls"
                >
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
                    v-if="!gameState.isFreeTable"
                    :command="commands.FocusMode"
                    class="align-center"
                >
                    Focus Mode
                </CommandButton>
                <button
                    v-if="gameState.isFreeTable"
                    class="game-button align-center"
                    @click="resetFreeTableCamera"
                >
                    Reset Camera
                </button>
                <button
                    class="game-button align-center"
                    @click="resetLayout"
                >
                    Reset Layout
                </button>
            </PopupMenu>

            <PopupMenu
                ref="gameMenu"
                label="Game"
            >
                <!-- With the rules engine, its referendums and discards : not the free table's -->
                <button
                    v-if="!isEngine"
                    class="game-button"
                    :disabled="!!gameState.referendum"
                    @click="callReferendum"
                >
                    Call Referendum
                </button>
                <CommandButton
                    v-if="!isEngine"
                    :command="commands.DiscardAtRandom"
                >
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
                <button
                    class="game-button"
                    @click="openSecretInterface"
                >
                    Secret Choice
                </button>
                <!-- The game's setup and every decision : to report a bug -->
                <button
                    v-if="isEngine"
                    class="game-button"
                    @click="exportReplay"
                >
                    Export Replay
                </button>
                <!-- A problem or a remark, kept in the game's record at the decision under way -->
                <button
                    v-if="isEngine"
                    class="game-button"
                    @click="openReport"
                >
                    Report A Problem
                </button>
            </PopupMenu>
            <EngineReport
                v-if="isEngine"
                ref="engineReport"
            />
        </div>

        <!-- Right-anchored controls, aligned under the phases block -->
        <div class="right-controls">
            <CommandButton
                v-if="players.isPlayer && !isEngine"
                class="unlock-all-button"
                :command="commands.UnlockAll"
            >
                Unlock All
            </CommandButton>

            <!-- With the rules engine : the pass of the decision under way, always here ( → / Space ),
                 the engine's text in its title ( "Pass (no block)", "End the master phase" ) ; a
                 pass that does something is also in the central box ( see isEffectPass ) ; one
                 declining to block says so -->
            <CommandButton
                v-if="players.isPlayer && isEngine"
                class="engine-fixed-pass"
                :class="{ decline: engine.pending?.decline }"
                :command="commands.AdvanceTurnPhase"
                :title="pass?.text"
            >
                {{ engine.pending?.decline ? 'Decline' : 'Pass' }}
            </CommandButton>
            <!-- A switch : its knob right and teal when on -->
            <button
                v-if="players.isPlayer && isEngine"
                class="game-button engine-opportunities"
                :class="{ on: engineOpportunities }"
                role="switch"
                :aria-checked="engineOpportunities"
                :title="`Opportunities ${engineOpportunities ? 'on' : 'off'}. Off : wakes only on your prey's or predator's actions or those directed at you, cards usable at any time ( The Louvre, Paris ) only when you're asked anyway`"
                @click="setEngineOpportunities(!engineOpportunities)"
            >
                Opp.
                <span class="engine-switch"><span class="engine-switch-knob" /></span>
            </button>

            <!-- Why the last move on the table was no decision ( a game with the rules engine ), for a
                 moment in place of the cards with an effect -->
            <div
                v-if="isEngine && engine.notice"
                class="engine-notice"
                :title="engine.notice"
            >
                {{ engine.notice }}
            </div>

            <!-- Cards with an effect -->
            <div
                v-else-if="glowInPlayEnabled"
                class="cards-during-current-phase"
                :class="{ 'has-effect': gameState.cardsDuringCurrentPhase.length > 0 }"
                @click="pingCardsDuringCurrentPhase"
            >
                {{ gameState.cardsDuringCurrentPhase.length }} cards with an effect
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGameBusStore } from '@/client/store/bus.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { resetLayout } from '@/client/game/display.ts'
import { resetFreeTableCamera } from '@/client/game/camera.ts'
import { useCommands } from '@/client/game/composables/useCommands.ts'
import CommandButton from '@/client/ui/ingame/CommandButton.vue'
import PopupMenu from '@/client/ui/components/PopupMenu.vue'
import EngineReport from '@/client/ui/ingame/EngineReport.vue'
import { useUIFeatures } from '@/client/game/composables/useUIFeatures.ts'
import { rollRandomResult } from '@/client/state/gameMutations.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { GameType } from '@/shared/types/state.ts'
import { useEngineStore } from '@/client/store/engine.ts'
import {
    engineOpportunities,
    engineReplay,
    setEngineOpportunities,
} from '@/client/engine/driver.ts'

const gameState = useGameStateStore()
const gameBus = useGameBusStore()
const players = usePlayersStore()
const commands = useCommands()

const { glowInPlayEnabled } = useUIFeatures()

const gameMenu = ref<InstanceType<typeof PopupMenu> | null>(null)
const engineReport = ref<InstanceType<typeof EngineReport> | null>(null)

const isEngine = computed(() => gameState.gameType == GameType.Engine)
const engine = useEngineStore()
// The pass of the decision under way, if any
const pass = computed(() => engine.pending?.options.find(option => option.kind == 'pass'))

// The replay ( the game's setup and every decision ) reproduces the game in the engine
async function exportReplay() {
    gameMenu.value?.close()
    const replay = await engineReplay()
    if (!replay) {
        return
    }
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([replay], { type: 'application/json' }))
    link.download = `zero-vtes-replay-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    link.click()
    URL.revokeObjectURL(link.href)
}

function openReport() {
    gameMenu.value?.close()
    engineReport.value?.show()
}

function openSecretInterface() {
    gameMenu.value?.close()
    gameBus.secretInterfaceShown = true
}

function callReferendum() {
    gameMenu.value?.close()
    gameMutations.REFERENDUM_call.actSelf({})
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
</script>

<style lang="scss">
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
    // Keep the contents right-anchored inside the fixed width. A no-op while the
    // flex:1 Unlock All button fills the row, but for spectators ( button hidden
    // via v-if ) it pushes the lone cards indicator to the right edge.
    justify-content: flex-end;
    // Match the fixed width of .phases (2 nav buttons + 5 phase boxes) so the
    // group's left edge lines up with the left edge of the phases block above.
    width: 262px;

    .engine-fixed-pass {
        // The pass fills the row
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-size: 15px;
        font-weight: bold;
        white-space: nowrap;

        &.decline {
            color: $status-amber;
            background: $alert-warning-bg;
            border-color: $status-amber;
        }
    }

    .engine-opportunities {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 11px;
        padding: 0 6px;
        white-space: nowrap;

        .engine-switch {
            position: relative;
            width: 24px;
            height: 12px;
            border-radius: 6px;
            background: $ash-grey;
            transition: background 0.2s;
        }

        .engine-switch-knob {
            position: absolute;
            top: 1px;
            left: 1px;
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: $ghost-white;
            transition: left 0.2s;
        }

        &.on {
            .engine-switch {
                background: $lighter-teal;
            }

            .engine-switch-knob {
                left: 13px;
            }
        }
    }

    .unlock-all-button {
        // Grow to fill the space left of the cards indicator, so the button's
        // left edge aligns with .phases while staying adjacent to the cards.
        flex: 1;
        white-space: nowrap;
    }
}

.engine-notice {
    display: flex;
    align-items: center;
    max-width: 130px;
    padding: 0 6px;
    background-color: rgb(165, 25, 45);
    color: white;
    font-size: 11px;
    font-weight: bold;
    line-height: 1.1;
    overflow: hidden;
    animation: EngineNotice 0.3s ease-out;
}

@keyframes EngineNotice {
    0% {
        background-color: rgb(235, 90, 40);
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
        // background-color: $purple-grey;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 35px;
        padding: 2px 5px;
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
                justify-content: center;
                min-width: 26px;

                padding: 3px 0;
                border: 1px solid $silver-grey;
                background: $dark-teal;
                color: white;
                cursor: pointer;

                &:hover {
                    filter: brightness(1.25);
                }
            }
        }
    }
}
</style>
