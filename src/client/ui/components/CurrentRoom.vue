<template>
    <!-- Current Game Room -->
    <div
        v-if="multiplayer.currentGameRoom"
        class="current-room-panel"
    >
        <div class="current-room-header">
            <div class="room-header-left">
                <span class="teal-badge">
                    {{
                        multiplayer.currentGameRoom.communication === CommunicationMode.Ably ?
                            'Direct'
                        :   'SCS'
                    }}
                </span>
                <span
                    v-if="isSavedGame"
                    class="saved-game-badge"
                >
                    Saved Game
                </span>
                <span
                    v-if="multiplayer.judgeUsers.length > 0"
                    class="judge-badge"
                >
                    {{ multiplayer.judgeUsers.length }} Judge
                </span>
                <span
                    v-if="multiplayer.spectatorUsers.length > 0"
                    class="spectator-badge"
                >
                    {{ multiplayer.spectatorUsers.length }} Watching
                </span>
                <h3 class="panel-title">
                    {{ multiplayer.currentGameRoom.name }} ( {{ multiplayer.playerUsers.length }}/{{
                        MAX_PLAYERS
                    }}
                    )
                </h3>
            </div>

            <!-- Unseated Players (shown during pick seating mode) -->
            <div
                v-if="isPickSeatingMode"
                class="unseated-players"
            >
                <span class="unseated-label">Waiting to pick:</span>
                <div class="unseated-list">
                    <div
                        v-for="user in unseatedUsers"
                        :key="user.permId"
                        class="unseated-player"
                    >
                        <UserAvatar
                            :avatar="user.avatarId ? multiplayer.avatars[user.avatarId] : null"
                            :playerName="user.name"
                            width="30px"
                            height="30px"
                            fontSize="14px"
                        />
                        <span class="unseated-player-name">{{ user.name }}</span>
                    </div>
                </div>
            </div>

            <span
                v-if="isSavedGame && !multiplayer.currentGameRoom.isStarted"
                class="saved-game-message"
            >
                💾 This is a saved game. All non-ousted players must join to start.
            </span>

            <span
                v-else-if="multiplayer.isSeatingReady && !isPickSeatingMode"
                class="seating-rolled-message"
            >
                ✅ All players seated
            </span>

            <button
                class="leave-btn"
                @click="leaveGameRoom()"
            >
                Leave Room
            </button>
        </div>

        <div class="room-body">
            <!-- Pick Seating Mode -->
            <div
                v-if="isPickSeatingMode"
                class="room-players pick-seating"
            >
                <!-- Seat at the start (if there are seated players) -->
                <div
                    v-if="seatedUsers.length > 0 && multiplayer.selfIsPlayer && !isSelfSeated"
                    class="available-seat"
                    @click="pickSeat(0)"
                >
                    <div class="seat-icon">📍</div>
                    <div class="seat-label">Pick</div>
                </div>

                <template
                    v-for="(user, index) in seatedUsers"
                    :key="user.permId"
                >
                    <!-- Seated player -->
                    <div class="room-player seated">
                        <div class="player-avatar">
                            <UserAvatar
                                :class="getUserStatusClass(user)"
                                :avatar="user.avatarId ? multiplayer.avatars[user.avatarId] : null"
                                :playerName="user.name"
                                width="60px"
                                height="60px"
                                fontSize="1.5rem"
                            />
                        </div>
                        <div class="player-details">
                            <span class="player-name">{{ user.name }}</span>
                            <button
                                v-if="
                                    user.permId === multiplayer.selfUser.permId &&
                                    multiplayer.areAllPlayerUsersReady
                                "
                                class="leave-seat-btn"
                                @click="leaveSeat()"
                            >
                                Leave Seat
                            </button>
                        </div>
                    </div>

                    <!-- Available seat between or at the end -->
                    <div
                        v-if="multiplayer.selfIsPlayer && !isSelfSeated"
                        class="available-seat"
                        @click="pickSeat(index + 1)"
                    >
                        <div class="seat-icon">📍</div>
                        <div class="seat-label">Pick</div>
                    </div>
                </template>

                <!-- First seat (if no one is seated yet) -->
                <div
                    v-if="seatedUsers.length === 0 && multiplayer.selfIsPlayer && !isSelfSeated"
                    class="available-seat first-seat"
                    @click="pickSeat(0)"
                >
                    <div class="seat-icon">📍</div>
                    <div class="seat-label">Pick First Seat</div>
                </div>
            </div>

            <!-- Normal Mode (not pick seating) -->
            <div
                v-else
                class="room-players"
            >
                <template
                    v-for="(user, index) in orderedUsers"
                    :key="user.permId"
                >
                    <div class="room-player">
                        <div class="player-avatar">
                            <UserAvatar
                                :class="getUserStatusClass(user)"
                                :avatar="user.avatarId ? multiplayer.avatars[user.avatarId] : null"
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
                            <div
                                v-if="getDeckWarnings(user).length > 0"
                                class="deck-warnings"
                            >
                                <span
                                    v-for="(warning, idx) in getDeckWarnings(user)"
                                    :key="idx"
                                    class="deck-warning"
                                >
                                    ⚠ {{ warning }}
                                </span>
                            </div>
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

            <!-- Move ourselves between the table, the judge seat and the sidelines.
                 Sits at the right of the tiles. -->
            <div
                v-if="canChangeRoomSeat"
                class="room-seat-picker"
            >
                <span class="room-seat-title">Your Role</span>

                <button
                    v-for="seat in ROOM_SEATS"
                    :key="seat"
                    class="room-seat-btn"
                    :class="{ active: multiplayer.selfRoomSeat == seat }"
                    :disabled="isRoomSeatDisabled(seat)"
                    :title="getRoomSeatTitle(seat)"
                    @click="changeRoomSeat(seat)"
                >
                    {{ seat }}
                </button>
            </div>
        </div>

        <!-- Judges and Spectators : not at the table, no deck and no readiness -->
        <div
            v-if="multiplayer.judgeUsers.length > 0 || multiplayer.spectatorUsers.length > 0"
            class="room-side-seats"
        >
            <div
                v-if="multiplayer.judgeUsers.length > 0"
                class="side-seat-row"
            >
                <span class="side-seat-label">Judges</span>
                <div class="side-seat-list">
                    <div
                        v-for="user in multiplayer.judgeUsers"
                        :key="user.permId"
                        class="side-seat judge"
                    >
                        <UserAvatar
                            :avatar="user.avatarId ? multiplayer.avatars[user.avatarId] : null"
                            :playerName="user.name"
                            width="30px"
                            height="30px"
                            fontSize="14px"
                        />
                        <span class="side-seat-name">{{ user.name }}</span>
                    </div>
                </div>
            </div>

            <div
                v-if="multiplayer.spectatorUsers.length > 0"
                class="side-seat-row"
            >
                <span class="side-seat-label">Spectators</span>
                <div class="side-seat-list">
                    <div
                        v-for="user in multiplayer.spectatorUsers"
                        :key="user.permId"
                        class="side-seat"
                    >
                        <UserAvatar
                            :avatar="user.avatarId ? multiplayer.avatars[user.avatarId] : null"
                            :playerName="user.name"
                            width="30px"
                            height="30px"
                            fontSize="14px"
                        />
                        <span class="side-seat-name">{{ user.name }}</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Game Controls -->
        <div class="game-controls">
            <!-- Left side of Game Controls -->
            <div class="game-controls-left">
                <template v-if="multiplayer.currentGameRoom.isStarted">
                    <span class="game-started">Game is started</span>
                </template>

                <template v-else>
                    <!-- Players need a deck and must get ready. Judges and spectators don't. -->
                    <template v-if="multiplayer.selfIsPlayer">
                        <button
                            v-if="!multiplayer.selfIsReady"
                            class="ready-btn"
                            :disabled="!isSavedGame && multiplayer.selfDeck == null"
                            :title="
                                !isSavedGame && multiplayer.selfDeck == null ?
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
                            v-if="!isSavedGame && !core.selfDeck"
                            class="no-deck-message"
                        >
                            Select a deck through the top bar to get ready
                        </span>
                    </template>

                    <div
                        v-else-if="multiplayer.selfIsJudge"
                        class="room-seat-message"
                    >
                        You are a judge. You will see all cards.
                    </div>

                    <div
                        v-else
                        class="room-seat-message"
                    >
                        You are a spectator. You won't play.
                    </div>
                </template>
            </div>

            <!-- Right side of Game Controls -->
            <div class="game-controls-right">
                <template v-if="multiplayer.currentGameRoom.isStarted && !multiplayer.selfIsReady">
                    <div
                        v-if="!isSeatedPlayer && !multiplayer.currentGameRoom?.allowSpectators"
                        class="spectate-disallowed"
                    >
                        Spectators are not allowed
                    </div>

                    <button
                        v-else
                        class="connect-btn"
                        :disabled="isConnecting"
                        @click="startConnectIntoGame()"
                    >
                        <template v-if="isConnecting">
                            <span class="reconnect-spinner" />
                            Connecting...
                        </template>
                        <template v-else-if="isSeatedPlayer"> Reconnect to game </template>
                        <template v-else> Spectate game </template>
                    </button>
                </template>

                <template v-else>
                    <div
                        v-if="multiplayer.selfIsHost"
                        class="game-controls-right"
                    >
                        <template v-if="!isSavedGame">
                            <div
                                v-if="multiplayer.playerUsers.length == 0"
                                class="wait-for-players"
                            >
                                No players at the table
                            </div>

                            <template v-else>
                                <button
                                    class="pick-seating-btn"
                                    :disabled="!multiplayer.areAllPlayerUsersReady"
                                    :title="
                                        !multiplayer.areAllPlayerUsersReady ?
                                            'Wait for all players to be ready'
                                        :   ''
                                    "
                                    @click="startPickSeating()"
                                >
                                    Pick Seating
                                </button>

                                <button
                                    class="roll-seating-btn"
                                    :disabled="!multiplayer.areAllPlayerUsersReady"
                                    :title="
                                        !multiplayer.areAllPlayerUsersReady ?
                                            'Wait for all players to be ready'
                                        :   ''
                                    "
                                    @click="rollSeating()"
                                >
                                    Roll Seating
                                </button>
                            </template>
                        </template>

                        <div
                            v-if="multiplayer.missingSavedGamePlayers"
                            class="wait-for-players"
                        >
                            Waiting for players from the saved game to join
                        </div>

                        <button
                            v-else
                            class="start-game-btn"
                            :disabled="!multiplayer.isRoomReady || isStartingGame"
                            :title="
                                !multiplayer.areAllPlayerUsersReady ?
                                    'Wait for all players to be ready'
                                : !multiplayer.isSeatingReady ?
                                    'Pick or roll seating to start the game'
                                :   ''
                            "
                            @click="tryLaunchGame()"
                        >
                            <template v-if="isStartingGame">
                                <span class="reconnect-spinner" />
                                Starting...
                            </template>
                            <template v-else> ▶ Start Game </template>
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
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import {
    connectIntoGame,
    launchGame,
    leaveGameRoom,
    leaveSeat,
    pickSeat,
    rollSeating,
    setSelfRoomSeat,
    startPickSeating,
} from '@/client/multiplayer/room.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { CommunicationMode, EMPTY_SEATING, RoomSeat, User } from '@/shared/types/multiplayer.ts'
import { isSeated, ROOM_SEATS } from '@/shared/multiplayer/seats.ts'
import UserAvatar from '@/client/ui/components/UserAvatar.vue'
import * as logging from '@/client/logging.ts'
import { useBusStore } from '@/client/store/bus.ts'
import { countCards } from '@/client/gateway/deck.ts'
import { MAX_LIB_SIZE, MAX_PLAYERS, MIN_CRYPT_SIZE, MIN_LIB_SIZE } from '@/shared/const/model.ts'

