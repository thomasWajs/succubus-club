import { watch, WatchHandle } from 'vue'
import Ably, { PresenceMessage, ChannelOptions } from 'ably'
import { ablyPublish, ablySubscribe, detachChannel, getAbly } from '@/gateway/realtime.ts'
import {
    GameMutationMessage,
    GameRoom,
    GameStateSyncMessage,
    PermanentId,
    PubsubMessageType,
    RoomId,
    User,
} from '@/multiplayer/types.ts'
import { useMultiplayerStore } from '@/store/multiplayer.ts'
import { useBusStore } from '@/store/bus.ts'
import * as logging from '@/logging.ts'
import { ChatMessage } from '@/store/history.ts'
import {
    SerializedChatMessage,
    serializeMultiplayerGame,
    serializeObject,
} from '@/gateway/serialization.ts'
import { shuffleArray } from '@/utils.ts'
import { useCoreStore } from '@/store/core.ts'
import { resetState, setupMultiplayerGame, startGame } from '@/game/setup.ts'
import { GameType } from '@/state/types.ts'
import { AnyGameMutation } from '@/state/gameMutations.ts'
import {
    applyGameResync,
    applyInitialGameState,
    makeMutationMessage,
    makeResyncGameStateMessage,
    receiveChatMessage,
    receiveMutationMessage,
    startGameResync,
} from '@/multiplayer/sync.ts'
import { broadcastGameRoom, deleteGameRoom } from '@/multiplayer/lobby.ts'
import { fetchGameState, storeGameState } from '@/gateway/gameState.ts'
import { Key } from '@/multiplayer/encryption.ts'

let _room: ReturnType<typeof connectRoom> | null = null

async function connectRoom(roomId: RoomId, key?: Key) {
    const ably = getAbly()

    let channelConfig: ChannelOptions = {}
    if (key) {
        channelConfig = {
            cipher: Ably.Realtime.Crypto.getDefaultParams({ key: key.buffer }),
        }
    }

    const roomChannel = ably.channels.get(roomId, channelConfig)
    await roomChannel.attach()

    return {
        multiplayer: useMultiplayerStore(),
        ably,
        roomChannel,
    }
}
async function initRoom(roomId: RoomId, key?: Key) {
    if (_room) {
        throw new Error('Room already initialized')
    }
    _room = connectRoom(roomId, key)
}

async function useRoom() {
    if (!_room) {
        throw new Error('Room not initialized')
    }
    return await _room
}

function ensureGameRoom(): GameRoom {
    const multiplayer = useMultiplayerStore()
    if (!_room || !multiplayer.currentGameRoom) {
        throw new Error(`Not in a game room`)
    }
    return multiplayer.currentGameRoom
}

/**
 * Joins / Leave
 */

export async function joinGameRoom(gameRoom: GameRoom, key?: Key) {
    const multiplayer = useMultiplayerStore()
    const bus = useBusStore()

    try {
        // We're already there : do nothing
        if (multiplayer.currentGameRoomId == gameRoom.id) {
            return
        }

        // Leave any previous room
        await leaveGameRoom()

        await initRoom(gameRoom.id, key)
        const { roomChannel } = await useRoom()

        multiplayer.selfIsReady = false
        multiplayer.currentGameRoomId = gameRoom.id
        if (canUserBeAPlayer(gameRoom, multiplayer.selfUser)) {
            multiplayer.upsertGameRoomPlayer(multiplayer.selfUser)
        }

        // The host is responsible for sending game room updates to the other players
        if (multiplayer.selfIsHost) {
            setupGameRoomWatcher()
        }

        /**
         * Set up room event handlers
         */

        await roomChannel.presence.enter(multiplayer.selfUser)
        await Promise.all([
            // Presence / Users
            roomChannel.presence.subscribe('enter', onMemberJoin),
            roomChannel.presence.subscribe('leave', onMemberLeave),

            // Game messages
            ablySubscribe(roomChannel, PubsubMessageType.LaunchGame, onReceiveLaunchGame),
            ablySubscribe(roomChannel, PubsubMessageType.Chat, onReceiveChatMessage),
            ablySubscribe(roomChannel, PubsubMessageType.GameMutation, onReceiveGameMutation),
            ablySubscribe(
                roomChannel,
                PubsubMessageType.RequestResync,
                onReceiveRequestResyncGameState,
            ),
        ])
    } catch (e) {
        logging.captureException(e)
        bus.alertError('Error joining game room. Please try again')
        return
    }
}

