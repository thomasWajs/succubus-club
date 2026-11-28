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

        <div class="bar-buttons">
            <button
                v-if="activeTab === 'logs'"
                class="bar-button"
                :class="{ off: !showTime }"
                :title="showTime ? 'Hide the log times' : 'Show the log times'"
                @click="toggleShowTime"
            >
                <Icon name="time" />
            </button>

            <button
                class="bar-button"
                :class="{ active: isEnlarged }"
                :title="isEnlarged ? 'Shrink' : 'Enlarge'"
                @click="toggleEnlarged"
            >
                <Icon :name="isEnlarged ? 'shrink' : 'enlarge'" />
            </button>
        </div>
    </div>

    <div
        v-if="activeTab === 'logs'"
        class="tab logs"
        :class="{ enlarged: isEnlarged }"
    >
        <div class="log-lines-container">
            <div
                ref="logLines"
                class="log-lines"
                @scroll="onLogScroll"
            >
                <!-- The turn and phase of the lines at the top, once their separators are
                scrolled out. No height : the lines don't move when it shows -->
                <div class="sticky-top">
                    <button
                        v-if="stickyTurn"
                        class="log-sticky-header"
                        title="Go to the start of the turn"
                        @click="scrollToRow(stickyTurn.key)"
                    >
                        Turn {{ stickyTurn.turnNumber }}
                        <template v-if="stickyPlayer">
                            <span class="sticky-dot">·</span>
                            <span :style="{ color: stickyPlayer.color }">
                                {{ stickyPlayer.name }}
                            </span>
                        </template>
                        <template v-if="stickyPhase">
                            <span class="sticky-dot">·</span>
                            {{ stickyPhase.phaseName }} phase
                        </template>
                    </button>
                </div>

                <button
                    v-if="history.archive !== ''"
                    class="archive-button"
                    @click="openArchive"
                >
                    {{ showArchive ? 'Showing full history' : 'View full history' }}
                </button>

                <template
                    v-for="row in logRows"
                    :key="row.key"
                >
                    <LogLine
                        v-if="row.kind === 'line'"
                        :entries="row.entries"
                        :folded="row.folded"
                        :showAuthor="row.showAuthor"
                        :timeVisible="showTime"
                        :isMostRecent="rowEntries(row).includes(lastLogEntry)"
                        :isHighlighted="isHighlighted(row)"
                        @link="linkedMutationId = $event"
                    />
                    <LogSeparator
                        v-else
                        :row="row"
                        :isHighlighted="isHighlighted(row)"
                        :data-row-key="row.key"
                        @link="linkedMutationId = $event"
                    />
                </template>

                <!-- Lines added while reading higher up : the log doesn't jump down to them -->
                <div class="sticky-bottom">
                    <button
                        v-if="newLinesCount > 0"
                        class="new-lines-button"
                        @click="scrollLog"
                    >
                        {{ newLinesCount }} new
                    </button>
                </div>
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
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { useHistoryStore } from '@/client/store/history.ts'
import { GameType } from '@/shared/types/state.ts'
import { sendChat } from '@/client/multiplayer/room.ts'
import UserManual from '@/client/ui/ingame/rightColumn/UserManual.vue'
import RightColumnPlayers from '@/client/ui/ingame/rightColumn/RightColumnPlayers.vue'
import Icon from '@/client/ui/components/Icon.vue'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import LogLine from '@/client/ui/ingame/rightColumn/log/LogLine.vue'
import LogSeparator from '@/client/ui/ingame/rightColumn/log/LogSeparator.vue'
import {
    buildLogRows,
    LogRow,
    reuseLogRows,
    rowEntries,
    rowMutationIds,
} from '@/client/ui/ingame/rightColumn/log/logRows.ts'
import { getAuthorColorRgba } from '@/shared/colors.ts'
import { GameMutationId } from '@/shared/state/gameMutations.ts'
import { LogEntry } from '@/shared/types/history.ts'
import { logPlayerName } from '@/client/ui/ingame/rightColumn/log/logText.ts'

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

const logRows = computed<LogRow[]>(previousRows =>
    reuseLogRows(previousRows, buildLogRows(displayedLogEntries.value, history.cancelledMutations)),
)

const lastLogEntry = computed(() => history.logEntries[history.logEntries.length - 1])
// The last entry when the log was last at the bottom : the lines below it are new
const lastSeenEntry = shallowRef<LogEntry | undefined>(lastLogEntry.value)

/** Undos : hovering one highlights the undone entry, always close above **/

const linkedMutationId = ref<GameMutationId | null>(null)

function isHighlighted(row: LogRow) {
    const linked = linkedMutationId.value
    return linked !== null && rowMutationIds(row).includes(linked)
}

function scrollLog() {
    nextTick(() => {
        const scrollContainer = logLines.value
        if (!scrollContainer) {
            return
        }
        scrollContainer.scrollTop = scrollContainer.scrollHeight
    })
}

