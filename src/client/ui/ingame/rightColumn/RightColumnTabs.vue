<template>
    <div
        v-if="activeTab === 'logs'"
        class="tab logs"
        :class="{ enlarged: isEnlarged }"
    >
        <div class="log-lines-container">
            <button
                class="toggle-time-button"
                :title="showTime ? 'Hide timestamps' : 'Show timestamps'"
                @click="toggleShowTime"
            >
                [HH:MM]
            </button>

            <div
                ref="logLines"
                class="log-lines"
            >
                <button
                    v-if="history.archive !== ''"
                    class="archive-button"
                    @click="openArchive"
                >
                    {{ showArchive ? 'Showing full history' : 'View full history' }}
                </button>

                <LogLine
                    v-for="(logEntry, index) in displayedLogEntries"
                    :key="'logEntry-' + index"
                    :logEntry="logEntry"
                    :index="index"
                    :showTime="showTime"
                />
            </div>
        </div>

        <div
            v-if="players.isPlayer || multiplayer.selfIsJudge"
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
            @click="requestResyncGameState(true)"
        >
            Resync Game
        </button>

        <button
            class="menu-button"
            @click="bus.isUserProfilePanelOpen = true"
        >
            User preferences
        </button>

        <button
            v-if="isFeedbackAvailable()"
            class="menu-button"
            @click="openFeedbackForm"
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
            :title="multiplayer.selfIsRoomWriter ? '' : 'Only the room host can start a new table'"
            @click="newTableDialog?.showModal()"
        >
            New table
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

        <!-- Each side is drawn in the colours of its theme -->
        <div
            class="theme-toggle"
            title="Interface theme"
        >
            <button
                v-for="option in UI_THEME_CHOICES"
                :key="option.value"
                class="theme-option"
                :class="[option.value, { active: uiThemeChoice === option.value }]"
                @click="setUiThemeChoice(option.value)"
            >
                {{ option.label }}
            </button>
        </div>
    </div>

    <!--Heads-up on the Manual tab for first-time users -->
    <div
        v-if="showManualHeadsUp"
        class="manual-heads-up"
        :class="{ enlarged: isEnlarged }"
    >
        <div class="heads-up-content">
            <div class="heads-up-message">
                <Icon name="manual" /> Check out the <strong>Manual</strong> tab for help & game
                commands !
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

    <!-- New table confirmation dialog -->
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
import { computed, nextTick, ref, watch } from 'vue'
import { useBusStore, useGameBusStore } from '@/client/store/bus.ts'
import { useHistoryStore } from '@/client/store/history.ts'
import { saveGame, SavingState } from '@/client/gateway/savedGames.ts'
import { GameType } from '@/shared/types/state.ts'
import { requestResyncGameState, sendChat, startNewTable } from '@/client/multiplayer/room.ts'
import UserManual from '@/client/ui/ingame/rightColumn/UserManual.vue'
import Icon from '@/client/ui/components/Icon.vue'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import LogLine from '@/client/ui/ingame/rightColumn/LogLine.vue'
import { leaveGame } from '@/client/state/setup.ts'
import { getAuthorColorRgba } from '@/shared/colors.ts'
import { isFeedbackAvailable, openFeedbackForm } from '@/client/logging.ts'
import { setUiThemeChoice, UI_THEME_CHOICES, uiThemeChoice } from '@/client/gateway/uiTheme.ts'

const gameState = useGameStateStore()
const players = usePlayersStore()
const bus = useBusStore()
const gameBus = useGameBusStore()
const history = useHistoryStore()
const multiplayer = useMultiplayerStore()

/** Tab Management **/

const activeTab = ref('logs')
const isEnlarged = ref(false)
const showArchive = ref(false)

/** Log time toggle **/

const SHOW_TIME_STORAGE_KEY = 'log-show-time'
const showTime = ref(localStorage.getItem(SHOW_TIME_STORAGE_KEY) !== 'false')

function toggleShowTime() {
    showTime.value = !showTime.value
    localStorage.setItem(SHOW_TIME_STORAGE_KEY, String(showTime.value))
}

const tabs = [
    { id: 'logs', title: 'Logs' },
    { id: 'menu', title: 'Menu' },
    { id: 'manual', title: 'Manual' },
]

function toggleEnlarged() {
    isEnlarged.value = !isEnlarged.value
    if (!isEnlarged.value) {
        showArchive.value = false
    }
}

function openArchive() {
    isEnlarged.value = true
    showArchive.value = true
}

/** Logs Tab **/

const logLines = ref<HTMLDivElement>()

const archivedLogEntries = computed(() => {
    if (!showArchive.value || !history.archive) {
        return []
    }
    return history.getArchivedHistory(gameState.gameId).logEntries
})

const displayedLogEntries = computed(() => {
    if (showArchive.value) {
        return [...archivedLogEntries.value, ...history.logEntries]
    }
    return history.logEntries
})

function scrollLog() {
    nextTick(() => {
        const scrollContainer = logLines.value
        if (!scrollContainer) {
            return
        }
        scrollContainer.scrollTop = scrollContainer.scrollHeight
    })
}
function scrollLogIfAtBottom() {
    const scrollContainer = logLines.value
    if (!scrollContainer) {
        return
    }
    const isAtBottom =
        scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight < 80
    if (isAtBottom) {
        scrollLog()
    }
}

watch(() => history.logEntries.length, scrollLogIfAtBottom)
watch(activeTab, scrollLog)

