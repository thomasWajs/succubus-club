<template>
    <TopBar />

    <div class="lobby-container main-content">
        <div
            v-if="showReconnectSuggestion"
            class="reconnect-banner"
        >
            <span>Your previous game is still running.</span>
            <button
                class="reconnect-banner-btn"
                :disabled="isConnecting"
                @click="startConnectIntoGame(showReconnectSuggestion)"
            >
                <template v-if="isConnecting">
                    <span class="reconnect-spinner" />
                    Reconnecting...
                </template>
                <template v-else> Click here to reconnect </template>
            </button>
        </div>

        <div
            class="lobby-content"
            :class="{ 'has-banner': showReconnectSuggestion }"
        >
            <!-- Players Online Sidebar -->
            <div class="players-sidebar">
                <div class="players-panel">
                    <h3 class="panel-title">
                        Players Online ({{ Object.keys(multiplayer.users).length }})
                    </h3>

                    <div class="player-list">
                        <div
                            v-for="user in Object.values(multiplayer.users)"
                            :key="user.permId"
                            class="player-item"
                        >
                            <div class="player-avatar">
                                <UserAvatar
                                    :avatar="
                                        user.avatarId ? multiplayer.avatars[user.avatarId] : null
                                    "
                                    :playerName="user.name"
                                    width="30px"
                                    height="30px"
                                    fontSize="14px"
                                />
                            </div>
                            <span class="player-name">{{ user.name }}</span>
                        </div>
                    </div>

                    <div
                        v-if="showDiscoveryMessage"
                        class="discovery-message"
                    >
                        ⏳ Discovering players... This may take a few seconds
                    </div>
                </div>
            </div>

            <!-- Available Rooms -->
            <div class="rooms-panel">
                <div class="rooms-header">
                    <h3 class="panel-title no-margin">
                        Rooms ({{ Object.keys(multiplayer.gameRooms).length }})
                    </h3>
                    <div
                        class="scs-status"
                        :class="{
                            'scs-connecting': multiplayer.scsStatus === ScsStatus.Connecting,
                            'scs-online': multiplayer.scsStatus === ScsStatus.Connected,
                            'scs-offline': multiplayer.scsStatus === ScsStatus.Disconnected,
                        }"
                    >
                        <span class="scs-indicator" />
                        <span class="scs-label"
                            >SCS :
                            {{
                                multiplayer.scsStatus === ScsStatus.Connecting ? 'Connecting'
                                : multiplayer.scsStatus === ScsStatus.Connected ? 'Online'
                                : 'Offline'
                            }}</span
                        >
                    </div>
                </div>

                <!-- Room List -->
                <div class="room-list">
                    <div
                        v-if="Object.keys(multiplayer.gameRooms).length === 0"
                        class="no-rooms-message"
                    >
                        No rooms available. Create one to get started!
                    </div>

                    <div
                        v-for="gameRoom of Object.values(multiplayer.gameRooms)"
                        :key="gameRoom.id"
                        class="room-item"
                        :class="{
                            'room-selected': multiplayer.currentGameRoomId === gameRoom.id,
                        }"
                    >
                        <div class="room-info">
                            <div class="room-info-left">
                                <span class="room-lock">
                                    <template v-if="gameRoom.hasPassword">🔒</template>
                                </span>
                                <span class="room-setting-badge">
                                    {{ gameRoom.isCasual ? 'Casual' : 'Competitive' }}
                                </span>
                                <span class="room-setting-badge">
                                    {{
                                        gameRoom.communication === CommunicationMode.Ably ?
                                            'Direct'
                                        :   'SCS'
                                    }}
                                </span>
                                <h4 class="room-name">{{ gameRoom.name }}</h4>
                            </div>
                            <div class="room-info-right">
                                <span
                                    v-if="gameRoom.isSavedGame && !gameRoom.isStarted"
                                    class="blue-secondary-badge"
                                >
                                    Saved Game
                                </span>
                                <span
                                    v-if="gameRoom.isStarted"
                                    class="red-secondary-badge"
                                >
                                    Game Started
                                </span>
                                <span class="player-count">
                                    {{ gameRoom.players?.length }}/5 Players
                                </span>
                                <div
                                    v-if="gameRoom.hasPassword"
                                    class="password-input-wrapper"
                                >
                                    <input
                                        v-model="roomPasswords[gameRoom.id]"
                                        type="text"
                                        class="room-password-input"
                                        :class="{
                                            'password-error-input': roomPasswordErrors[gameRoom.id],
                                        }"
                                        placeholder="Enter password to join..."
                                        @click.stop
                                        @input="roomPasswordErrors[gameRoom.id] = false"
                                    />
                                    <span
                                        v-if="roomPasswordErrors[gameRoom.id]"
                                        class="password-error"
                                    >
                                        Incorrect password
                                    </span>
                                </div>
                                <button
                                    class="join-btn"
                                    :disabled="
                                        gameRoom.id == multiplayer.currentGameRoomId ||
                                        (gameRoom.hasPassword && !roomPasswords[gameRoom.id])
                                    "
                                    @click="onJoinGameRoom(gameRoom)"
                                >
                                    Join →
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Create Room -->
                <div
                    v-show="!multiplayer.currentGameRoom"
                    class="create-room-section"
                >
                    <!-- Toggle: the form stays hidden until the player asks to create a room -->
                    <div
                        v-if="!showCreateRoomForm"
                        class="create-room-toggle"
                    >
                        <button
                            class="create-room-btn"
                            @click="showCreateRoomForm = true"
                        >
                            Create a room
                        </button>
                    </div>

                    <template v-else>
                        <!-- First Row: Room Name | Password  | Allow Spectators -->
                        <div class="create-room-row-1">
                            <input
                                v-model="roomName"
                                class="input-field room-name-input"
                                :disabled="!!multiplayer.currentGameRoom"
                                placeholder="Enter room name..."
                                @keydown.enter="onCreateGameRoom"
                            />
                            <input
                                v-model="roomPassword"
                                type="text"
                                class="input-field room-password-input"
                                :disabled="!!multiplayer.currentGameRoom"
                                placeholder="Password (optional)..."
                            />
                            <label class="checkbox-label">
                                <input
                                    v-model="allowSpectators"
                                    type="checkbox"
                                    :disabled="!!multiplayer.currentGameRoom"
                                />
                                <span>Allow spectators</span>
                            </label>
                        </div>

                        <!-- Second Row: Casu/Compet Toggle | Communication Toggle -->
                        <div class="create-room-row-2">
                            <ToggleSwitch
                                v-model="roomMode"
                                :disabled="!!multiplayer.currentGameRoom"
                                :options="[
                                    {
                                        value: 'casual',
                                        label: 'Casual',
                                        description: 'Hints enabled',
                                        tooltip:
                                            'Show hints to players, like \'take pool for the edge\' or \'during X do Y\'.',
                                    },
                                    {
                                        value: 'competitive',
                                        label: 'Competitive',
                                        description: 'No hints, stricter play',
                                        tooltip: 'Hides hints for stricter sanctionned play.',
                                    },
                                ]"
                            />
                            <ToggleSwitch
                                v-model="communicationMode"
                                :disabled="!!multiplayer.currentGameRoom"
                                :options="[
                                    {
                                        value: CommunicationMode.Ably,
                                        label: 'Direct Connection',
                                        description: 'Faster, No Anti-Cheat',
                                        tooltip:
                                            'Players communicate directly between them for faster gameplay, but there\'s no anti-cheat mechanism.',
                                    },
                                    {
                                        value: CommunicationMode.SCS,
                                        label: 'Succubus Club Server',
                                        description: 'Slower, Anti-Cheat',
                                        tooltip:
                                            'SCS is an authoritative server to ensure player can\'t cheat, but slows down the game. May be unavailable.',
                                    },
                                ]"
                            />
                        </div>

                        <!-- Third Row: Create Room Button -->
                        <div class="create-room-row-3">
                            <button
                                class="create-room-btn"
                                :disabled="!roomName.trim() || !!multiplayer.currentGameRoom"
                                @click="onCreateGameRoom"
                            >
                                Create Room
                            </button>
                        </div>
                    </template>
                </div>
            </div>

            <div class="lobby-chat">
                <LobbyChat
                    class="lobby-chat-panel"
                    title="Lobby Chat"
                    :language="activeLanguageName"
                    :messages="messages"
                    :cooldownMs="CHAT_SEND_COOLDOWN_MS"
                    show-date-separators
                    language-selector
                    @send="onSendLobbyChat"
                />
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { connectIntoGame, joinGameRoom } from '@/client/multiplayer/room.ts'
import TopBar from '@/client/ui/components/TopBar.vue'
import { useCoreStore } from '@/client/store/core.ts'
import { CommunicationMode, GameRoom, ScsStatus } from '@/shared/types/multiplayer.ts'
import UserAvatar from '@/client/ui/components/UserAvatar.vue'
import * as logging from '@/client/logging.ts'
import { useBusStore } from '@/client/store/bus.ts'
import { createGameRoom } from '@/client/multiplayer/lobby.ts'
import { computeKey } from '@/client/multiplayer/encryption.ts'
import LobbyChat from '@/client/ui/components/LobbyChat.vue'
import { CHAT_LANGUAGES } from '@/shared/const/languages.ts'
import { getTranslations } from '@/shared/availability/shareLabel.mjs'
import { useLanguagePreferenceStore } from '@/client/store/languagePreference.ts'
import {
    CHAT_SEND_COOLDOWN_MS,
    LobbyChatMessage,
    sendLobbyChat,
    subscribeLobbyChat,
    warmUpChatAuth,
} from '@/client/gateway/lobbyChat.ts'
import ToggleSwitch from '@/client/ui/components/ToggleSwitch.vue'
import { NotInAGameRoom } from '@/client/types.ts'
import router, { ROUTES } from '@/client/ui/router.ts'