const core = useCoreStore()
const multiplayer = useMultiplayerStore()
const bus = useBusStore()

const isSavedGame = computed(() => {
    return multiplayer.currentGameRoom?.isSavedGame
})

const isPickSeatingMode = computed(() => {
    if (!multiplayer.currentGameRoom?.seating) {
        return false
    }
    const actualSeatingCount = multiplayer.currentGameRoom.seating.length
    return (
        multiplayer.areAllPlayerUsersReady &&
        (multiplayer.currentGameRoom.seating == EMPTY_SEATING ||
            actualSeatingCount < multiplayer.playerUsers.length)
    )
})

const seatedUsers = computed<User[]>(() => {
    if (
        !multiplayer.currentGameRoom?.seating ||
        multiplayer.currentGameRoom?.seating == EMPTY_SEATING
    ) {
        return []
    }
    return multiplayer.currentGameRoom.seating
        .map(permId => multiplayer.users[permId])
        .filter(u => u)
})

const unseatedUsers = computed<User[]>(() => {
    if (!multiplayer.currentGameRoom) {
        return []
    }
    const seatedPermIds = multiplayer.currentGameRoom.seating || []
    return multiplayer.playerUsers.filter(user => !seatedPermIds.includes(user.permId))
})

const isSelfSeated = computed(() => {
    const gameRoom = multiplayer.currentGameRoom
    return gameRoom ? isSeated(gameRoom, multiplayer.selfUser.permId) : false
})

