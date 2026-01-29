<template>
    <div
        v-if="activeTab === 'logs'"
        class="tab logs"
        :class="{ enlarged: isEnlarged }"
    >
        <div
            ref="logLines"
            class="log-lines"
        >
            <LogLine
                v-for="(logEntry, index) in history.logEntries"
                :key="'logEntry-' + index"
                :logEntry="logEntry"
                :index="index"
            />
        </div>

        <div
            v-if="gameState.isPlayer"
            class="chat-box"
        >
            <input
                ref="chatInput"
                v-model="chatMessageText"
                type="text"
                class="chat-input"
                placeholder="Say something..."
                @keydown.stop
                @keyup.stop
                @keydown.enter="sendChatMessage"
            />
            <button
                class="chat-send"
                @click="sendChatMessage"
            >
                Send
            </button>
        </div>
    </div>

    <div
        v-if="activeTab === 'menu'"
        class="tab menu"
        :class="{ enlarged: isEnlarged }"
    >
        <button
            class="game-button"
            :disabled="gameBus.savingState != SavingState.None"
            @click="saveGame(false)"
        >
            <template v-if="gameBus.savingState == SavingState.Saving"> 💾Saving... </template>
            <template v-else-if="gameBus.savingState == SavingState.AutoSaving">
                💾Auto-Saving...
            </template>
            <template v-else-if="gameBus.savingState == SavingState.Done"> 👍Save OK </template>
            <template v-else-if="gameBus.savingState == SavingState.Error"> 😵Save Error </template>
            <template v-else>Save Game</template>
        </button>

        <button
            v-if="core.gameType == GameType.Multiplayer"
            class="game-button"
            @click="requestResyncGameState(true)"
        >
            Resync Game
        </button>

        <button
            class="game-button"
            @click="bus.isUserProfilePanelOpen = true"
        >
            User preferences
        </button>

        <button
            class="game-button"
            @click="leaveDialog?.showModal()"
        >
            Leave game
        </button>
    </div>

    <div
        v-if="isEnlarged"
        class="tab placeholder"
    />

    <div
        v-if="activeTab === 'manual'"
        class="tab manual"
        :class="{ enlarged: isEnlarged }"
    >
        <UserManual />
    </div>

    <div class="tabs">
        <button
            class="tab-button enlarge"
            :class="{ active: isEnlarged }"
            @click="toggleEnlarged"
        >
            {{ isEnlarged ? '⇲' : '⇱' }}
        </button>

        <button
            v-for="tab in tabs"
            :key="tab.id"
            class="tab-button"
            :class="{ active: activeTab === tab.id, enlarged: isEnlarged }"
            @click="activeTab = tab.id"
        >
            {{ tab.title }}
        </button>
    </div>

    <!--Heads-up on the Manual tab for first-time users -->
    <div
        v-if="showManualHeadsUp"
        class="manual-heads-up"
        :class="{ enlarged: isEnlarged }"
    >
        <div class="heads-up-content">
            <div class="heads-up-message">
                📖 Check out the <strong>Manual</strong> tab for help & game commands !
            </div>
            <button
                class="heads-up-button"
                @click="dismissManualHeadsUp"
            >
                Got it
            </button>
        </div>
        <div class="heads-up-arrow" />
    </div>

    <!-- Overlay backdrop when enlarged -->
    <div
        v-if="isEnlarged"
        class="enlarged-backdrop"
        @click="toggleEnlarged"
    />

    <!-- Leave game confirmation dialog -->
    <dialog
        ref="leaveDialog"
        class="leave-game-dialog"
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
                    @click="leaveGame"
                >
                    Leave
                </button>
            </div>
        </div>
    </dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useBusStore, useGameBusStore } from '@/client/store/bus.ts'
import { useHistoryStore } from '@/client/store/history.ts'
import { saveGame, SavingState } from '@/client/gateway/savedGames.ts'
import { GameType } from '@/shared/types/state.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { broadcastChatMessage, requestResyncGameState } from '@/client/multiplayer/room.ts'
import UserManual from '@/client/ui/ingame/rightColumn/UserManual.vue'
import { useGameStateStore } from '@/client/store/gameState.ts'
import LogLine from '@/client/ui/ingame/rightColumn/LogLine.vue'
import router, { ROUTES } from '@/client/ui/router.ts'
import { leaveMultiplayer } from '@/client/multiplayer/lobby.ts'
import { resetState } from '@/client/game/setup.ts'

const core = useCoreStore()
const gameState = useGameStateStore()
const bus = useBusStore()
const gameBus = useGameBusStore()
const history = useHistoryStore()

/** Tab Management **/

const activeTab = ref('logs')
const isEnlarged = ref(false)

const tabs = [
    { id: 'logs', title: 'Logs' },
    { id: 'menu', title: 'Menu' },
    { id: 'manual', title: 'Manual' },
]

function toggleEnlarged() {
    isEnlarged.value = !isEnlarged.value
}

/** Logs Tab **/

const logLines = ref<HTMLDivElement>()

function scrollLog() {
    nextTick(() => {
        if (logLines.value) {
            logLines.value.scrollTop = logLines.value.scrollHeight
        }
    })
}
watch(() => history.logEntries.length, scrollLog)
watch(activeTab, scrollLog)

const chatMessageText = ref('')
const chatInput = ref<HTMLInputElement>()

