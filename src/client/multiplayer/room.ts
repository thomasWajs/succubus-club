import { watch, WatchHandle } from 'vue'
import { PresenceMessage } from 'ably'
import { ablyPublish, ablySubscribe, releaseScsClient } from '@/client/gateway/realtime.ts'
import {
    CommunicationMode,
    DeckMessage,
    EMPTY_SEATING,
    GameMutationMessage,
    GameRoom,
    LeaveSeatMessage,
    MultiplayerMessageType,
    PermanentId,
    PickSeatMessage,
    RoomSeat,
    ScsRollSeatingMessage,
    SerializedChatMessage,
    SerializedMultiplayerGame,
    SetRoomSeatMessage,
    User,
} from '@/shared/types/multiplayer.ts'
import {
    canTakeRoomSeat,
    getRoomSeat,
    isSeated,
    removeFromSeating,
    resolveRoomSeat,
} from '@/shared/multiplayer/seats.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { useBusStore } from '@/client/store/bus.ts'
import * as logging from '@/client/logging.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { resetState, startGame } from '@/client/state/setup.ts'
import { AnyGameMutation } from '@/shared/state/gameMutations.ts'
import {
    applyInitialGameState,
    makeMutationMessage,
    receiveChatMessage,
    receiveMutationMessage,
    resetPendingSyncMessage,
    startGameResync,
} from '@/client/multiplayer/sync.ts'
import { broadcastGameRoom, deleteGameRoom } from '@/client/multiplayer/lobby.ts'
import { Key } from '@/client/multiplayer/encryption.ts'
import { ChatMessage } from '@/shared/types/history.ts'
import { serializeObject } from '@/shared/serialization.ts'
import {
    ablyCommunication,
    getRoomChannel,
    onReceiveRequestResyncGameState,
} from '@/client/multiplayer/communication/ably.ts'
import { Communication } from '@/client/multiplayer/communication'
import {
    onReceiveGameSync,
    onReceiveMutationRejected,
    onReceiveServerError,
    scsCommunication,
} from '@/client/multiplayer/communication/scs.ts'
import { NotInAGameRoom } from '@/client/types.ts'

export function getCommunication(gameRoom?: GameRoom): Communication {
    if (!gameRoom) {
        gameRoom = useMultiplayerStore().currentGameRoom
    }

    if (!gameRoom) {
        throw new NotInAGameRoom(`Not connected to a game room`)
    }

    if (gameRoom.communication == CommunicationMode.Ably) {
        return ablyCommunication
    } else {
        return scsCommunication
    }
}

export function ensureGameRoom(): GameRoom {
    const multiplayer = useMultiplayerStore()
    const comm = getCommunication()

    if (!comm.isInRoom() || !multiplayer.currentGameRoom) {
        throw new NotInAGameRoom(`Not in a game room`)
    }

    return multiplayer.currentGameRoom
}

/**
 * Joins / Leave
 */

