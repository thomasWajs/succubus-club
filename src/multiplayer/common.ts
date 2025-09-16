import { ActionReceiver, ActionSender, DataPayload, JsonValue, TargetPeers, Room } from 'trystero'
import { joinRoom as joinRoomFirebase } from 'trystero/firebase'
import { joinRoom as joinRoomMqtt } from 'trystero/mqtt'
import * as logging from '@/logging.ts'
import { DeckList } from '@/gateway/deck.ts'
import { useMultiplayerStore } from '@/store/multiplayer.ts'
import { useBusStore } from '@/store/bus.ts'
import { SerializedGame, SerializedGameMutation } from '@/gateway/serialization.ts'

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
 * Types
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
    LWW = 'LWW', // Last Write Wins
    Merge = 'Merge', // Always apply all mutations to merge them
    Exclusive = 'Exclusive', // Cannot happen concurrently, only one Player is allowed to do it
}

// Versioning with Lamport Clock
export type ClockVersion = {
    tick: number
    permId: PermanentId
}

// Identify target of mutations that must be synced
export type VersionningId = string

export enum VersionningTarget {
    Turn = 'Turn',
    TurnPhase = 'TurnPhase',
    TheEdge = 'TheEdge',
    Flip = 'Flip',
    ChangeLock = 'ChangeLock',
    Marker = 'Marker',
    Move = 'Move',
    Reveal = 'Reveal',
    Shuffle = 'Shuffle',
}

export type GameMutationMessage = {
    gameMutation: SerializedGameMutation
    globalVersion: ClockVersion // Always needed
    version?: ClockVersion // Only needed for LWW mutations
}

export type GameStateSyncMessage = {
    serializedGame: SerializedGame
    globalVersion: ClockVersion
    objectVersions: Record<VersionningId, ClockVersion>
    hash: number
}

/**
 * Trystero Actions
 */

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

    const send: ActionSender<T> = (
        data: T,
        targetPeers?: TargetPeers,
        metadata?: JsonValue,
        progress?: (percent: number, peerId: string) => void,
    ) => {
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

export function onPeerDisconnect(peerId: PeerId, fromLobby: boolean) {
    const multiplayer = useMultiplayerStore()
    const bus = useBusStore()

    const user = multiplayer.getUser(peerId)
    if (user) {
        if (
            multiplayer.currentGameRoom?.isStarted &&
            multiplayer.currentGameRoom.players.includes(user.permId)
        ) {
            bus.alertWarning(`${user.name} has left the game.`)
        }

        multiplayer.removeGameRoomPlayer(user)

        if (fromLobby) {
            multiplayer.removeUser(user.permId)
        }
    }
}

export { joinRoom }