const orderedUsers = computed<User[]>(() => {
    return multiplayer.isSeatingReady ?
            multiplayer.seatedPlayerUsers
        :   multiplayer.sortedPlayerUsers
})

/**
 *  Room seats
 */

// Seats are locked while the game runs, while picking seating ( moving out would reset
// our readiness and drop the whole room out of pick mode ), and on saved games, where
// every competing player must stay at the table.
const canChangeRoomSeat = computed(() => {
    return !multiplayer.currentGameRoom?.isStarted && !isSavedGame.value && !isPickSeatingMode.value
})

function isRoomSeatDisabled(seat: RoomSeat) {
    if (multiplayer.selfRoomSeat == seat) {
        return true
    }
    if (seat == RoomSeat.Player) {
        return multiplayer.playerUsers.length >= MAX_PLAYERS
    }
    if (seat == RoomSeat.Spectator) {
        return !multiplayer.currentGameRoom?.allowSpectators
    }
    return false
}

function getRoomSeatTitle(seat: RoomSeat) {
    if (multiplayer.selfRoomSeat == seat) {
        return ''
    }
    if (seat == RoomSeat.Player && multiplayer.playerUsers.length >= MAX_PLAYERS) {
        return 'The table is full'
    }
    if (seat == RoomSeat.Spectator && !multiplayer.currentGameRoom?.allowSpectators) {
        return 'Spectators are not allowed in this room'
    }
    return ''
}