export async function leaveGameRoom() {
    // We're not in a room, do nothing.
    if (!_room) {
        return
    }

    const { multiplayer, ably, roomChannel } = await useRoom()

    // We're the last user in the room, we can delete it.
    if (multiplayer.gameRoomUsers.length == 1 && multiplayer.currentGameRoomId) {
        await deleteGameRoom(multiplayer.currentGameRoomId)
    }

    unwatchGameRoom?.()
    unwatchGameRoom = null
    // Detaching from the channel will also leave the presence
    await detachChannel(roomChannel)
    // Releasing from the channel will also unsubscribe all listeners
    ably.channels.release(roomChannel.name)
    _room = null
    multiplayer.selfIsReady = false
    multiplayer.currentGameRoomId = null
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

function canUserBeAPlayer(gameRoom: GameRoom, user: User): boolean {
    if (gameRoom.isStarted && gameRoom.seating) {
        // Started games only accept players existing in the seating
        return gameRoom.seating.includes(user.permId)
    } else {
        // Pending games accept new players up until 5 players
        return gameRoom.players.length < 5 || gameRoom.players.includes(user.permId)
    }
}

function onMemberJoin(presence: PresenceMessage) {
    const multiplayer = useMultiplayerStore()
    const user = multiplayer.users[presence.clientId]
    const gameRoom = multiplayer.currentGameRoom

    if (!user || !gameRoom) {
        return
    }

    if (canUserBeAPlayer(gameRoom, user)) {
        alertReconnect(gameRoom, user)
        multiplayer.upsertGameRoomPlayer(user)

        // Special-case : host is not connected anymore, and can't broadcast with its watcher.
        if (gameRoom && !multiplayer.isHostConnected) {
            broadcastGameRoom(gameRoom)
        }
    }

    multiplayer.stats.peerJoins++
}

function onMemberLeave(presence: PresenceMessage) {
    const multiplayer = useMultiplayerStore()
    const user = multiplayer.users[presence.clientId]
    const gameRoom = multiplayer.currentGameRoom

    if (user) {
        alertDisconnect(user)
        multiplayer.removeGameRoomPlayer(user)
        multiplayer.stats.peerLeaves++

        // Special-case : host is not connected anymore, and can't broadcast with its watcher.
        if (gameRoom && !multiplayer.isHostConnected) {
            broadcastGameRoom(gameRoom)
        }
    }
}

/** Game Room Messages */

export function rollSeating() {
    const multiplayer = useMultiplayerStore()
    const gameRoom = ensureGameRoom()
    // Cannot roll seating on a game that's already started
    if (gameRoom.isStarted) {
        throw new Error(`Game already started`)
    }
    if (!multiplayer.selfIsHost) {
        throw new Error(`You are not the host`)
    }
    gameRoom.seating = shuffleArray<string>(gameRoom.players)
}

export async function launchGame() {
    const core = useCoreStore()
    const gameRoom = ensureGameRoom()
    // Cannot launch a game that's already started
    if (gameRoom.isStarted || core.gameIsStarted) {
        throw new Error(`Game already started`)
    }

    const { roomChannel } = await useRoom()
    core.gameType = GameType.Multiplayer // Needed now to setup correctly the game state

    setupMultiplayerGame(gameRoom)
    const serializedGame = serializeMultiplayerGame()
    const gameStateId = await storeGameState(serializedGame)
    await ablyPublish(roomChannel, PubsubMessageType.LaunchGame, gameStateId)
    gameRoom.isStarted = true
    startGame(GameType.Multiplayer)
    await core.userProfile.setLastMultiGame(gameRoom.id)
}

async function onReceiveLaunchGame(gameStateId: string) {
    const core = useCoreStore()
    const gameRoom = ensureGameRoom()
    // Cannot launch a game if we're already in one
    if (core.gameIsStarted) {
        return
    }

    const serializedGame = await fetchGameState(gameStateId)
    if (!serializedGame) {
        throw new Error(`Could not find game state at ${gameStateId} in Firestore.`)
    }

    await applyInitialGameState(serializedGame)
    startGame(GameType.Multiplayer)
    await core.userProfile.setLastMultiGame(gameRoom.id)
}

/** Chat Messages */

export async function broadcastChatMessage(message: ChatMessage) {
    const gameRoom = ensureGameRoom()
    if (!gameRoom.isStarted) {
        throw new Error(`Game is not started`)
    }
    const { roomChannel } = await useRoom()
    await ablyPublish(roomChannel, PubsubMessageType.Chat, serializeObject(message))
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
        throw new Error(`Game is not started`)
    }
    const { roomChannel } = await useRoom()
    const message = await makeMutationMessage(gameMutation)
    await ablyPublish(roomChannel, PubsubMessageType.GameMutation, message)
}

async function onReceiveGameMutation(gameMutationMessage: GameMutationMessage) {
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
        throw new Error(`Game is not started`)
    }
    const { multiplayer, ably, roomChannel } = await useRoom()

    startGameResync(isUserRequest)

    const syncChannelName = `sync-${multiplayer.selfUser.permId}`
    const syncChannel = ably.channels.get(syncChannelName)
    await ablySubscribe(syncChannel, PubsubMessageType.Resync, onReceiveResyncGameState)
    // Leave the resync channel after 30 seconds
    setTimeout(async () => {
        await detachChannel(syncChannel)
        ably.channels.release(syncChannelName)
    }, 1000 * 30)

    // Ask everyone, and use the more recent state ( according to global clock )
    await ablyPublish(roomChannel, PubsubMessageType.RequestResync, syncChannelName)
}

export async function onReceiveRequestResyncGameState(syncChannelName: string) {
    const gameRoom = ensureGameRoom()
    if (!gameRoom.isStarted) {
        throw new Error(`Game is not started`)
    }

    const { ably } = await useRoom()
    const syncChannel = ably.channels.get(syncChannelName)
    const syncMessage = await makeResyncGameStateMessage()
    await ablyPublish(syncChannel, PubsubMessageType.Resync, syncMessage)
}

export async function onReceiveResyncGameState(syncMessage: GameStateSyncMessage) {
    const gameRoom = ensureGameRoom()
    // Cannot receive sync state if the game is not started
    if (!gameRoom.isStarted) {
        return
    }
    await applyGameResync(syncMessage)
}

export async function connectIntoGame(gameRoom?: GameRoom) {
    const bus = useBusStore()

    if (gameRoom) {
        await joinGameRoom(gameRoom)
    }

    ensureGameRoom()
    bus.isResyncing = true
    resetState()
    startGame(GameType.Multiplayer)
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
        gameRoom.seating &&
        gameRoom.seating.includes(user.permId) &&
        last_disconnect_alert[user.permId]
    ) {
        bus.alertSuccess(`${user.name} has reconnected into the game room.`)
        delete last_disconnect_alert[user.permId]
    }
}
