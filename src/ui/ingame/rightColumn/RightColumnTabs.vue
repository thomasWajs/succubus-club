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
            <div
                v-for="(logEntry, index) in history.orderedLogEntries"
                :key="'logEntry-' + index"
                class="log-line"
                :class="{ 'most-recent': index === history.logEntries.length - 1 }"
                @mouseover="onLogLineHover(logEntry)"
            >
                <span
                    v-if="
                        logEntry.mutationId &&
                        logEntry.mutationId == history.nextCancellableMutation?.id
                    "
                    class="cancel-arrow"
                    @click="history.nextCancellableMutation?.cancel()"
                >
                    ↩
                </span>
                <span class="time">
                    [{{ logEntry.timestamp.getHours().toString().padStart(2, '0') }}:{{
                        logEntry.timestamp.getMinutes().toString().padStart(2, '0')
                    }}]
                </span>
                <span
                    class="author"
                    :style="{ background: logEntry.authorColorRgba }"
                >
                    {{ logEntry.authorName }}
                </span>
                <span v-if="!logEntry.mutationId"> 🗩 </span>
                <span
                    v-if="logEntry.cancelText"
                    class="cancel-text"
                >
                    [Cancels <span v-html="logEntry.cancelText" />]
                </span>
                <span
                    v-if="
                        logEntry.mutationId && history.cancelledMutations.has(logEntry.mutationId)
                    "
                    class="cancel-text"
                >
                    [CANCELLED]
                </span>
                <span
                    class="mutation"
                    v-html="logEntry.text"
                />
            </div>
        </div>

        <div class="chat-box">
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

    <!-- Overlay backdrop when enlarged -->
    <div
        v-if="isEnlarged"
        class="enlarged-backdrop"
        @click="toggleEnlarged"
    />
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useBusStore, useGameBusStore } from '@/store/bus.ts'
import { LogEntry, useHistoryStore } from '@/store/history.ts'
import { saveGame, SavingState } from '@/gateway/savedGames.ts'
import { GameType } from '@/state/types.ts'
import { useCoreStore } from '@/store/core.ts'
import { broadcastChatMessage, requestResyncGameState } from '@/multiplayer/room.ts'
import UserManual from '@/ui/ingame/rightColumn/UserManual.vue'
import { useGameStateStore } from '@/store/gameState.ts'

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

function onLogLineHover(logEntry: LogEntry) {
    if (logEntry.closeUpCard) {
        // If there's a closeUpCard, that means it was visible at the time of log,
        // so we force canView = true, even if it's not visible anymore
        gameBus.setCloseUpCard(logEntry.closeUpCard, true)
    }
}

function scrollLog() {
    nextTick(() => {
        if (logLines.value) {
            logLines.value.scrollTop = logLines.value.scrollHeight
        }
    })
}
watch(history.logEntries, scrollLog)
watch(activeTab, scrollLog)

const chatMessageText = ref('')
const chatInput = ref<HTMLInputElement>()

function sendChatMessage() {
    // No message to send...
    if (!chatMessageText.value) {
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

    .log-line {
        margin-bottom: 2px;

        &.most-recent {
            animation: logAppear 1s linear;
        }
    }

    .cancel-arrow {
        font-weight: bold;
        color: $blood-red;
        cursor: pointer;
    }

    .time {
        margin: 0;
    }

    .author {
        margin: 0 2px;
        padding: 0 1px;
        font-weight: bold;
    }

    .cancel-text {
        font-style: italic;
        color: $dark-blood;
    }

    .mutation {
        display: inline;
    }

    :is(.cryptCard) {
        color: $crypt-orange;
        font-weight: bold;
    }

    :is(.libCard) {
        color: $library-green;
        font-weight: bold;
    }

    :is(.hidden) {
        color: $royal-purple;
        font-weight: bold;
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
</style>