export async function joinGameRoom(gameRoom: GameRoom, key?: Key) {
    const multiplayer = useMultiplayerStore()
    const bus = useBusStore()
    const comm = getCommunication(gameRoom)

    try {
        // We're already there : do nothing
        if (multiplayer.currentGameRoomId == gameRoom.id) {
            return
        }

        if (
            gameRoom.isSavedGame &&
            !gameRoom.competingPlayers.includes(multiplayer.selfUser.permId)
        ) {
            bus.alertError('Only players from the saved game can join the room')
            return
        }

        // Leave any previous room
        await leaveGameRoom()

        multiplayer.selfIsReady = false
        multiplayer.currentGameRoomId = gameRoom.id
        multiplayer.snapshotCurrentGameRoom()

        // We'll always need an ably room, for presence and non-gameState messages
        await ablyCommunication.joinRoom(gameRoom.id, key)
        const roomChannel = getRoomChannel()

        /**
         * Set up room event handlers
         */

        await roomChannel.presence.enter(multiplayer.selfUser)

        // In SCS mode, subscribe to RollSeating, GameState and MutationRejected from server
        let scsSubscriptions: Promise<void>[] = []
        if (gameRoom.communication === CommunicationMode.SCS) {
            scsSubscriptions = [
                scsCommunication.subscribe(
                    MultiplayerMessageType.RollSeating,
                    onReceiveRollSeating,
                ),
                scsCommunication.subscribe(MultiplayerMessageType.GameState, onReceiveGameSync),
                scsCommunication.subscribe(
                    MultiplayerMessageType.MutationRejected,
                    onReceiveMutationRejected,
                ),
                scsCommunication.subscribe(MultiplayerMessageType.Error, onReceiveServerError),
            ]
        }

        // Activate all subscriptions
        await Promise.all([
            // Presence / Users
            roomChannel.presence.subscribe('enter', onMemberJoin),
            roomChannel.presence.subscribe('leave', onMemberLeave),

            // Game messages
            comm.subscribe(MultiplayerMessageType.LaunchGame, comm.onReceiveLaunchGame),
            comm.subscribe(MultiplayerMessageType.GameMutation, receiveGameMutation),
            comm.subscribe(MultiplayerMessageType.Deck, receiveDeck),

            // Chat and seat picking is always through ably
            ablySubscribe(roomChannel, MultiplayerMessageType.Chat, onReceiveChatMessage),
            ablySubscribe(
                roomChannel,
                MultiplayerMessageType.RequestResync,
                onReceiveRequestResyncGameState,
            ),
            ablySubscribe(roomChannel, MultiplayerMessageType.PickSeat, onReceivePickSeat),
            ablySubscribe(roomChannel, MultiplayerMessageType.LeaveSeat, onReceiveLeaveSeat),
            ablySubscribe(roomChannel, MultiplayerMessageType.SetRoomSeat, onReceiveSetRoomSeat),

            ...scsSubscriptions,
        ])

        // The host is responsible for sending game room updates to the other players
        if (multiplayer.selfIsHost) {
            setupGameRoomWatcher()
        }

        // If ably, it's already joined. If SCS, we need to join.
        await comm.joinRoom(gameRoom.id, key)

        const permId = multiplayer.selfUser.permId
        multiplayer.setGameRoomSeat(permId, resolveRoomSeat(gameRoom, permId))

        if (multiplayer.selfDeck) {
            await comm.sendDeck()
        }
    } catch (e) {
        logging.captureException(e)
        bus.alertError('Error joining game room. Please try again')
        return
    }
}

export async function leaveGameRoom() {
    const multiplayer = useMultiplayerStore()
    multiplayer.currentGameRoomFallback = null

    const gameRoom = multiplayer.currentGameRoom
    if (!gameRoom) {
        return
    }

    const comm = getCommunication(gameRoom)
    if (!comm.isInRoom()) {
        return
    }

    // We're the last user in the room, we can delete it.
    // Every seat counts : judges and spectators still need the room to exist.
    if (multiplayer.allGameRoomUsers.length == 1 && multiplayer.currentGameRoomId) {
        await deleteGameRoom(multiplayer.currentGameRoomId)
    }

    unwatchGameRoom?.()
    unwatchGameRoom = null
    // We're always connected to ably ( for presence )
    await ablyCommunication.leaveRoom()
    // Needed if conencted to SCS
    await comm.leaveRoom()
    multiplayer.selfIsReady = false
    multiplayer.currentGameRoomId = null
    // Reset the pending sync message, in case there's still messages in there
    resetPendingSyncMessage()
}

/**
 * GameRoom watcher
 */

let unwatchGameRoom: WatchHandle | null = null
export function setupGameRoomWatcher() {
    // Watcher is already active, do nothing.
    if (unwatchGameRoom) {
        return
    }

    const multiplayer = useMultiplayerStore()

    // Watch for changes to currentGameRoom and broadcast when it updates
    unwatchGameRoom = watch(
        () => multiplayer.currentGameRoom,
        gameRoom => {
            // Snapshot only if not already reading currentGameRoomFallback,
            // else we would end up in a recursive loop
            if (gameRoom != multiplayer.currentGameRoomFallback) {
                multiplayer.snapshotCurrentGameRoom()
            }

            if (gameRoom && multiplayer.selfIsHost) {
                broadcastGameRoom(gameRoom)
            }
        },
        { deep: true }, // Watch for deep changes in the gameRoom object
    )
}

/**
 * Presence / Users
 */

