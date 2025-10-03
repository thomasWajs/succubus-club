import { ActionReceiver, ActionSender, DataPayload, JsonValue, TargetPeers, Room } from 'trystero'
import { joinRoom as joinRoomFirebase } from 'trystero/firebase'
import { joinRoom as joinRoomMqtt } from 'trystero/mqtt'
import * as logging from '@/logging.ts'
import { DeckList } from '@/gateway/deck.ts'
import { useMultiplayerStore } from '@/store/multiplayer.ts'
import { useBusStore } from '@/store/bus.ts'
import { SerializedGame, SerializedGameMutation } from '@/gateway/serialization.ts'
import { GameMutationId } from '@/state/gameMutations.ts'

/**
 * Trystero Config
 */

const FIREBASE_DB_URL = 'https://succubus-club-default-rtdb.europe-west1.firebasedatabase.app/'

let appId, joinRoom: typeof joinRoomFirebase | typeof joinRoomMqtt
if (import.meta.env.DEV) {
    // Unique identifier for our game
    appId = 'vtes-succubus-club-game-dev'
    joinRoom = joinRoomMqtt
} else {
    appId = FIREBASE_DB_URL
    joinRoom = joinRoomFirebase
}

/*
const EXPRESSTURN_USERNAME = '000000002072699693'
const EXPRESSTURN_PASSWORD = 'qnJ5NgcEtteZMI+uSUOA7/hbCco='
 */

const OPEN_RELAY_USERNAME = 'af2a7571eb916d0bba303c04'
const OPEN_RELAY_PASSWORD = '05yKxOvj0OwHqmbn'

export const TRYSTERO_CONFIG = {
    appId,

    rtcConfig: {
        iceServers: [
            {
                urls: 'stun:stun.cloudflare.com:3478',
            },
            {
                urls: 'stun:stun.l.google.com:19302',
            },
            /*
            {
                urls: 'turn:relay1.expressturn.com:3480',
                username: EXPRESSTURN_USERNAME,
                credential: EXPRESSTURN_PASSWORD,
            },
             */
            {
                urls: 'turn:standard.relay.metered.ca:80',
                username: OPEN_RELAY_USERNAME,
                credential: OPEN_RELAY_PASSWORD,
            },
        ],
    },
}

/**
 * Types for user matching
 */

export type PermanentId = string
export type PeerId = string

export type User = {
    permId: PermanentId // The permanentId of the User, not it's trystero peerId
    peerId: PeerId // The trystero peerId
    name: string
    avatar: string | null
    isReady: boolean
    deckList: DeckList | null
}

export type GameRoom = {
    name: string
    hostId: PermanentId
    isStarted: boolean
    hasPassword: boolean
    players: PermanentId[] // permanentId in arbitrary order
    // spectators: PermanentId[] // permanentId in arbitrary order
    seating: PermanentId[] // permanentId in the order of the seating
}

/**
 * Game State Sync
 */

export enum MutationSyncMode {
    Ordered = 'Ordered', // Must apply in order
    Merge = 'Merge', // Always apply all mutations to merge them
    Exclusive = 'Exclusive', // Cannot happen concurrently, only one Player is allowed to do it
}

export type Tick = number

// Versioning with Lamport Clock
export type LamportClockVersion = {
    tick: Tick
    permId: PermanentId
}

// Versioning with Lamport Clock
export type VectorClockVersion = Record<PermanentId, Tick>

// Identify target of mutations that must be synced
export type VersioningId = string

export enum VersioningTarget {
    Turn = 'Turn',
    TurnPhase = 'TurnPhase',
    TheEdge = 'TheEdge',
    Marker = 'Marker',
    Card = 'Card',
    Reveal = 'Reveal',
    Shuffle = 'Shuffle',
    Arrow = 'Arrow',
}

export type GameMutationMessage = {
    gameMutation: SerializedGameMutation
    gameMutationId: GameMutationId
    globalVersion: LamportClockVersion // Always needed
    version?: VectorClockVersion // Only needed for Ordered mutations
}

export type GameStateSyncMessage = {
    serializedGame: SerializedGame
    globalVersion: LamportClockVersion
    objectClocks: Record<VersioningId, VectorClockVersion>
    mutationVersions: Record<GameMutationId, VectorClockVersion>
    hash: number
}