const core = useCoreStore()
const multiplayer = useMultiplayerStore()
const bus = useBusStore()
const languagePreference = useLanguagePreferenceStore()

/**
 *  Lobby chat. One append-only channel per official language, backed by RTDB and
 *  selected via the vertical tabs on the right. Only the active channel is
 *  subscribed : switching tabs re-subscribes and reloads that channel's history.
 *  The selected language is shared ( and persisted ) through the language
 *  preference store, so the player availability calendar stays in sync.
 */

const messages = ref<LobbyChatMessage[]>([])
let unsubscribeChat: (() => void) | null = null

const activeLanguageName = computed(() => {
    const language = CHAT_LANGUAGES.find(entry => entry.code === languagePreference.language)
    if (!language) {
        return ''
    }
    return `${getTranslations(languagePreference.language).language} : ${language.fullName}`
})

function subscribeToActiveLanguage() {
    unsubscribeChat?.()
    messages.value = []
    unsubscribeChat = subscribeLobbyChat(languagePreference.language, message => {
        messages.value.push(message)
    })
}

// Re-subscribe whenever the shared language preference changes.
watch(() => languagePreference.language, subscribeToActiveLanguage)

onMounted(() => {
    warmUpChatAuth()
    subscribeToActiveLanguage()
})

onUnmounted(() => {
    unsubscribeChat?.()
    unsubscribeChat = null
})

