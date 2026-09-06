<template>
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

            <PopupMenu
                ref="gameMenu"
                label="Game"
            >
                <button
                    class="game-button"
                    :disabled="!!gameState.referendum"
                    @click="callReferendum"
                >
                    Call Referendum
                </button>
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
                <button
                    class="game-button"
                    @click="openSecretInterface"
                >
                    Secret Choice
                </button>
            </PopupMenu>
        </div>

        <!-- Right-anchored controls, aligned under the phases block -->
        <div class="right-controls">
            <CommandButton
                v-if="players.isPlayer"
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
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useGameBusStore } from '@/client/store/bus.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { resetLayout } from '@/client/game/display.ts'
import { useCommands } from '@/client/game/composables/useCommands.ts'
import CommandButton from '@/client/ui/ingame/CommandButton.vue'
import PopupMenu from '@/client/ui/components/PopupMenu.vue'
import { useHistoryStore } from '@/client/store/history.ts'
import { useUIFeatures } from '@/client/game/composables/useUIFeatures.ts'
import { rollRandomResult } from '@/client/state/gameMutations.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'

const gameState = useGameStateStore()
const gameBus = useGameBusStore()
const players = usePlayersStore()
const history = useHistoryStore()
const commands = useCommands()

const { glowInPlayEnabled } = useUIFeatures()

const gameMenu = ref<InstanceType<typeof PopupMenu> | null>(null)

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