async function changeRoomSeat(seat: RoomSeat) {
    try {
        await setSelfRoomSeat(seat)
    } catch (error) {
        let message = 'Could not change seat'
        if (error instanceof Error) {
            message = `${message} : ${error.message}`
        }
        bus.alertError(message)
    }
}

/**
 *  Helper functions on User status
 */

function getUserStatusClass(user: User) {
    if (multiplayer.currentGameRoom?.isStarted) {
        return 'started'
    }
    if (!multiplayer.userDecks[user.permId]) {
        return 'no-deck'
    }
    if (user.isReady) {
        return 'ready'
    }
    return 'not-ready'
}

function getUserStatusText(user: User) {
    if (!multiplayer.userDecks[user.permId]) {
        return 'No Deck'
    }
    if (user.isReady) {
        return 'Ready'
    }
    return 'Not Ready'
}

function getDeckWarnings(user: User) {
    const deckList = multiplayer.userDecks[user.permId]
    if (!deckList) {
        return []
    }

    const counter = countCards(deckList)
    const warnings = []

    if (counter.lib < MIN_LIB_SIZE || counter.lib > MAX_LIB_SIZE) {
        warnings.push(`lib: ${counter.lib}`)
    }
    if (counter.crypt < MIN_CRYPT_SIZE) {
        warnings.push(`crypt: ${counter.crypt}`)
    }

    return warnings
}