function onSendLobbyChat(text: string) {
    sendLobbyChat(languagePreference.language, multiplayer.selfUser.name, text)
}

// Move into the dedicated game room screen as soon as we have a room.
// createGameRoom/joinGameRoom set currentGameRoomId early ( before the slower
// network setup ), so this switches screens near-instantly instead of waiting
// for the whole join to resolve.
function enterGameRoomWhenReady() {
    const existing = multiplayer.currentGameRoomId
    if (existing) {
        router.push({ name: ROUTES.GameRoom, params: { roomId: existing } })
        return
    }
    const stop = watch(
        () => multiplayer.currentGameRoomId,
        roomId => {
            if (!roomId) {
                return
            }
            stop()
            router.push({ name: ROUTES.GameRoom, params: { roomId } })
        },
    )
    // Give up watching if the room never materialises ( e.g. a creation error )
    setTimeout(stop, 10000)
}

/**
 *  Reconnection notification
 */

const THREE_HOURS = 3 * 60 * 60 * 1000
const showReconnectSuggestion = computed(() => {
    if (
        core.userProfile.lastMultiGameDate &&
        +Date.now() - +core.userProfile.lastMultiGameDate < THREE_HOURS
    ) {
        const gameRoom = multiplayer.gameRooms[core.userProfile.lastMultiGameId]
        if (gameRoom && gameRoom.isStarted && !gameRoom.hasPassword) {
            return gameRoom
        }
    }
    return null
})

/**
 *  Discovery message timer
 */

const DISCOVERY_MESSAGE_DURATION = 8000
const showDiscoveryMessage = ref(false)

onMounted(() => {
    showDiscoveryMessage.value = true
    setTimeout(() => {
        showDiscoveryMessage.value = false
    }, DISCOVERY_MESSAGE_DURATION)
})

/**
 *  Game room creation / join
 */

const showCreateRoomForm = ref(false)
const roomName = ref('')
const roomPassword = ref('')
const roomPasswords = ref<{ [gameRoomId: string]: string }>({})
const roomPasswordErrors = ref<{ [gameRoomId: string]: boolean }>({})
const isCasual = ref(true)
const allowSpectators = ref(true)
const communicationMode = ref<CommunicationMode>(CommunicationMode.Ably)

