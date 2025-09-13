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
                :disabled="isReconnecting"
                @click="handleReconnect(showReconnectSuggestion)"
            >
                <template v-if="isReconnecting">
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
                                :avatar="user.avatar"
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
                    <button
                        class="refresh-btn"
                        title="Refresh rooms"
                        @click="refreshGameRooms()"
                    >
                        ↻
                    </button>
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
                        :key="gameRoom.name"
                        class="room-item"
                        :class="{
                            'room-selected': multiplayer.currentGameRoomName === gameRoom.name,
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
                                <button
                                    class="join-btn"
                                    :disabled="gameRoom.name == multiplayer.currentGameRoom?.name"
                                    @click="joinGameRoom(gameRoom)"
                                >
                                    Join →
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Create Room -->
                <div class="create-room">
                    <input
                        v-model="roomName"
                        class="input-field"
                        :disabled="multiplayer.currentGameRoomName !== null"
                        placeholder="Enter room name..."
                        @keydown.enter="onCreateGameRoom"
                    />
                    <button
                        class="create-room-btn"
                        :disabled="!roomName.trim() || multiplayer.currentGameRoomName !== null"
                        @click="onCreateGameRoom"
                    >
                        Create Room
                    </button>
                </div>
            </div>

            <!-- Current Game Room -->
            <div
                v-if="multiplayer.currentGameRoom"
                class="current-room-panel"
            >
                <div class="current-room-header">
                    <h3 class="panel-title">
                        {{ multiplayer.currentGameRoomName }} (
                        {{ multiplayer.currentGameRoom.players.length }} )
                    </h3>

                    <span
                        v-show="multiplayer.isSeatingReady"
                        class="seating-rolled-message"
                    >
                        🎲 Seating has been rolled
                    </span>

                    <button
                        class="leave-btn"
                        @click="leaveGameRoom()"
                    >
                        Leave Room
                    </button>
                </div>

                <div class="room-players">
                    <template
                        v-for="(user, index) in orderedUsers"
                        :key="user.permId"
                    >
                        <div class="room-player">
                            <div class="player-avatar">
                                <UserAvatar
                                    :class="getUserStatusClass(user)"
                                    :avatar="user.avatar"
                                    :playerName="user.name"
                                    width="60px"
                                    height="60px"
                                    fontSize="1.5rem"
                                />
                            </div>
                            <div class="player-details">
                                <span class="player-name">{{ user.name }}</span>
                                <span
                                    v-if="!multiplayer.currentGameRoom.isStarted"
                                    class="player-status-text"
                                    :class="getUserStatusClass(user)"
                                >
                                    {{ getUserStatusText(user) }}
                                </span>
                            </div>
                        </div>

                        <!-- Attack Arrow - only show if seating is rolled and not the last player -->
                        <div
                            v-if="multiplayer.isSeatingReady && index < orderedUsers.length - 1"
                            class="attack-arrow"
                        >
                            <div class="arrow-head">→</div>
                            <div class="attack-label">attacks</div>
                        </div>

                        <!-- Special arrow from last player back to first (circular) -->
                        <div
                            v-if="
                                multiplayer.isSeatingReady &&
                                index === orderedUsers.length - 1 &&
                                orderedUsers.length > 1
                            "
                            class="attack-arrow circular"
                        >
                            <div class="circular-arrow">↩</div>
                            <div class="attack-label">attacks</div>
                        </div>
                    </template>
                </div>

                <!-- Game Controls -->
                <div class="game-controls">
                    <!-- Left side of Game Controls -->
                    <div class="game-controls-left">
                        <template v-if="multiplayer.currentGameRoom.isStarted">
                            <span class="game-started">Game is started</span>
                        </template>

                        <template v-else>
                            <button
                                v-if="!multiplayer.selfIsReady"
                                class="ready-btn"
                                :disabled="multiplayer.selfUser.deckList == null"
                                :title="
                                    multiplayer.selfUser.deckList == null ?
                                        'Select a deck to get ready'
                                    :   ''
                                "
                                @click="multiplayer.selfIsReady = true"
                            >
                                ✔️ I'm Ready
                            </button>
                            <button
                                v-else
                                class="unready-btn"
                                @click="multiplayer.selfIsReady = false"
                            >
                                ❌ Not Ready
                            </button>

                            <span
                                v-if="!core.selfDeck"
                                class="no-deck-message"
                            >
                                Select a deck through the top bar to get ready
                            </span>
                        </template>
                    </div>

                    <!-- Right side of Game Controls -->
                    <div class="game-controls-right">
                        <template v-if="multiplayer.currentGameRoom.isStarted">
                            <div
                                v-if="
                                    multiplayer.currentGameRoom.seating.includes(
                                        multiplayer.selfUser.permId,
                                    )
                                "
                            >
                                <button
                                    class="reconnect-btn"
                                    :disabled="isReconnecting"
                                    @click="handleReconnect()"
                                >
                                    <template v-if="isReconnecting">
                                        <span class="reconnect-spinner" />
                                        Reconnecting...
                                    </template>
                                    <template v-else> Reconnect to Game </template>
                                </button>
                            </div>
                            <div
                                v-else
                                class="spectate-disabled"
                            >
                                Spectate is not available yet
                            </div>
                        </template>

                        <template v-else>
                            <div
                                v-if="multiplayer.selfIsHost"
                                class="game-controls-right"
                            >
                                <button
                                    class="roll-seating-btn"
                                    :disabled="!multiplayer.areAllUsersReady"
                                    :title="
                                        !multiplayer.areAllUsersReady ?
                                            'Wait for all players to be ready'
                                        :   ''
                                    "
                                    @click="rollSeating()"
                                >
                                    Roll Seating
                                </button>

                                <button
                                    class="start-game-btn"
                                    :disabled="!multiplayer.isRoomReady"
                                    :title="
                                        !multiplayer.isSeatingReady ?
                                            'Roll seating to start the game'
                                        :   ''
                                    "
                                    @click="tryLaunchGame()"
                                >
                                    ▶ Start Game
                                </button>
                            </div>
                            <div
                                v-else
                                class="host-message"
                            >
                                The host can launch the game when all players are ready
                            </div>
                        </template>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useMultiplayerStore } from '@/store/multiplayer.ts'