function sendChatMessage() {
    // No message to send...
    if (!chatMessageText.value || !gameState.selfPlayer) {
        return
    }
    const chatMessage = {
        text: chatMessageText.value,
        timestamp: new Date(),
        player: gameState.selfPlayer,
    }
    chatMessageText.value = ''
    chatInput.value?.blur()

    history.addChatMessage(chatMessage)
    if (core.gameType == GameType.Multiplayer) {
        broadcastChatMessage(chatMessage)
    }
}

/** Menu actions **/

const leaveDialog = ref<HTMLDialogElement>()

function leaveGame() {
    leaveMultiplayer()
    resetState()
    router.push({ name: ROUTES.MainMenu })
}

/** Manual Heads-up Management **/

const MANUAL_HEADSUP_STORAGE_KEY = 'manual-headsup-dismissed'
// Check if user has already seen the manual heads-up
const dismissed = localStorage.getItem(MANUAL_HEADSUP_STORAGE_KEY)
const hasSeenManualHeadsUp = ref(dismissed === 'true')

const showManualHeadsUp = computed(() => {
    return !hasSeenManualHeadsUp.value && !isEnlarged.value
})

function dismissManualHeadsUp() {
    hasSeenManualHeadsUp.value = true
    localStorage.setItem(MANUAL_HEADSUP_STORAGE_KEY, 'true')
}
</script>

<style lang="scss" scoped>
.tab {
    overflow-y: auto;
    flex-grow: 1;
    padding: 4px;
    background-color: $right-column-section-bg;
    transition: 0.6s cubic-bezier(0.4, 0, 0.2, 1);
    transition-property: padding, transform, width, height, max-width, max-height, box-shadow;
    position: relative;
    z-index: 1;

    &.enlarged {
        padding: 12px;
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) translateX(-150px);
        width: 70vw;
        height: 80vh;
        max-width: 1000px;
        max-height: 700px;
        z-index: 1000;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
        border-radius: 4px;
        border: 2px solid $purple-grey;
    }

    &.placeholder {
        background-color: $purple-grey;
    }
}

.enlarged-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.1);
    z-index: 999;
    transition: opacity 0.6s ease;
}

.logs {
    overflow: hidden;
    display: flex;
    flex-direction: column;

    .chat-box {
        display: flex;
        margin-top: 10px;
        margin-bottom: 5px;

        .chat-input {
            flex-grow: 1;
            margin-right: 5px;
        }
    }

    .log-lines {
        flex-grow: 1;
        overflow-x: auto;
        overflow-y: scroll;
        font-size: 15px;
    }

    &.enlarged {
        font-size: 16px;
    }
}

.menu {
    padding: 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;

    .game-button {
        width: 100%;
        max-width: 200px;
    }
}

.manual {
    padding: 12px;
}

.tabs {
    padding-bottom: 4px;
    position: relative;
    z-index: 1001; /* Above the enlarged tab */

    .tab-button {
        margin: 0 6px 0 0;
        padding: 4px 5px;
        border-radius: 0 0 4px 4px;
        border: none;
        color: $pearl-grey;
        background: $purple-grey;
        cursor: pointer;
        transition: all 0.2s ease;

        &:not(.enlarge) {
            font-weight: 600;
            font-style: italic;
        }

        &.active:not(.enlarge) {
            color: $shadow-grey;
            background: $right-column-section-bg;
            cursor: default;
        }

        &:hover:not(.active) {
            filter: brightness(150%);
        }

        &.enlarged {
            border-radius: 4px;
        }

        &.enlarge {
            min-width: 24px;

            &.active {
                color: $vibrant-emerald;
                background-color: rgba($vibrant-emerald, 0.3);
            }
        }
    }
}

@keyframes logAppear {
    0% {
        background-color: transparent;
    }
    10% {
        background-color: $light-teal;
    }
    100% {
        background-color: transparent;
    }
}

.manual-heads-up {
    position: absolute;
    bottom: 10px;
    right: 210px;
    z-index: 1002;
    animation: headsUpAppear 0.5s ease-out;

    &.enlarged {
        display: none;
    }

    .heads-up-content {
        background: $shadow-purple;
        padding: 12px 16px;
        min-width: 260px;
        max-width: 300px;
        color: $ghost-white;
        font-size: 14px;
        line-height: 1.4;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .heads-up-message {
        text-align: left;

        strong {
            color: #ffd700;
        }
    }

    .heads-up-button {
        @include button-grey;
        align-self: flex-end;
        color: $ghost-white;
        padding: 6px 12px;
    }

    .heads-up-arrow {
        position: absolute;
        right: -8px;
        bottom: 0;
        width: 0;
        height: 0;
        border-top: 8px solid transparent;
        border-bottom: 8px solid transparent;
        border-left: 8px solid $shadow-purple;
    }
}

@keyframes headsUpAppear {
    0% {
        opacity: 0;
        transform: translateX(20px);
    }
    100% {
        opacity: 1;
        transform: translateX(0);
    }
}

.leave-game-dialog {
    border: 2px solid $shadow-grey;
    padding: 0;
    background: $ash-grey;
    max-width: 400px;

    &::backdrop {
        background: rgba(0, 0, 0, 0.5);
    }

    .dialog-content {
        padding: 24px;
        color: $ghost-white;

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
                border-color: $shadow-grey;
            }
        }
    }
}
</style>