function onMemberJoin(presence: PresenceMessage) {
    const multiplayer = useMultiplayerStore()
    const user = multiplayer.users[presence.clientId]
    const gameRoom = multiplayer.currentGameRoom

    if (!user || !gameRoom) {
        return
    }

    // A judge or a spectator kept their seat while offline, so this restores it
    const seat = resolveRoomSeat(gameRoom, user.permId)
    if (seat == RoomSeat.Player) {
        alertReconnect(gameRoom, user)
    }
    multiplayer.setGameRoomSeat(user.permId, seat)

    // Special-case : host is not connected anymore, and can't broadcast with its watcher.
    if (!multiplayer.isHostConnected) {
        broadcastGameRoom(gameRoom)
    }

    // In Ably mode, send our decklist to the newly connected user
    if (gameRoom.communication == CommunicationMode.Ably) {
        getCommunication(gameRoom).sendDeck()
    }
}

function onMemberLeave(presence: PresenceMessage) {
    const multiplayer = useMultiplayerStore()
    const user = multiplayer.users[presence.clientId]
    const gameRoom = multiplayer.currentGameRoom

    if (user) {
        alertDisconnect(user)
        multiplayer.releaseGameRoomSeat(user.permId)

        // Special-case : host is not connected anymore, and can't broadcast with its watcher.
        if (gameRoom && !multiplayer.isHostConnected) {
            broadcastGameRoom(gameRoom)
        }
    }
}

function receiveDeck(deckMessage: DeckMessage) {
    const multiplayer = useMultiplayerStore()
    multiplayer.userDecks[deckMessage.permId] = deckMessage.deckList
}

/** Seating Messages */

export function rollSeating() {
    const multiplayer = useMultiplayerStore()
    const gameRoom = ensureGameRoom()
    const comm = getCommunication(gameRoom)

    // Cannot roll seating on a game that's already started
    if (gameRoom.isStarted) {
        throw new Error(`Game already started`)
    }
    if (!multiplayer.selfIsHost) {
        throw new Error(`You are not the host`)
    }

    comm.rollSeating()
}

function onReceiveRollSeating(message: ScsRollSeatingMessage) {
    const gameRoom = ensureGameRoom()

    // Cannot roll seating if the game is already started
    if (gameRoom.isStarted) {
        return
    }

    // Update the seating with the server-generated seating
    gameRoom.seating = message.seating
}

export function startPickSeating() {
    const multiplayer = useMultiplayerStore()
    const gameRoom = ensureGameRoom()
    // Cannot pick seating on a game that's already started
    if (gameRoom.isStarted) {
        throw new Error(`Game already started`)
    }
    if (!multiplayer.selfIsHost) {
        throw new Error(`You are not the host`)
    }
    // Initialize seating with 'EMPTY' marker to start pick mode
    // (RTDB wipes empty arrays, so we use a marker instead)
    gameRoom.seating = EMPTY_SEATING
}

export async function pickSeat(position: number) {
    const multiplayer = useMultiplayerStore()
    const gameRoom = ensureGameRoom()
    // Cannot pick seat on a game that's already started
    if (gameRoom.isStarted) {
        throw new Error(`Game already started`)
    }
    // Check if player is already seated
    if (isSeated(gameRoom, multiplayer.selfUser.permId)) {
        throw new Error(`You are already seated`)
    }
    // Only players get a turn order position : a judge or a spectator in the seating
    // would keep isSeatingReady false forever.
    if (getRoomSeat(gameRoom, multiplayer.selfUser.permId) != RoomSeat.Player) {
        throw new Error(`Only players can pick a seat`)
    }
    // Initialize seating if needed
    // Replace EMPTY marker with actual seating array if this is the first pick
    if (!gameRoom.seating || gameRoom.seating == EMPTY_SEATING) {
        gameRoom.seating = []
    }
    // Insert player at the specified position
    gameRoom.seating.splice(position, 0, multiplayer.selfUser.permId)

    // Broadcast the seat pick to all players
    await broadcastPickSeat(multiplayer.selfUser.permId, position)
}

async function broadcastPickSeat(permId: PermanentId, position: number) {
    const gameRoom = ensureGameRoom()
    if (gameRoom.isStarted) {
        throw new Error(`Game already started`)
    }
    const roomChannel = getRoomChannel()
    await ablyPublish(roomChannel, MultiplayerMessageType.PickSeat, { permId, position })
}

