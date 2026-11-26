<template>
    <div class="tab-bar">
        <div
            v-for="tab in tabs"
            :key="tab.id"
            class="tab-slot"
        >
            <button
                class="tab-button"
                :class="{ active: activeTab === tab.id }"
                @click="activeTab = tab.id"
            >
                {{ tab.title }}
            </button>

            <!--Heads-up on the Manual tab for first-time users -->
            <div
                v-if="tab.id === 'manual' && showManualHeadsUp"
                class="manual-heads-up"
            >
                <div class="heads-up-arrow" />
                <div class="heads-up-content">
                    <div class="heads-up-message">
                        <Icon name="manual" /> Check out the <strong>Manual</strong> tab for help &
                        game commands !
                    </div>
                    <button
                        class="heads-up-button"
                        @click="dismissManualHeadsUp"
                    >
                        Got it
                    </button>
                </div>
            </div>
        </div>

        <button
            class="bar-button enlarge"
            :class="{ active: isEnlarged }"
            :title="isEnlarged ? 'Shrink' : 'Enlarge'"
            @click="toggleEnlarged"
        >
            {{ isEnlarged ? '⇲' : '⇱' }}
        </button>
    </div>

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
        v-if="activeTab === 'players'"
        class="tab players"
        :class="{ enlarged: isEnlarged }"
    >
        <RightColumnPlayers />
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

    <!-- Overlay backdrop when enlarged -->
    <div
        v-if="isEnlarged"
        class="enlarged-backdrop"
        @click="toggleEnlarged"
    />
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useHistoryStore } from '@/client/store/history.ts'
import { GameType } from '@/shared/types/state.ts'
import { sendChat } from '@/client/multiplayer/room.ts'
import UserManual from '@/client/ui/ingame/rightColumn/UserManual.vue'
import RightColumnPlayers from '@/client/ui/ingame/rightColumn/RightColumnPlayers.vue'
import Icon from '@/client/ui/components/Icon.vue'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import LogLine from '@/client/ui/ingame/rightColumn/LogLine.vue'
import { getAuthorColorRgba } from '@/shared/colors.ts'

const gameState = useGameStateStore()
const players = usePlayersStore()
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

// Seated players still connected, plus the judges and spectators
const connectedUsersCount = computed(() => {
    const playersCount = Object.values(gameState.players).filter(
        player => !players.disconnectedPlayers.has(player.oid),
    ).length
    return playersCount + multiplayer.judgeUsers.length + multiplayer.spectatorUsers.length
})

const tabs = computed(() => [
    { id: 'logs', title: 'Logs' },
    { id: 'players', title: `Connected (${connectedUsersCount.value})` },
    { id: 'manual', title: 'Manual' },
])

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
    // On the column's surface ( a gradient in the light theme )
    background-color: transparent;
    color: var(--ui-panel-text);
    transition: 0.6s cubic-bezier(0.4, 0, 0.2, 1);
    transition-property: padding, transform, width, height, max-width, max-height, box-shadow;
    position: relative;
    z-index: 1;

    // Floats over the tabletop : a flat fill of its own
    &.enlarged {
        background-color: var(--ui-column-bg);
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

.manual {
    padding: 12px;
}

// Tab buttons above the content, the enlarge button at the right end.
// A margin, not a padding : the close-up resize handle straddles the gap above
.tab-bar {
    @include column-tab-bar;
    margin-top: 4px;
    position: relative;
    z-index: 1001; /* Above the enlarged tab */

    .tab-slot {
        position: relative;
    }

    // Same icon button as the top bar. A toggle : when on, it stays filled
    .bar-button.enlarge {
        @include column-bar-button;
        margin-left: auto;
        margin-right: 5px;

        &.active {
            color: var(--ui-bar-text);
            background-color: light-dark(rgba($vibrant-emerald, 0.3), $ui-accent);
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

// Hangs below the Manual tab button, its arrow pointing up at it
.manual-heads-up {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 1002;
    animation: headsUpAppear 0.5s ease-out;

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
        top: -8px;
        right: 20px;
        width: 0;
        height: 0;
        border-left: 8px solid transparent;
        border-right: 8px solid transparent;
        border-bottom: 8px solid var(--ui-callout-bg);
    }
}

@keyframes headsUpAppear {
    0% {
        opacity: 0;
        transform: translateY(10px);
    }
    100% {
        opacity: 1;
        transform: translateY(0);
    }
}
</style>