// The casual / competitive toggle is a string switch backed by the isCasual boolean.
const roomMode = computed({
    get: () => (isCasual.value ? 'casual' : 'competitive'),
    set: mode => {
        isCasual.value = mode === 'casual'
    },
})

function onCreateGameRoom() {
    const cleanedRoomName = roomName.value.trim()
    if (!cleanedRoomName) {
        return
    }

    enterGameRoomWhenReady()
    createGameRoom(
        cleanedRoomName,
        roomPassword.value,
        communicationMode.value,
        isCasual.value,
        allowSpectators.value,
    )
    roomName.value = ''
    roomPassword.value = ''
}

async function onJoinGameRoom(gameRoom: GameRoom) {
    if (gameRoom.hasPassword) {
        const password = roomPasswords.value[gameRoom.id] || ''
        const key = await computeKey(password)
        if (key.hash != gameRoom.passwordHash) {
            roomPasswordErrors.value[gameRoom.id] = true
            return
        }
        roomPasswordErrors.value[gameRoom.id] = false
        enterGameRoomWhenReady()
        joinGameRoom(gameRoom, key)
    } else {
        enterGameRoomWhenReady()
        joinGameRoom(gameRoom)
    }
}

/**
 *  Reconnection with feedback
 */

const isConnecting = ref(false)

async function startConnectIntoGame(gameRoom?: any) {
    isConnecting.value = true
    try {
        await connectIntoGame(gameRoom)
    } catch (error) {
        let message = 'Failed to reconnect to the game'
        if (error instanceof Error) {
            message = `${message}: ${error.message}`
        }
        bus.alertError(message)
        if (!(error instanceof NotInAGameRoom)) {
            logging.captureException(error)
        }
    } finally {
        isConnecting.value = false
    }
}

/**
 *  Fast Track
 */

// Activate this during dev to fast-track into a multiplayer game
if (import.meta.env.VITE_FAST_TRACK_MULTIPLAYER) {
    const devRoom = 'dev_room'
    setTimeout(async () => {
        enterGameRoomWhenReady()
        if (Object.keys(multiplayer.gameRooms).length === 0) {
            await createGameRoom(devRoom)
        } else {
            await joinGameRoom(multiplayer.gameRooms[devRoom])
        }
    }, 1000)
}
</script>

<style lang="scss" scoped>
.lobby-container {
    background: black;
}

/**
 *  Reconnect Banner
 */

.reconnect-banner {
    @include flex-center;
    background: $dark-blood;
    padding: 1rem;
    text-align: center;
    gap: 1rem;
    border-bottom: 1px solid $ash-grey;

    .reconnect-banner-btn {
        @include button-grey;
        padding: 0.5rem 1rem;
    }
}

/**
 *  Main content
 */

.lobby-content {
    @include screen-page;
    display: grid;
    grid-template-columns: 300px 1fr;
    // The players / rooms row sizes to its content ( so the room list stays
    // visible ), and the lobby chat takes the remaining space underneath. The grid
    // is bounded to the viewport so the panels scroll internally instead of pushing
    // the page ( and the chat input ) below the fold.
    grid-template-rows: auto minmax(200px, 1fr);
    grid-template-areas:
        'players-sidebar rooms-section'
        'lobby-chat lobby-chat';
    padding: 1.5rem 1.5rem 0;
    height: calc(100vh - $topbar-height - 1.5rem);
    min-height: unset;
    overflow: hidden;

    &.has-banner {
        height: calc(100vh - $topbar-height - 5.5rem);
    }
}

.lobby-chat {
    grid-area: lobby-chat;
    display: flex;
    min-height: 0;
    overflow: hidden;
}

.lobby-chat-panel {
    flex: 1;
    min-width: 0;
}

.panel-title {
    @include serif-heading(1.25rem);
    margin: 0 0 1rem 0;

    &.no-margin {
        margin: 0;
    }
}

/**
 *  Players Panel
 */

// The wrapper takes the grid area but holds no in-flow content, so it never
// contributes to the row height : the row is sized by .rooms-panel alone.
// .players-panel is then stretched to that resolved height and scrolls inside.
.players-sidebar {
    grid-area: players-sidebar;
    position: relative;
}

.players-panel {
    @include panel;
    position: absolute;
    inset: 0;
    box-sizing: border-box;
    overflow: hidden;
    display: flex;
    flex-direction: column;
}

.player-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    overflow-y: auto;
    flex: 1;
}

.discovery-message {
    @include inline-message;

    background: rgba($light-teal, 1);
    animation: fadeInOut 8s ease-in-out forwards;
}

@keyframes fadeInOut {
    0% {
        opacity: 0;
    }
    10%,
    90% {
        opacity: 1;
    }
    100% {
        opacity: 0;
    }
}

