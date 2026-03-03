import {
    GameMutationMessage,
    MultiplayerMessageType,
    RoomId,
    ScsLaunchGameMessage,
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
