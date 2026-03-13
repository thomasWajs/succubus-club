import {
    GameMutationMessage,
    MultiplayerMessageType,
    RoomId,
    ScsLaunchGameMessage,
    ScsShuffleCardRegionMessage,
    VersioningTarget,
} from '@/shared/types/multiplayer.ts'
import { Key } from '@/client/multiplayer/encryption.ts'
import { getScsClient, MessageHandler } from '@/client/gateway/realtime.ts'
import ablyCommunication from '@/client/multiplayer/communication/ably.ts'
import {
    ensureGameRoom,
    receiveGameMutation,
    receiveLaunchGame,
} from '@/client/multiplayer/room.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { Communication } from '@/client/multiplayer/communication/index.ts'
import { AnyCardRegion } from '@/shared/types/model.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { ensureClock } from '@/client/multiplayer/sync.ts'
import { useCoreStore } from '@/client/store/core.ts'

interface ScsCommunication extends Communication {
    setUser(): void
}

/**
 * Implementation of Communication through SCS
 */

let currentRoomId: RoomId | null = null

export const scsCommunication: ScsCommunication = {
    setUser() {
        const multiplayer = useMultiplayerStore()

        getScsClient().send({
            type: MultiplayerMessageType.SetUser,
            permId: multiplayer.selfUser.permId,
            name: multiplayer.selfUser.name,
            deckList: multiplayer.selfUser.deckList,
            isReady: multiplayer.selfUser.isReady,
        })
    },

    async joinRoom(roomId: RoomId, key?: Key) {
        getScsClient().send({
            type: MultiplayerMessageType.JoinRoom,
            roomId,
            passwordHash: key?.hash ?? '',
        })
        currentRoomId = roomId
    },

    async leaveRoom() {
        getScsClient().send({ type: MultiplayerMessageType.LeaveRoom })
        currentRoomId = null
    },

    isInRoom() {
        return currentRoomId !== null
    },

    async subscribe<T>(messageType: MultiplayerMessageType, handler: MessageHandler<T>) {
        const scs = getScsClient()
        scs.on(messageType, handler)
    },

    rollSeating() {
        // getScsClient().send({ type: MultiplayerMessageType.RollSeating })
        ablyCommunication.rollSeating()
    },

    async launchGame() {
        const gameRoom = ensureGameRoom()
        if (!gameRoom.seating) {
            throw new Error('Seating is not ready')
        }

        getScsClient().send({
            type: MultiplayerMessageType.SetupGame,
            seating: gameRoom.seating,
        })
        gameRoom.isStarted = true
    },

    async onReceiveLaunchGame(message: ScsLaunchGameMessage) {
        await receiveLaunchGame(message.serializedGame)
    },

    async broadcastGameMutation(message: GameMutationMessage) {
        getScsClient().send({
            type: MultiplayerMessageType.GameMutation,
            ...message,
        })
    },

    async onReceiveGameMutation(message: GameMutationMessage) {
        await receiveGameMutation(message)
    },

    async requestResyncGameState() {
        getScsClient().send({ type: MultiplayerMessageType.RequestResync })
    },
}

/**
 * Send shuffle request to server
 */
export async function sendShuffleRequest(cardRegion: AnyCardRegion) {
    const core = useCoreStore()
    const gameState = useGameStateStore()
    const multiplayer = useMultiplayerStore()

    if (!gameState.selfPlayer) {
        throw new Error('Cannot shuffle without a self player defined')
    }

    const versioningId = `${VersioningTarget.Shuffle}-${cardRegion.oid}`
    const clock = ensureClock(versioningId)
    const version = clock.version
    version[core.userProfile.permanentId] = clock.get(core.userProfile.permanentId) + 1
    const message: ScsShuffleCardRegionMessage = {
        type: MultiplayerMessageType.ShuffleCardRegion,
        cardRegionOid: cardRegion.oid,
        globalVersion: multiplayer.globalClock,
        version,
    }
    getScsClient().send(message)
}