const chatMessageText = ref('')
const chatInput = ref<HTMLInputElement>()

function sendChatMessage() {
    const text = chatMessageText.value
    if (!text) {
        return
    }

    // A seated player chats under their player identity ( name + colour ). A judge has
    // no player, so they chat under their user name with the default colour.
    let authorName: string
    let authorColorRgba: string | undefined
    if (players.selfPlayer) {
        authorName = players.selfPlayer.name
        authorColorRgba = getAuthorColorRgba(players.selfPlayer.rgbaColor)
    } else if (multiplayer.selfIsJudge) {
        authorName = multiplayer.selfUser.name
    } else {
        return
    }

    const chatMessage = { text, timestamp: new Date(), authorName, authorColorRgba }
    chatMessageText.value = ''
    chatInput.value?.focus()

    if (gameState.gameType == GameType.Multiplayer) {
        // The transport echoes/delivers ( and, in SCS, the server sets the author ).
        sendChat(chatMessage)
    } else {
        // Solo game ( trainbot / puppeteer ) : chat is local only.
        history.addChatMessage(chatMessage)
    }
}

/** Menu actions **/

const leaveDialog = ref<HTMLDialogElement>()
const newTableDialog = ref<HTMLDialogElement>()

async function confirmNewTable() {
    newTableDialog.value?.close()
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
    background-color: var(--ui-section-bg);
    color: var(--ui-panel-text);
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
        border: 2px solid var(--ui-column-border);
    }

    &.placeholder {
        background-color: var(--ui-column-bg);
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

    .archive-button {
        @include button-grey;
        font-size: 15px;
        padding: 6px 10px;
        margin-bottom: 8px;
    }

    .chat-box {
        display: flex;
        margin-top: 10px;
        margin-bottom: 5px;

        .chat-input {
            flex-grow: 1;
            margin-right: 5px;
            @include ui-input;
            padding: 3px 5px;
        }

        .chat-send {
            padding: 2px 10px;
            border: solid 1px var(--ui-border);
            background: var(--ui-control-bg);
            color: var(--ui-contrast-text);
            font-weight: 600;
            cursor: pointer;

            &:hover {
                filter: brightness(125%);
            }
        }
    }

    .log-lines-container {
        flex-grow: 1;
        overflow: hidden;
        position: relative;

        .toggle-time-button {
            position: absolute;
            top: 0;
            right: 20px;
            z-index: 10;
            font-size: 11px;
            padding: 2px;
            cursor: pointer;
            border: 1px solid var(--ui-toggle-border);
            background: var(--ui-toggle-bg);
            color: var(--ui-chrome-text-muted);
            opacity: 0.6;
            font-family: $font-mono;

            &:hover {
                opacity: 1;
                color: var(--ui-text-on-dark);
            }
        }

        .log-lines {
            height: 100%;
            overflow-x: auto;
            overflow-y: scroll;
            font-size: 15px;
        }
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

    .menu-button {
        @include button-purple;
        // Square corners, a tighter box than the lobby buttons
        border-radius: 0;
        padding: 8px 12px;
        font-size: 15px;
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
    display: flex;
    align-items: flex-start;
    // Below this width the theme toggle would run into the tabs : it hides
    container-type: inline-size;

    // Right end of the tab row. Each side previews its theme; the current one is the only one
    // fully opaque ( no underline, it would read as a tab )
    .theme-toggle {
        display: flex;
        flex-shrink: 0;
        align-self: stretch; // As tall as the tabs
        margin-left: auto;
        border: 1px solid light-dark($slate-grey, $ui-border);
        border-top: none;

        @container (max-width: 330px) {
            display: none;
        }

        .theme-option {
            padding: 3px 6px;
            border: none;
            font-family: $ui-font;
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            opacity: 0.55;
            cursor: pointer;
            transition: opacity 0.2s ease;

            &.dark {
                background: $ui-background;
                color: $ui-text;
            }

            // A shade above the light column, so the swatch stands out on it
            &.light {
                background: $ghost-white;
                color: $shadow-grey;
            }

            // In between : it resolves to either theme
            &.system {
                background: $mist-grey;
                color: white;
            }

            &:hover {
                opacity: 0.85;
            }

            &.active {
                opacity: 1;
                cursor: default;
            }
        }
    }

    .tab-button {
        margin: 0 6px 0 0;
        padding: 4px 5px;
        border-radius: 0 0 4px 4px;
        border: none;
        color: var(--ui-chrome-text-muted);
        background: light-dark($purple-grey, $ui-surface-raised);
        cursor: pointer;
        transition: all 0.2s ease;

        &:not(.enlarge) {
            font-weight: 600;
            font-style: italic;
        }

        &.active:not(.enlarge) {
            color: var(--ui-panel-text);
            background: var(--ui-section-bg);
            border-bottom: solid 2px var(--ui-accent-line);
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
                color: light-dark($vibrant-emerald, $ui-text);
                background-color: light-dark(rgba($vibrant-emerald, 0.3), $ui-accent);
            }
        }
    }
}

@keyframes logAppear {
    0% {
        background-color: transparent;
    }
    10% {
        background-color: light-dark($light-teal, $ui-accent);
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
        background: var(--ui-callout-bg);
        padding: 12px 16px;
        min-width: 260px;
        max-width: 300px;
        color: var(--ui-text-on-dark);
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
        color: var(--ui-text-on-dark);
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
        border-left: 8px solid var(--ui-callout-bg);
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