.player-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0;
    border-radius: 0.25rem;
    transition: all 0.3s ease;
    border: 1px solid transparent;

    /*
    &:hover {
        background: linear-gradient(90deg, rgba(white, 0.02) 0%, rgba(white, 0.05) 100%);
        border-color: $bone-grey;
    }
     */
}

.player-name {
    font-size: 0.9rem;
    color: $pearl-grey;
    font-family: serif;
}

/**
 *  Rooms Panel
 */

.rooms-panel {
    @include panel;
    grid-area: rooms-section;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    // Pin the panel to its "create form open" height so the panel ( and the chat
    // below it ) keep a constant size. Opening the form then eats into the room
    // list via its flex sizing, instead of growing the panel and shrinking the chat.
    height: 400px;
    min-height: 0; // Allow the panel to shrink so the room list scrolls internally
}

.rooms-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
}

.scs-status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    padding: 0.4rem 0.8rem;

    .scs-indicator {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        transition: all 0.3s ease;
    }

    .scs-label {
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    &.scs-connecting {
        background: rgba($status-amber, 0.1);
        color: $silver-grey;

        .scs-indicator {
            background: $status-amber;
            animation: pulse 1.5s ease-in-out infinite;
        }
    }

    &.scs-online {
        background: rgba($light-teal, 0.15);
        color: $silver-grey;

        .scs-indicator {
            background: $lighter-teal;
        }
    }

    &.scs-offline {
        background: rgba($crimson-red, 0.1);
        color: $silver-grey;

        .scs-indicator {
            background: $crimson-red;
        }
    }
}

@keyframes pulse {
    0%,
    100% {
        opacity: 1;
    }
    50% {
        opacity: 0.5;
    }
}

.refresh-btn {
    @include button-dark-grey;
    padding: 0.5rem;
    font-size: 1rem;

    &:hover {
        transform: rotate(90deg);
    }
}

.room-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;

    overflow-y: auto;
    // Take whatever height the pinned panel leaves after the header and the
    // create-room section. Collapsed create form => taller list ; open form =>
    // the list shrinks ( down to ~4 rows ) to make room, and scrolls internally.
    flex: 1;
    min-height: 0;
}

.room-item {
    @include list-item;

    &.room-selected {
        border-color: $mist-grey;
        @include active-gradient;
    }
}

.room-info {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 1rem;
}

.room-info-left {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 1rem;

    .room-lock {
        font-size: 0.75rem;
        color: $mist-grey;
        display: flex;
        align-items: center;
        width: 0.5rem;
    }

    .room-setting-badge {
        @include teal-badge;
        width: 2rem;
    }

    .room-name {
        margin: 0;
        font-size: 1.1rem;
        font-weight: 400;
        font-family: serif;
        line-height: 1.2;
    }
}
.room-info-right {
    display: flex;
    align-items: center;
    gap: 1rem;

    .password-input-wrapper {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        position: relative;
    }

    .room-password-input {
        @include input-base;
        font-size: 0.85rem;
        padding: 0.4rem 0.6rem;
        width: 180px;

        &.password-error-input {
            background: $burgundy-red;
            border-color: $rose-red;
        }
    }

    .password-error {
        font-size: 0.75rem;
        color: $rose-red;
        background: $burgundy-red;
        position: absolute;
        top: 100%;
        left: 0;
        white-space: nowrap;
        padding: 0.25rem;
    }

    .player-count {
        font-size: 0.8rem;
        color: $silver-grey;
        font-weight: 500;
    }

    .game-started-badge,
    .saved-game-badge {
        @include secondary-badge;
    }

    .join-btn {
        @include button-dark-grey;
        padding: 0.5rem 0.75rem;
    }
}

.create-room-section {
    border-top: 1px solid $bone-grey;
    padding-top: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    // Keep the form at its natural height ; the room list ( flex ) absorbs the
    // difference so the overall panel height stays constant.
    flex-shrink: 0;
}

.create-room-row-1 {
    display: flex;
    gap: 1rem;
    align-items: center;

    .room-name-input {
        flex: 1;
        min-width: 200px;
    }

    .room-password-input {
        flex: 1;
        min-width: 180px;
    }
}

.create-room-row-2 {
    display: flex;
    gap: 12rem;
    width: 100%;
}

.create-room-row-3 {
    display: flex;
    justify-content: center;
}

.create-room-toggle {
    display: flex;
    justify-content: center;
}

.create-room-btn {
    @include button-purple;
}

.no-rooms-message {
    @include hero-message;
}
</style>
