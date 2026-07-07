import {
    CommunicationMode,
    ErrorMessage,
    GameMutationMessage,
    GameRoom,
    MultiplayerMessageType,
    RoomId,
    ScsGameStateMessage,
    ScsLaunchGameMessage,
    ScsMutationRejectedMessage,
    ScsRandomResultRequestMessage,
    ScsShuffleCardRegionMessage,
    ScsStatus,
    VersioningTarget,
} from '@/shared/types/multiplayer.ts'
import { Key } from '@/client/multiplayer/encryption.ts'
import { getScsClient, MessageHandler } from '@/client/gateway/realtime.ts'
import { ensureGameRoom, receiveLaunchGame } from '@/client/multiplayer/room.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { Communication } from '@/client/multiplayer/communication/index.ts'
import { AnyCardRegion } from '@/shared/types/model.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { applyGameResync, ensureClock, receiveRejectedMutation } from '@/client/multiplayer/sync.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { useBusStore } from '@/client/store/bus.ts'
import { waitUntil } from '@/shared/utils.ts'
import router, { ROUTES } from '@/client/ui/router.ts'

interface ScsCommunication extends Communication {
    announce(): void
    handleDisconnect(): void
    setUser(): void
}

/**
 * SCS Game Sync
 */

export function onReceiveServerError(message: ErrorMessage) {
    useBusStore().alertError(`SCS ${message.message}`)
}

export async function onReceiveMutationRejected(message: ScsMutationRejectedMessage) {
    const gameRoom = ensureGameRoom()
    if (!gameRoom.isStarted) {
        return
    }
    await receiveRejectedMutation(message)
}

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
    const players = usePlayersStore()
    const multiplayer = useMultiplayerStore()

    if (!players.selfPlayer) {
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
 * Send random result request to server (coin flip or d6 roll)
 */
export function sendRandomResultRequest(randomType: 'coin' | 'd6') {
    const multiplayer = useMultiplayerStore()

    const message: ScsRandomResultRequestMessage = {
        type: MultiplayerMessageType.RandomResultRequest,
        randomType,
        globalVersion: multiplayer.globalClock,
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
            scsCommunication.sendDeck()
        }
    },

    handleDisconnect() {
        // If we're still in game and disconnected after 2 seconds, show an alert
        setTimeout(async () => {
            const multiplayer = useMultiplayerStore()
            if (
                multiplayer.scsStatus == ScsStatus.Disconnected &&
                // Show alerts only when currently in a SCS Game
                router.currentRoute.value.name == ROUTES.Game &&
                multiplayer.currentGameRoom?.communication == CommunicationMode.SCS
            ) {
                useBusStore().alertError('Connection lost with SCS. Trying to reconnect...')

                await waitUntil(() => multiplayer.scsStatus == ScsStatus.Connected, 300)
                useBusStore().alertSuccess("Connection with SCS restored. You're back online.")
            }
        }, 2000)
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
        const multiplayer = useMultiplayerStore()
        getScsClient().send({
            type: MultiplayerMessageType.JoinRoom,
            roomId,
            passwordHash: key?.hash ?? '',
            savedGameId: multiplayer.restoringSavedGame?.gameId,
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

    async launchGame(gameRoom: GameRoom) {
        const multiplayer = useMultiplayerStore()
        getScsClient().send({
            type: MultiplayerMessageType.SetupGame,
        })
        gameRoom.isStarted = true
        multiplayer.restoringSavedGame = null
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