import {
    joinGameRoom,
    reconnectIntoGame,
    launchGame,
    leaveGameRoom,
    rollSeating,
} from '@/multiplayer/room.ts'
import { createGameRoom, refreshGameRooms } from '@/multiplayer/lobby.ts'
import TopBar from '@/ui/components/TopBar.vue'
import { useCoreStore } from '@/store/core.ts'
import { User } from '@/multiplayer/common.ts'
import UserAvatar from '@/ui/components/UserAvatar.vue'
import * as logging from '@/logging.ts'
import { useBusStore } from '@/store/bus.ts'

const core = useCoreStore()
const multiplayer = useMultiplayerStore()
const bus = useBusStore()

const roomName = ref('')
const isReconnecting = ref(false)
const showDiscoveryMessage = ref(false)

const orderedUsers = computed<User[]>(() => {
    return multiplayer.isSeatingReady ?
            multiplayer.seatedGameRoomUsers
        :   multiplayer.sortedGameRoomUsers
})

/**
 *  Reconnection notification
 */

const THREE_HOURS = 3 * 60 * 60 * 1000
const showReconnectSuggestion = computed(() => {
    if (
        core.userProfile.lastMultiGameDate &&
        +Date.now() - +core.userProfile.lastMultiGameDate < THREE_HOURS
    ) {
        const gameRoom = multiplayer.gameRooms[core.userProfile.lastMultiGameName]
        if (gameRoom && gameRoom.isStarted) {
            return gameRoom
        }
    }
    return null
})

/**
 *  Discovery message timer
 */

const DISCOVERY_MESSAGE_DURATION = 8000
onMounted(() => {
    showDiscoveryMessage.value = true
    setTimeout(() => {
        showDiscoveryMessage.value = false
    }, DISCOVERY_MESSAGE_DURATION)
})

/**
 *  Game room creation
 */

function onCreateGameRoom() {
    createGameRoom(roomName.value)
    roomName.value = ''
}

/**
 *  Helper functions on User status
 */

function getUserStatusClass(user: User) {
    if (multiplayer.currentGameRoom?.isStarted) {
        return 'started'
    }
    if (user.deckList == null) {
        return 'no-deck'
    }
    if (user.isReady) {
        return 'ready'
    }
    return 'not-ready'
}

function getUserStatusText(user: User) {
    if (user.deckList == null) {
        return 'No Deck'
    }
    if (user.isReady) {
        return 'Ready'
    }
    return 'Not Ready'
}

/**
 *  Game Launching
 */

function tryLaunchGame() {
    try {
        launchGame()
    } catch (error) {
        let message = 'An error occurred while starting the game'
        if (error instanceof Error) {
            message = `${message} : ${error.message}`
        }
        bus.alertError(message)
        logging.captureException(error)
    }
}

