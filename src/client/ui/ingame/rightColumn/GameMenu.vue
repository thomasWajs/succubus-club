<template>
    <dialog
        ref="menuDialog"
        class="game-menu"
        @click.self="close"
    >
        <div class="menu-content">
            <h3>Menu</h3>

            <button
                class="menu-button"
                :disabled="gameBus.savingState != SavingState.None"
                @click="saveGame(false)"
            >
                <template v-if="gameBus.savingState == SavingState.Saving">
                    <Icon name="save" /> Saving...
                </template>
                <template v-else-if="gameBus.savingState == SavingState.AutoSaving">
                    <Icon name="save" /> Auto-Saving...
                </template>
                <template v-else-if="gameBus.savingState == SavingState.Done">
                    <Icon name="success" /> Save OK
                </template>
                <template v-else-if="gameBus.savingState == SavingState.Error">
                    <Icon name="error" /> Save Error
                </template>
                <template v-else>Save Game</template>
            </button>

            <button
                v-if="gameState.gameType == GameType.Multiplayer"
                class="menu-button"
                @click="resyncGame"
            >
                Resync Game
            </button>

            <button
                v-if="isFeedbackAvailable()"
                class="menu-button"
                @click="reportBug"
            >
                Report a bug
            </button>

            <button
                class="menu-button"
                @click="leaveDialog?.showModal()"
            >
                Leave game
            </button>

            <button
                v-if="gameState.gameType == GameType.Multiplayer"
                class="menu-button"
                :disabled="!multiplayer.selfIsRoomWriter"
                :title="
                    multiplayer.selfIsRoomWriter ? '' : 'Only the room host can start a new table'
                "
                @click="newTableDialog?.showModal()"
            >
                New table
            </button>

            <button
                class="menu-button close-button"
                @click="close"
            >
                Back to the game
            </button>
        </div>
    </dialog>

    <!-- Leave game confirmation dialog, stacked over the menu -->
    <dialog
        ref="leaveDialog"
        class="confirm-dialog"
    >
        <div class="dialog-content">
            <h3>Leave Game?</h3>
            <p>Are you sure you want to leave the game?</p>
            <div class="dialog-buttons">
                <button
                    class="game-button cancel is-muted"
                    @click="leaveDialog?.close()"
                >
                    Cancel
                </button>
                <button
                    class="game-button"
                    @click="leaveGame(true)"
                >
                    Leave
                </button>
            </div>
        </div>
    </dialog>

    <!-- New table confirmation dialog, stacked over the menu -->
    <dialog
        ref="newTableDialog"
        class="confirm-dialog"
    >
        <div class="dialog-content">
            <h3>Start a new table?</h3>
            <p>
                The current game will be ended for everyone, and all players will be sent back to
                the game room.
            </p>
            <div class="dialog-buttons">
                <button
                    class="game-button cancel is-muted"
                    @click="newTableDialog?.close()"
                >
                    Cancel
                </button>
                <button
                    class="game-button"
                    @click="confirmNewTable"
                >
                    New table
                </button>
            </div>
        </div>
    </dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useBusStore, useGameBusStore } from '@/client/store/bus.ts'
import { saveGame, SavingState } from '@/client/gateway/savedGames.ts'
import { GameType } from '@/shared/types/state.ts'
import { requestResyncGameState, startNewTable } from '@/client/multiplayer/room.ts'
import Icon from '@/client/ui/components/Icon.vue'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { leaveGame } from '@/client/state/setup.ts'
import { isFeedbackAvailable, openFeedbackForm } from '@/client/logging.ts'

const gameState = useGameStateStore()
const bus = useBusStore()
const gameBus = useGameBusStore()
const multiplayer = useMultiplayerStore()

const menuDialog = ref<HTMLDialogElement>()
const leaveDialog = ref<HTMLDialogElement>()
const newTableDialog = ref<HTMLDialogElement>()

function close() {
    menuDialog.value?.close()
}

// The actions below open something outside the menu : a modal dialog makes the rest of the
// page inert, so the menu closes first

function resyncGame() {
    close()
    requestResyncGameState(true)
}

function reportBug() {
    close()
    openFeedbackForm()
}

async function confirmNewTable() {
    newTableDialog.value?.close()
    close()
    try {
        await startNewTable()
    } catch (error) {
        let message = 'Could not start a new table'
        if (error instanceof Error) {
            message = `${message} : ${error.message}`
        }
        bus.alertError(message)
    }
}

defineExpose({
    open: () => menuDialog.value?.showModal(),
})
</script>

<style lang="scss" scoped>
.game-menu {
    @include modal-dialog;
}

.menu-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    width: 280px;
    padding: 24px;
    border: 2px solid var(--ui-border);
    background: var(--ui-floating-bg);
    color: var(--ui-text-on-dark);

    h3 {
        margin: 0 0 6px 0;
        font-size: 20px;
    }

    .menu-button {
        @include button-purple;
        // Square corners, a tighter box than the lobby buttons
        border-radius: 0;
        padding: 8px 12px;
        font-size: 15px;
        width: 100%;
    }

    // Same box as the actions, in the neutral grey of a dismiss button
    .close-button {
        margin-top: 6px;
        background: linear-gradient(135deg, $bone-grey 0%, $ash-grey 100%);
        color: $silver-grey;
    }
}

.confirm-dialog {
    border: 2px solid var(--ui-border);
    padding: 0;
    background: var(--ui-floating-bg);
    max-width: 400px;

    &::backdrop {
        background: rgba(0, 0, 0, 0.5);
    }

    .dialog-content {
        padding: 24px;
        color: var(--ui-text-on-dark);

        h3 {
            margin: 0;
            font-size: 20px;
        }

        p {
            margin: 12px 0 24px 0;
            font-size: 15px;
        }

        .dialog-buttons {
            display: flex;
            gap: 12px;
            justify-content: flex-end;

            .game-button {
                min-width: 80px;
                border-color: var(--ui-border);
            }
        }
    }
}
</style>