/**
 *  Game Launching
 */

const isStartingGame = ref(false)

async function tryLaunchGame() {
    isStartingGame.value = true
    try {
        await launchGame()
    } catch (error) {
        let message = 'An error occurred while starting the game'
        if (error instanceof Error) {
            message = `${message} : ${error.message}`
        }
        bus.alertError(message)
        logging.captureException(error)
        isStartingGame.value = false
    }
}

/**
 *  Spectate/Reconnection with feedback
 */

const isConnecting = ref(false)

// Do we hold a turn order position in the started game ? ( as opposed to selfIsPlayer,
// which is about the room seat )
const isSeatedPlayer = computed(() => {
    const gameRoom = multiplayer.currentGameRoom
    return gameRoom ? isSeated(gameRoom, multiplayer.selfUser.permId) : false
})

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
</script>

<style lang="scss" scoped>
@use '../../styles/base' as *;

.panel-title {
    margin: 0 0 1rem 0;
    font-size: 1.25rem;
    font-weight: 300;
    font-family: serif;
    letter-spacing: 0.5px;
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
 *  Current Room Panel
 */

.current-room-panel {
    @include panel;
    grid-area: current-room;
    display: flex;
    flex-direction: column;
    min-height: 0; // Prevents overflow issues in grid layouts
}

.current-room-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.5rem;
}

.room-header-left {
    display: flex;
    align-items: start;
    gap: 1rem;
}

@mixin top-message {
    @include flex-center;
    font-size: 0.9rem;
    font-weight: 500;
    font-style: italic;
    letter-spacing: 0.3px;
    border-radius: 0.5rem;
    padding: 0.5rem 1rem;
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
}

.seating-rolled-message {
    @include top-message;
    color: $vibrant-emerald;
    background: rgba($vibrant-emerald, 0.1);
    border: 1px solid $vibrant-emerald;
}

.saved-game-message {
    @include top-message;
    color: $pearl-grey;
    background: rgba($azure-blue, 0.1);
    border: 1px solid $azure-blue;
}

.leave-btn {
    @include button-red;
    padding: 0.5rem 1rem;
}

// The player tiles, with the seat picker as a narrow column on their right
.room-body {
    display: flex;
    gap: 1rem;
    margin-bottom: 2rem;
    flex: 1; // Takes up available space, pushing game-controls down
}