async function onReceivePickSeat(message: PickSeatMessage) {
    const multiplayer = useMultiplayerStore()
    const gameRoom = ensureGameRoom()

    // Cannot pick seat if the game is already started
    // Don't apply our own seat picks (already applied locally)
    // Validate that the player isn't already seated
    // Only players get a turn order position
    if (
        gameRoom.isStarted ||
        message.permId === multiplayer.selfUser.permId ||
        isSeated(gameRoom, message.permId) ||
        getRoomSeat(gameRoom, message.permId) != RoomSeat.Player
    ) {
        return
    }

    // Initialize seating if needed
    // Replace EMPTY marker with actual seating array if this is the first pick
    if (!gameRoom.seating || gameRoom.seating == EMPTY_SEATING) {
        gameRoom.seating = []
    }

    // Validate position is within valid bounds
    if (message.position < 0 || message.position > gameRoom.seating.length) {
        return
    }

    // Insert player at the specified position
    gameRoom.seating.splice(message.position, 0, message.permId)
}

export async function leaveSeat() {
    const multiplayer = useMultiplayerStore()
    const gameRoom = ensureGameRoom()
    // Cannot leave seat on a game that's already started
    if (gameRoom.isStarted) {
        throw new Error(`Game already started`)
    }
    // Check if player is seated
    if (!isSeated(gameRoom, multiplayer.selfUser.permId)) {
        throw new Error(`You are not seated`)
    }
    removeFromSeating(gameRoom, multiplayer.selfUser.permId)

    // Broadcast the seat leave to all players
    await broadcastLeaveSeat(multiplayer.selfUser.permId)
}

async function broadcastLeaveSeat(permId: PermanentId) {
    const gameRoom = ensureGameRoom()
    if (gameRoom.isStarted) {
        throw new Error(`Game already started`)
    }
    const roomChannel = getRoomChannel()
    await ablyPublish(roomChannel, MultiplayerMessageType.LeaveSeat, { permId })
}

async function onReceiveLeaveSeat(message: LeaveSeatMessage) {
    const multiplayer = useMultiplayerStore()
    const gameRoom = ensureGameRoom()

    // Cannot leave seat if the game is already started
    // Don't apply our own seat leaves (already applied locally)
    // Check if player is seated
    if (
        gameRoom.isStarted ||
        message.permId === multiplayer.selfUser.permId ||
        !isSeated(gameRoom, message.permId)
    ) {
        return
    }

    removeFromSeating(gameRoom, message.permId)
}

/** Room Seat Messages */

/**
 * Move ourselves to another room seat ( player / judge / spectator ).
 *
 * Mutate locally then broadcast, like pickSeat : only the host persists the room to
 * RTDB, so a local mutation alone would be wiped by the next host broadcast.
 */
export async function setSelfRoomSeat(seat: RoomSeat) {
    const multiplayer = useMultiplayerStore()
    const gameRoom = ensureGameRoom()
    const permId = multiplayer.selfUser.permId

    // Cannot change seat on a game that's already started
    if (gameRoom.isStarted) {
        throw new Error(`Game already started`)
    }
    // Already there : nothing to do
    if (getRoomSeat(gameRoom, permId) == seat) {
        return
    }
    if (!canTakeRoomSeat(gameRoom, permId, seat)) {
        throw new Error(`You cannot take this seat`)
    }

    multiplayer.setGameRoomSeat(permId, seat)

    // Judges and spectators never gate the game start
    if (seat != RoomSeat.Player) {
        multiplayer.selfIsReady = false
    }

    // Broadcast the seat change to all users
    await broadcastSetRoomSeat(permId, seat)
}

async function broadcastSetRoomSeat(permId: PermanentId, seat: RoomSeat) {
    const gameRoom = ensureGameRoom()
    if (gameRoom.isStarted) {
        throw new Error(`Game already started`)
    }
    const roomChannel = getRoomChannel()
    await ablyPublish(roomChannel, MultiplayerMessageType.SetRoomSeat, { permId, seat })
}

async function onReceiveSetRoomSeat(message: SetRoomSeatMessage) {
    const multiplayer = useMultiplayerStore()
    const gameRoom = ensureGameRoom()

    // Cannot change seat if the game is already started
    // Don't apply our own seat changes (already applied locally)
    // Validate the seat is still available. Two users racing for the last player seat
    // both pass locally, but the host arbitrates here and its broadcast wins.
    if (
        gameRoom.isStarted ||
        message.permId === multiplayer.selfUser.permId ||
        !canTakeRoomSeat(gameRoom, message.permId, message.seat)
    ) {
        return
    }

    multiplayer.setGameRoomSeat(message.permId, message.seat)

    // Special-case : host is not connected anymore, and can't broadcast with its watcher.
    if (!multiplayer.isHostConnected) {
        broadcastGameRoom(gameRoom)
    }
}

