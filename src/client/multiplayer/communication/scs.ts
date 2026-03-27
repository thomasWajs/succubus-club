import {
    GameMutationMessage,
    MultiplayerMessageType,
    RoomId,
    ScsGameStateMessage,
    ScsLaunchGameMessage,
    ScsShuffleCardRegionMessage,
    VersioningTarget,
} from '@/shared/types/multiplayer.ts'
import { Key } from '@/client/multiplayer/encryption.ts'
import { getScsClient, MessageHandler } from '@/client/gateway/realtime.ts'
import { ensureGameRoom, receiveLaunchGame } from '@/client/multiplayer/room.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { Communication } from '@/client/multiplayer/communication/index.ts'
import { AnyCardRegion } from '@/shared/types/model.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { applyGameResync, ensureClock } from '@/client/multiplayer/sync.ts'
import { useCoreStore } from '@/client/store/core.ts'

interface ScsCommunication extends Communication {
    announce(): void
    setUser(): void
}

/**
 * SCS Game Sync
 */

export async function onReceiveGameSync(message: ScsGameStateMessage) {
    const gameRoom = ensureGameRoom()
    // Cannot receive sync state if the game is not started
    if (!gameRoom.isStarted) {
        return
    }
    await applyGameResync(message)
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

/**
 * Implementation of Communication through SCS
 */

let currentRoomId: RoomId | null = null
let currentKey: Key | undefined = undefined

export const scsCommunication: ScsCommunication = {
    // Send our identity to the server
    announce() {
        scsCommunication.setUser()

        // When reconnecting to the server after an unexpected disconnect
        if (currentRoomId) {
            scsCommunication.joinRoom(currentRoomId, currentKey)
        }
    },

    setUser() {
        const multiplayer = useMultiplayerStore()

        getScsClient().send({
            type: MultiplayerMessageType.SetUser,
            permId: multiplayer.selfUser.permId,
            name: multiplayer.selfUser.name,
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
        currentKey = key
    },

    async leaveRoom() {
        getScsClient().send({ type: MultiplayerMessageType.LeaveRoom })
        currentRoomId = null
    },

    isInRoom() {
        return currentRoomId !== null
    },

    async subscribe<T>(messageType: MultiplayerMessageType, handler: MessageHandler<T>) {
        getScsClient().on(messageType, handler)
    },

    async sendDeck() {
        const multiplayer = useMultiplayerStore()
        if (!multiplayer.selfDeck) {
            return
        }
        getScsClient().send({
            type: MultiplayerMessageType.Deck,
            permId: multiplayer.selfUser.permId,
            deckList: multiplayer.selfDeck,
        })
    },

    rollSeating() {
        getScsClient().send({ type: MultiplayerMessageType.RollSeating })
    },

    async launchGame() {
        const gameRoom = ensureGameRoom()
        if (!gameRoom.seating) {
            throw new Error('Seating is not ready')
        }

        getScsClient().send({
            type: MultiplayerMessageType.SetupGame,
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

    async requestResyncGameState() {
        getScsClient().send({ type: MultiplayerMessageType.RequestResync })
    },
}