.room-players {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    align-items: stretch;
    flex: 1; // Fills the row, keeping the seat picker against the right edge
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
    height: auto;
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

.player-name {
    font-size: 0.9rem;
    color: $pearl-grey;
    font-family: serif;
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

.deck-warnings {
    display: flex;
    gap: 0.15rem;
    align-items: center;
}

.deck-warning {
    font-size: 0.7rem;
    color: $warm-coral;
    background: rgba($wine-crimson, 0.3);
    padding: 0.15rem 0.4rem;
    border-radius: 0.25rem;
    border: 1px solid $warm-coral;
}

.attack-arrow {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    margin: 3rem 0;
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
    margin-top: auto; // Pushes to bottom if there's extra space

    display: flex;
    flex-direction: row;
    justify-content: space-between;
}

.game-controls-left {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
}

/**
 *  Room seats : judges and spectators
 */

.room-side-seats {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
    padding-top: 1rem;
    border-top: 1px solid $ash-grey;
}

.side-seat-row {
    display: flex;
    align-items: center;
    gap: 1rem;
}

.side-seat-label {
    font-size: 0.85rem;
    color: $silver-grey;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    min-width: 90px;
}

.side-seat-list {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
}

.side-seat {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0.75rem;
    background: rgba($shadow-grey, 0.5);
    border: 1px solid $ash-grey;
    border-radius: 0.25rem;

    &.judge {
        background: rgba($shadow-teal, 0.4);
        border-color: $light-teal;
    }
}

.side-seat-name {
    font-size: 0.85rem;
    color: $pearl-grey;
    font-family: serif;
}

.room-seat-picker {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    flex-shrink: 0; // Never squashed by the tiles
    align-self: center; // Centered in the vertical space of the tiles row
}

.room-seat-title {
    font-size: 0.85rem;
    color: $silver-grey;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    text-align: center;
    margin-bottom: 0.25rem;
}

.room-seat-btn {
    @include button-dark-grey;
    padding: 0.5rem 1rem;

    &.active {
        background: linear-gradient(135deg, $royal-purple 0%, $deep-purple 100%);
        border-color: $neon-purple;
        color: $pearl-grey;
        opacity: 1;
    }
}

.room-seat-message {
    @include inline-message;
    font-size: 0.9rem;
}

.game-controls-right {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
}

.connect-btn {
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

.pick-seating-btn {
    @include button-light-grey;
}

.host-message,
.spectate-disallowed,
.wait-for-players {
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

.saved-game-badge {
    @extend .blue-secondary-badge;
    margin-top: 0.2rem;
}

.judge-badge {
    @include secondary-badge;
    color: $pearl-grey;
    background: $shadow-teal;
    border-color: $light-teal;
    margin-top: 0.2rem;
}

.spectator-badge {
    @include secondary-badge;
    color: $silver-grey;
    background: $ash-grey;
    margin-top: 0.2rem;
}

.game-started {
    @include inline-message;
    font-size: 1.4rem;
}

/**
 *  Pick Seating Mode
 */

.unseated-players {
    @include flex-center;
    gap: 1rem;
    background: rgba($shadow-purple, 0.2);
    border: 1px solid $mist-grey;
    border-radius: 0.5rem;
    padding: 0.75rem 1rem;
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
}

.unseated-label {
    font-size: 0.85rem;
    color: $silver-grey;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.unseated-list {
    display: flex;
    gap: 0.75rem;
    align-items: center;
}

.unseated-player {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0.75rem;
    background: rgba($shadow-grey, 0.5);
    border: 1px solid $ash-grey;
    border-radius: 0.25rem;
}

.unseated-player-name {
    font-size: 0.85rem;
    color: $pearl-grey;
    font-family: serif;
}

.room-players.pick-seating {
    justify-content: center;
}

.available-seat {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 1rem;
    min-width: 120px;
    min-height: 120px;
    background: linear-gradient(145deg, rgba($deep-purple, 0.3) 0%, rgba($shadow-purple, 0.5) 100%);
    border: 2px dashed $mist-grey;
    border-radius: 0.25rem;
    cursor: pointer;
    transition: all 0.2s ease;

    &:hover {
        background: linear-gradient(
            145deg,
            rgba($deep-purple, 0.5) 0%,
            rgba($shadow-purple, 0.7) 100%
        );
        border-color: $dark-forest;
        transform: scale(1.05);
    }

    &.first-seat {
        min-width: 200px;
    }
}

.seat-icon {
    font-size: 2rem;
}

.seat-label {
    font-size: 0.85rem;
    color: $pale-grey;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.room-player.seated {
    border-color: $vibrant-emerald;
    box-shadow: 0 0 10px rgba($vibrant-emerald, 0.3);
}

.leave-seat-btn {
    @include button-red;
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
    margin-top: 0.5rem;
}
</style>
