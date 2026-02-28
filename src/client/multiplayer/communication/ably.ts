import { GameRoom, PubsubMessageType, RoomId } from '@/shared/types/multiplayer.ts'
import { Key } from '@/client/multiplayer/encryption.ts'
import { ablyPublish, detachChannel, getAbly } from '@/client/gateway/realtime.ts'
import Ably, { ChannelOptions } from 'ably'
import { ensureGameRoom } from '@/client/multiplayer/room.ts'
import { shuffleArray } from '@/shared/utils.ts'
import { Communication } from '@/client/multiplayer/communication/index.ts'
import { GameType } from '@/shared/types/state.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { storeGameState } from '@/client/gateway/gameState.ts'
import { serializeMultiplayerGame } from '@/client/gateway/serialization.ts'
import { setupMultiplayerGame, startGame } from '@/client/game/setup.ts'

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
 * Implementation of Communication through Ably
 */

export const ablyCommunication: Communication = {
    joinRoom: initRoom,
    leaveRoom: disconnectRoom,
    isInRoom,

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
        await ablyPublish(roomChannel, PubsubMessageType.LaunchGame, gameStateId)
        gameRoom.isStarted = true
        startGame(GameType.Multiplayer)
        await core.userProfile.setLastMultiGame(gameRoom.id)
    },
    onReceiveLaunchGame() {},

    sendGameMutation() {},
    onReceiveGameMutation() {},

    requestResyncGameState() {},
    onReceiveResyncGameState() {},
}