/**
 * Trystero Actions
 */

export function simulateNetworkDelay(time: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, time))
}

type NetActionReceiveHandler<T> = Parameters<ActionReceiver<T>>[0]
type NetAction<T extends DataPayload> = {
    send: ActionSender<T>
    receive: ActionReceiver<T>
}

export function makeNetAction<T extends DataPayload>(
    room: Room,
    actionName: string,
    actionReceiveHandler: NetActionReceiveHandler<T>,
): NetAction<T> {
    const [sendRaw, receive] = room.makeAction<T>(actionName)

    receive((...args) => {
        // Capture all errors on receivers
        try {
            actionReceiveHandler(...args)
        } catch (e) {
            logging.captureException(e)
        }
    })

    const send: ActionSender<T> = async (
        data: T,
        targetPeers?: TargetPeers,
        metadata?: JsonValue,
        progress?: (percent: number, peerId: string) => void,
    ) => {
        /*
        if (actionName == 'b7tMutation') {
            await simulateNetworkDelay(useGameStateStore().selfPlayerSeatingIndex * 1500)
        }
        if (actionName == 'resync') {
            await simulateNetworkDelay(6000)
        }
         */

        // Capture all errors on senders
        try {
            return sendRaw(data, targetPeers, metadata, progress)
        } catch (e) {
            const bus = useBusStore()
            logging.captureException(e)
            bus.alertWarning('Experiencing connection issues')
            return Promise.resolve([])
        }
    }
    return { send, receive }
}

/**
 * Connection / Disconnection
 */

const CONNECTION_ALERT_DELAY = 5 * 1000 // 5 seconds

const last_disconnect_alert = {} as Record<PermanentId, Date>

// https://issues.chromium.org/issues/41378764
// Thanks to https://stackoverflow.com/questions/66546934/how-to-clear-closed-rtcpeerconnection-with-workaround/66546935#66546935
export function garbageCollectRTCConnections() {
    queueMicrotask(() => {
        let img: HTMLImageElement | null = document.createElement('img')
        img.src = window.URL.createObjectURL(new Blob([new ArrayBuffer(5e7)])) // 50Mo
        img.onerror = function () {
            window.URL.revokeObjectURL(this.src)
            img = null
        }
    })
}

function alertDisconnectAfterDelay(user: User) {
    const bus = useBusStore()
    const multiplayer = useMultiplayerStore()

    if (
        multiplayer.currentGameRoom?.isStarted &&
        multiplayer.currentGameRoom.players.includes(user.permId)
    ) {
        setTimeout(() => {
            // Alert only if the user has not reconnected
            if (!multiplayer.users[user.permId]) {
                bus.alertWarning(`${user.name} has left the game.`)
                last_disconnect_alert[user.permId] = new Date()
            }
        }, CONNECTION_ALERT_DELAY)
    }
}

export function alertReconnectAfterDelay(gameRoom: GameRoom, user: User) {
    const bus = useBusStore()
    const multiplayer = useMultiplayerStore()

    // Alert the reconnection if a peer join while :
    // the game is started AND he's seated AND he was disconnected AND we alerted the disconnection,
    if (
        gameRoom.isStarted &&
        gameRoom.seating.includes(user.permId) &&
        !gameRoom.players.includes(user.permId) &&
        last_disconnect_alert[user.permId]
    ) {
        setTimeout(() => {
            // Alert only if the user is still connected
            if (multiplayer.users[user.permId]) {
                bus.alertSuccess(`${user.name} has reconnected into the game room.`)
                delete last_disconnect_alert[user.permId]
            }
        }, CONNECTION_ALERT_DELAY)
    }
}

export function onPeerDisconnect(peerId: PeerId, fromLobby: boolean) {
    const multiplayer = useMultiplayerStore()

    const user = multiplayer.getUser(peerId)
    if (user) {
        alertDisconnectAfterDelay(user)

        multiplayer.removeGameRoomPlayer(user)

        if (fromLobby) {
            multiplayer.removeUser(user.permId)
        }
    }
}

export { joinRoom }
