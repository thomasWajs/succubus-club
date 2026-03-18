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

        <div class="lobby-content">
            <!-- Players Online Sidebar -->
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
                                :avatar="user.avatarId ? multiplayer.avatars[user.avatarId] : null"
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

            <!-- Available Rooms -->
            <div class="rooms-panel">
                <div class="rooms-header">
                    <h3 class="panel-title">
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
                            >Server :
                            {{
                                multiplayer.scsStatus === ScsStatus.Connecting
                                    ? 'Connecting'
                                    : multiplayer.scsStatus === ScsStatus.Connected
                                      ? 'Online'
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
                                <h4 class="room-name">{{ gameRoom.name }}</h4>
                            </div>
                            <div class="room-info-right">
                                <span
                                    v-if="gameRoom.isStarted"
                                    class="room-game-started"
                                >
                                    Game Started
                                </span>
                                <span class="player-count">
                                    {{ gameRoom.players.length }}/5 Players
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
                <div class="create-room-section">
                    <!-- First Row: Room Name | Password | Enable Aids | Allow Spectators -->
                    <div class="create-room-row-1">
                        <input
                            v-model="roomName"
                            class="input-field room-name-input"
                            :disabled="multiplayer.currentGameRoomId !== null"
                            placeholder="Enter room name..."
                            @keydown.enter="onCreateGameRoom"
                        />
                        <input
                            v-model="roomPassword"
                            type="text"
                            class="input-field room-password-input"
                            :disabled="multiplayer.currentGameRoomId !== null"
                            placeholder="Password (optional)..."
                        />
                        <label
                            class="checkbox-label"
                            title='Show hints to players, like "take pool for the edge" or "during X do Y". Disable for stricter sanctionned play.'
                        >
                            <input
                                v-model="enableAids"
                                type="checkbox"
                                :disabled="multiplayer.currentGameRoomId !== null"
                            />
                            <span>Enable aids</span>
                        </label>
                        <label class="checkbox-label">
                            <input
                                v-model="allowSpectators"
                                type="checkbox"
                                :disabled="multiplayer.currentGameRoomId !== null"
                            />
                            <span>Allow spectators</span>
                        </label>
                    </div>

                    <!-- Second Row: Communication Toggle -->
                    <div class="create-room-row-2">
                        <ToggleSwitch
                            v-model="communicationMode"
                            :disabled="multiplayer.currentGameRoomId !== null"
                            :options="[
                                {
                                    value: CommunicationMode.Ably,
                                    label: 'Direct Connection',
                                    description: 'Faster, Always Available, No Anti-Cheat',
                                    tooltip:
                                        'Players communicate directly between them for faster gameplay, but there\'s no anti-cheat mechanism.',
                                },
                                {
                                    value: CommunicationMode.SCS,
                                    label: 'Server',
                                    description: 'Slower, Anti-Cheat',
                                    tooltip:
                                        'Use an authoritative server to ensure player can\'t cheat, but slows down the game. May be unavailable.',
                                },
                            ]"
                        />
                    </div>

                    <!-- Third Row: Create Room Button -->
                    <div class="create-room-row-3">
                        <button
                            class="create-room-btn"
                            :disabled="!roomName.trim() || multiplayer.currentGameRoomId !== null"
                            @click="onCreateGameRoom"
                        >
                            Create Room
                        </button>
                    </div>
                </div>
            </div>

            <CurrentRoom />
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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
import CurrentRoom from '@/client/ui/components/CurrentRoom.vue'
import ToggleSwitch from '@/client/ui/components/ToggleSwitch.vue'

const core = useCoreStore()
const multiplayer = useMultiplayerStore()
const bus = useBusStore()

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

const roomName = ref('')
const roomPassword = ref('')
const roomPasswords = ref<{ [gameRoomId: string]: string }>({})
const roomPasswordErrors = ref<{ [gameRoomId: string]: boolean }>({})
const enableAids = ref(true)
const allowSpectators = ref(true)
const communicationMode = ref<CommunicationMode>(CommunicationMode.Ably)

function onCreateGameRoom() {
    const cleanedRoomName = roomName.value.trim()
    if (!cleanedRoomName) {
        return
    }

    createGameRoom(
        cleanedRoomName,
        roomPassword.value,
        communicationMode.value,
        enableAids.value,
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
        } else {
            roomPasswordErrors.value[gameRoom.id] = false
            await joinGameRoom(gameRoom, key)
        }
    } else {
        await joinGameRoom(gameRoom)
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
        logging.captureException(error)
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

.reconnect-spinner {
    display: inline-block;
    width: 14px;
    height: 14px;
    margin-right: 0.5rem;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-radius: 50%;
    border-top-color: #fff;
    animation: spin 1s ease-in-out infinite;
}

@keyframes spin {
    0% {
        transform: rotate(0deg);
    }
    100% {
        transform: rotate(360deg);
    }
}

/**
 *  Main content
 */

.lobby-content {
    display: grid;
    grid-template-columns: 300px 1fr;
    grid-template-rows: 1fr 380px;
    grid-template-areas:
        'players-sidebar rooms-section'
        'current-room current-room';
    max-width: 1400px;
    margin: 0 auto;
    padding: 1.5rem;
    gap: 1.5rem;
    min-height: calc(100vh - $topbar-height - 4rem);
}

.panel-title {
    margin: 0 0 1rem 0;
    font-size: 1.25rem;
    font-weight: 300;
    font-family: serif;
    letter-spacing: 0.5px;
}

/**
 *  Players Panel
 */

.players-panel {
    @include panel;
    grid-area: players-sidebar;
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
    transition: all 0.2s ease;
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
        background: rgba(orange, 0.1);
        color: $silver-grey;

        .scs-indicator {
            background: orange;
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
    flex: 1;
}

.room-item {
    @include list-item;

    &.room-selected {
        border-color: $mist-grey;
        background: linear-gradient(
            135deg,
            rgba($shadow-purple, 0.3) 0%,
            rgba($deep-purple, 0.5) 100%
        );
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

    .room-game-started {
        font-size: 0.7rem;
        color: $pale-grey;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        background: $dark-blood;
        padding: 0.2rem 0.5rem;
        border-radius: 0.25rem;
    }

    .join-btn {
        @include button-dark-grey;
        padding: 0.5rem 0.75rem;
    }
}

.create-room-section {
    border-top: 1px solid $bone-grey;
    padding-top: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
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
    width: 100%;
}

.create-room-row-3 {
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