/**
 *  Reconnection with feedback
 */

async function handleReconnect(gameRoom?: any) {
    isReconnecting.value = true
    try {
        await reconnectIntoGame(gameRoom)
    } catch (error) {
        let message = 'Failed to reconnect to the game'
        if (error instanceof Error) {
            message = `${message}: ${error.message}`
        }
        bus.alertError(message)
        logging.captureException(error)
    } finally {
        isReconnecting.value = false
    }
}

/**
 *  Fast Track
 */

// Activate this during dev to fast-track into a multiplayer game
if (import.meta.env.VITE_FAST_TRACK_MULTIPLAYER) {
    const devRoom = 'dev_room'
    setTimeout(async () => {
        if (!multiplayer.gameRoomNames.length) {
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
    grid-template-rows: 1fr 350px;
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

.create-room {
    border-top: 1px solid $bone-grey;
    padding-top: 1rem;
    display: flex;
    gap: 1rem;
}

.create-room-btn {
    @include button-purple;
}

/**
 *  Current Room Panel
 */

.current-room-panel {
    @include panel;
    grid-area: current-room;
}

.current-room-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.5rem;
}

.seating-rolled-message {
    @include flex-center;
    font-size: 0.9rem;
    color: $vibrant-emerald;
    font-weight: 500;
    font-style: italic;
    letter-spacing: 0.3px;
    background: rgba($vibrant-emerald, 0.1);
    border: 1px solid $vibrant-emerald;
    border-radius: 0.5rem;
    padding: 0.5rem 1rem;
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
}

.leave-btn {
    @include button-red;
    padding: 0.5rem 1rem;
}

.room-players {
    display: flex;
    gap: 1rem;
    margin-bottom: 2rem;
    flex-wrap: wrap;
    align-items: center;
}

.room-player {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem;
    background: linear-gradient(145deg, rgba($shadow-grey, 0.8) 0%, rgba(black, 0.9) 100%);
    border: 1px solid $ash-grey;
    border-radius: 0.25rem;
    min-width: 120px;
}

.player-avatar {
    position: relative;

    .avatar-circle {
        &.ready {
            background: $dark-forest;
            border-color: $vibrant-emerald;
        }

        &.no-deck {
            background: $twilight-blue;
            border-color: $azure-blue;
        }

        &.not-ready {
            background: $wine-crimson;
            border-color: $warm-coral;
        }
    }
}

.player-details {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
}

.player-status-text {
    font-size: 0.75rem;
    font-weight: 400;
    font-family: serif;

    &.ready {
        color: $vibrant-emerald;
    }

    &.no-deck {
        color: $azure-blue;
    }

    &.not-ready {
        color: $warm-coral;
    }
}

.attack-arrow {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    margin: 0 0.5rem;
    opacity: 0.8;

    &.circular {
        position: relative;
        margin-left: 1rem;
    }

    .arrow-head {
        font-size: 2.5rem;
        color: $pale-grey;
        font-weight: bold;
        margin-top: -0.5rem;
    }

    .circular-arrow {
        font-size: 1.5rem;
        color: $pale-grey;
        transform: rotate(-45deg);
    }

    .attack-label {
        font-size: 0.8rem;
        color: $pale-grey;
        font-weight: 300;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-top: 0.25rem;
    }
}

.game-controls {
    border-top: 1px solid $bone-grey;
    padding-top: 1.5rem;

    display: flex;
    flex-direction: row;
    justify-content: space-between;
}

.game-controls-left {
    display: flex;
    gap: 1rem;
}

.game-controls-right {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
}

.reconnect-btn {
    @include button-purple;
}

.ready-btn {
    @include button-light-grey;
}

.unready-btn {
    @include button-grey;
}

.start-game-btn {
    @include button-purple;
}

.roll-seating-btn {
    @include button-light-grey;
}

.host-message,
.spectate-disabled {
    color: $pale-grey;
    font-style: italic;
    background: linear-gradient(135deg, rgba($shadow-purple, 0.3) 0%, rgba($deep-purple, 0.5) 100%);
    border: 1px solid $mist-grey;
    border-radius: 0.5rem;
    font-weight: 300;
    letter-spacing: 0.3px;

    padding: 0.5rem 1rem;
    display: flex;
    align-items: center;
}

.no-deck-message {
    @include inline-message;
    font-size: 0.9rem;
}

.no-rooms-message {
    @include hero-message;
}

.game-started {
    @include inline-message;
    font-size: 1.4rem;
}
</style>