/** Game launching */

export async function launchGame() {
    const core = useCoreStore()
    const gameRoom = ensureGameRoom()
    const comm = getCommunication(gameRoom)

    // Cannot launch a game that's already started
    if (gameRoom.isStarted || core.gameIsStarted) {
        throw new Error(`Game already started`)
    }

    if (!gameRoom.seating || gameRoom.seating == EMPTY_SEATING) {
        throw new Error('Seating is not ready')
    }

    await comm.launchGame(gameRoom)

    // Disconnect from SCS websocket if we won't be using it
    if (gameRoom.communication != CommunicationMode.SCS) {
        releaseScsClient()
    }
}

export async function receiveLaunchGame(serializedGame: SerializedMultiplayerGame) {
    const core = useCoreStore()
    const gameRoom = ensureGameRoom()
    // Cannot launch a game if we're already in one
    if (core.gameIsStarted) {
        return
    }

    await applyInitialGameState(serializedGame)
    startGame()
    await core.userProfile.setLastMultiGame(gameRoom.id)

    // Disconnect from SCS websocket if we won't be using it
    if (gameRoom.communication != CommunicationMode.SCS) {
        releaseScsClient()
    }
}

/** Chat Messages */

export async function broadcastChatMessage(message: ChatMessage) {
    const gameRoom = ensureGameRoom()
    if (!gameRoom.isStarted) {
        return
    }
    const roomChannel = getRoomChannel()
    await ablyPublish(roomChannel, MultiplayerMessageType.Chat, serializeObject(message))
}

export async function onReceiveChatMessage(serializedMessage: SerializedChatMessage) {
    const gameRoom = ensureGameRoom()
    // Cannot receive chat message if the game is not started
    if (!gameRoom.isStarted) {
        return
    }

    await receiveChatMessage(serializedMessage)
}

/** Game Mutation Messages */

export async function broadcastGameMutation(gameMutation: AnyGameMutation) {
    const gameRoom = ensureGameRoom()
    if (!gameRoom.isStarted) {
        return
    }
    const comm = getCommunication(gameRoom)

    const message = await makeMutationMessage(gameMutation)
    await comm.broadcastGameMutation(message)
}

export async function receiveGameMutation(gameMutationMessage: GameMutationMessage) {
    const gameRoom = ensureGameRoom()
    // Cannot receive mutations if the game is not started
    if (!gameRoom.isStarted) {
        return
    }
    await receiveMutationMessage(gameMutationMessage)
}

/** State Sync Messages */

export async function requestResyncGameState(isUserRequest: boolean = false) {
    const gameRoom = ensureGameRoom()
    if (!gameRoom.isStarted) {
        return
    }
    const comm = getCommunication(gameRoom)

    startGameResync(isUserRequest)
    await comm.requestResyncGameState()
}

export async function connectIntoGame(gameRoom?: GameRoom) {
    const bus = useBusStore()

    if (gameRoom) {
        await joinGameRoom(gameRoom)
    }

    ensureGameRoom()
    bus.isResyncing = true
    resetState()
    startGame()
    await requestResyncGameState()
}

/**
 * Connection / Disconnection Alerts
 */

const last_disconnect_alert = {} as Record<PermanentId, Date>

function alertDisconnect(user: User) {
    const bus = useBusStore()
    const multiplayer = useMultiplayerStore()

    if (
        multiplayer.currentGameRoom?.isStarted &&
        multiplayer.currentGameRoom.players.includes(user.permId)
    ) {
        bus.alertWarning(`${user.name} has left the game.`)
        last_disconnect_alert[user.permId] = new Date()
    }
}

function alertReconnect(gameRoom: GameRoom, user: User) {
    const bus = useBusStore()

    // Alert the reconnection if a peer join while :
    // the game is started AND he's seated AND we alerted for the disconnection
    if (
        gameRoom.isStarted &&
        isSeated(gameRoom, user.permId) &&
        last_disconnect_alert[user.permId]
    ) {
        bus.alertSuccess(`${user.name} has reconnected into the game room.`)
        delete last_disconnect_alert[user.permId]
    }
}
