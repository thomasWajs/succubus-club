import {
    AblyGameStateMessage,
    AblyLaunchGameMessage,
    AblyRequestResyncMessage,
    GameMutationMessage,
    GameRoom,
    MultiplayerMessageType,
    RoomId,
} from '@/shared/types/multiplayer.ts'
import { Key } from '@/client/multiplayer/encryption.ts'
import {
    ablyPublish,
    ablySubscribe,
    detachChannel,
    getAbly,
    MessageHandler,
} from '@/client/gateway/realtime.ts'
import Ably, { ChannelOptions } from 'ably'
import { ensureGameRoom, receiveLaunchGame } from '@/client/multiplayer/room.ts'
import { shuffleArray } from '@/shared/utils.ts'
import { Communication } from '@/client/multiplayer/communication/index.ts'
import { GameType } from '@/shared/types/state.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { fetchGameState, storeGameState } from '@/client/gateway/gameState.ts'
import { serializeMultiplayerGame } from '@/client/gateway/serialization.ts'
import { setupMultiplayerGame, startGame } from '@/client/state/setup.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { applyGameResync, makeResyncGameStateMessage } from '@/client/multiplayer/sync.ts'

/**
 * Ably Room Management
 */

let _roomChannel: Ably.RealtimeChannel | null = null

async function connectRoom(roomId: RoomId, key?: Key) {
    const ably = getAbly()

    let channelConfig: ChannelOptions = {}
    if (key) {
        channelConfig = {
            cipher: Ably.Realtime.Crypto.getDefaultParams({ key: key.buffer }),
        }
    }

    _roomChannel = ably.channels.get(roomId, channelConfig)
    await _roomChannel.attach()
}

export async function disconnectRoom() {
    if (!_roomChannel) {
        return
    }

    const ably = getAbly()
    // Detaching from the channel will also leave the presence
    await detachChannel(_roomChannel)
    // Releasing from the channel will also unsubscribe all listeners
    ably.channels.release(_roomChannel.name)
    _roomChannel = null
}

function isInRoom() {
    return _roomChannel != null
}

export async function initRoom(roomId: RoomId, key?: Key) {
    if (!_roomChannel) {
        await connectRoom(roomId, key)
    }
}

export function getRoomChannel() {
    if (!_roomChannel) {
        throw new Error('Room not initialized')
    }
    return _roomChannel
}

/**
 * Ably Game Sync
 */

async function requestResyncGameState() {
    const multiplayer = useMultiplayerStore()
    const ably = getAbly()
    const roomChannel = getRoomChannel()

    const syncChannelName = `sync-${multiplayer.selfUser.permId}`
    const syncChannel = ably.channels.get(syncChannelName)
    await ablySubscribe(syncChannel, MultiplayerMessageType.GameState, onReceiveResyncGameState)
    // Leave the resync channel after 30 seconds
    setTimeout(async () => {
        await detachChannel(syncChannel)
        ably.channels.release(syncChannelName)
    }, 1000 * 30)

    // Ask everyone, and use the more recent state ( according to global clock )
    await ablyPublish(roomChannel, MultiplayerMessageType.RequestResync, { syncChannelName })
}

export async function onReceiveRequestResyncGameState(message: AblyRequestResyncMessage) {
    const gameRoom = ensureGameRoom()
    if (!gameRoom.isStarted) {
        throw new Error(`Game is not started`)
    }

    const ably = getAbly()
    const syncChannel = ably.channels.get(message.syncChannelName)
    const syncMessage = await makeResyncGameStateMessage()
    await ablyPublish(syncChannel, MultiplayerMessageType.GameState, syncMessage)
}

export async function onReceiveResyncGameState(syncMessage: AblyGameStateMessage) {
    const gameRoom = ensureGameRoom()
    // Cannot receive sync state if the game is not started
    if (!gameRoom.isStarted) {
        return
    }
    await applyGameResync(syncMessage)
}

/**
 * Implementation of Communication through Ably
 */

export const ablyCommunication: Communication = {
    joinRoom: initRoom,
    leaveRoom: disconnectRoom,
    isInRoom,

    async subscribe<T>(messageType: MultiplayerMessageType, handler: MessageHandler<T>) {
        await ablySubscribe(getRoomChannel(), messageType, handler)
    },

    async sendDeck() {
        const multiplayer = useMultiplayerStore()
        if (!multiplayer.selfDeck) {
            return
        }
        const roomChannel = getRoomChannel()
        await ablyPublish(roomChannel, MultiplayerMessageType.Deck, {
            permId: multiplayer.selfUser.permId,
            deckList: multiplayer.selfDeck,
        })
    },

    rollSeating() {
        const gameRoom = ensureGameRoom()
        // Will be propagated through the gameRoom watcher
        gameRoom.seating = shuffleArray<string>(gameRoom.players)
    },

    async launchGame(gameRoom: GameRoom) {
        const core = useCoreStore()
        const roomChannel = getRoomChannel()
        core.gameType = GameType.Multiplayer // Needed now to setup correctly the game state

        setupMultiplayerGame(gameRoom)
        const serializedGame = serializeMultiplayerGame()
        const gameStateId = await storeGameState(serializedGame)
        await ablyPublish(roomChannel, MultiplayerMessageType.LaunchGame, { gameStateId })
        gameRoom.isStarted = true
        startGame(GameType.Multiplayer)
        await core.userProfile.setLastMultiGame(gameRoom.id)
    },

    async onReceiveLaunchGame(message: AblyLaunchGameMessage) {
        const { gameStateId } = message
        const serializedGame = await fetchGameState(gameStateId)
        await receiveLaunchGame(serializedGame)
    },

    async broadcastGameMutation(message: GameMutationMessage) {
        await ablyPublish(getRoomChannel(), MultiplayerMessageType.GameMutation, message)
    },

    requestResyncGameState,
}