function isLogAtBottom(): boolean {
    const scrollContainer = logLines.value
    if (!scrollContainer) {
        return true
    }
    return (
        scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight < 80
    )
}

// Before the new entry is rendered : the log was at the bottom, it follows
watch(lastLogEntry, entry => {
    if (isLogAtBottom()) {
        lastSeenEntry.value = entry
        scrollLog()
    }
})
watch(activeTab, scrollLog)

function onLogScroll() {
    if (isLogAtBottom()) {
        lastSeenEntry.value = lastLogEntry.value
    }
    updateStickyHeader()
}

/** New lines : added below while reading higher up **/

const newLinesCount = computed(() => {
    const seen = lastSeenEntry.value
    if (seen === undefined || seen === lastLogEntry.value) {
        return 0
    }
    const rows = logRows.value
    const seenIndex = rows.findIndex(row => rowEntries(row).includes(seen))
    return seenIndex === -1 ? 0 : (
            rows.slice(seenIndex + 1).filter(row => row.kind === 'line').length
        )
})

/** Sticky header : the turn and phase of the lines at the top **/

const stickyTurnKey = ref<string | null>(null)
const stickyPhaseKey = ref<string | null>(null)

const rowByKey = computed(() => new Map(logRows.value.map(row => [row.key, row])))

function rowOfKey<Kind extends LogRow['kind']>(
    key: string | null,
    kind: Kind,
): Extract<LogRow, { kind: Kind }> | null {
    const row = key !== null ? rowByKey.value.get(key) : undefined
    return row?.kind === kind ? (row as Extract<LogRow, { kind: Kind }>) : null
}

const stickyTurn = computed(() => rowOfKey(stickyTurnKey.value, 'turn'))
const stickyPhase = computed(() => rowOfKey(stickyPhaseKey.value, 'phase'))
const stickyPlayer = computed(() => {
    const playerOid = stickyTurn.value?.activePlayerOid
    return playerOid ? logPlayerName(playerOid) : null
})

// The last turn separator scrolled out above the top, and the last phase separator after it
function updateStickyHeader() {
    const scrollContainer = logLines.value
    if (!scrollContainer) {
        return
    }
    const top = scrollContainer.getBoundingClientRect().top
    let turnKey: string | null = null
    let phaseKey: string | null = null
    for (const element of scrollContainer.querySelectorAll<HTMLElement>('[data-row-key]')) {
        if (element.getBoundingClientRect().bottom > top) {
            break
        }
        const row = rowByKey.value.get(element.dataset.rowKey ?? '')
        if (row?.kind === 'turn') {
            turnKey = row.key
            phaseKey = null
        } else if (row?.kind === 'phase') {
            phaseKey = row.key
        }
    }
    stickyTurnKey.value = turnKey
    stickyPhaseKey.value = phaseKey
}

watch([logRows, isEnlarged], () => nextTick(updateStickyHeader))

function scrollToRow(key: string) {
    logLines.value
        ?.querySelector(`[data-row-key="${CSS.escape(key)}"]`)
        ?.scrollIntoView({ block: 'start' })
}

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

        .log-lines {
            height: 100%;
            overflow-x: hidden;
            overflow-y: scroll;
            font-size: 14px;
        }

        // Stuck to the top and bottom of the scrolled lines, without a height of their own
        .sticky-top,
        .sticky-bottom {
            position: sticky;
            height: 0;
            z-index: 2;
        }
        .sticky-top {
            top: 0;
        }
        .sticky-bottom {
            bottom: 0;
        }

        // Like a phase separator, on a flat fill over the lines
        .log-sticky-header {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            padding: 3px 8px;
            border: none;
            border-bottom: solid 1px light-dark(rgba($shadow-grey, 0.45), $ui-border);
            background-color: var(--ui-column-bg);
            color: var(--ui-panel-text-muted);
            font-size: 12px;
            font-weight: 600;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            text-align: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            cursor: pointer;

            &:hover {
                color: var(--ui-panel-text);
            }

            .sticky-dot {
                margin: 0 2px;
                opacity: 0.6;
            }
        }

        .new-lines-button {
            position: absolute;
            bottom: 6px;
            left: 50%;
            transform: translateX(-50%);
            padding: 2px 10px;
            border: solid 1px var(--ui-border);
            background: var(--ui-control-bg);
            color: var(--ui-contrast-text);
            font-size: 12px;
            font-weight: 600;
            white-space: nowrap;
            cursor: pointer;

            &:hover {
                filter: brightness(125%);
            }
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

    // Log times and enlarge, at the right end
    .bar-buttons {
        display: flex;
        flex-shrink: 0;
        gap: 4px;
        margin-left: auto;
        margin-right: 5px;
    }

    // Same icon buttons as the top bar. Enlarge stays filled while on ; the time toggle is
    // dimmed while off ( it is on most of the time )
    .bar-button {
        @include column-bar-button;

        &.active {
            color: var(--ui-bar-text);
            background-color: light-dark(rgba($vibrant-emerald, 0.3), $ui-accent);
        }

        &.off {
            opacity: 0.45;
        }
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
