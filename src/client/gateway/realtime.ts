import { ArrayQueue, LinearBackoff, Websocket, WebsocketBuilder } from 'websocket-ts'
import Ably, { InboundMessage, RealtimeChannel } from 'ably'
import Objects from 'ably/objects'
import { FirebaseApp, initializeApp } from 'firebase/app'
import {
    Bytes as fsBytes,
    collection as fsCollection,
    deleteDoc as fsDeleteDoc,
    doc as fsDoc,
    Firestore,
    getDoc as fsGetDoc,
    getFirestore as _getFirestore,
    onSnapshot as fsOnSnapshot,
    setDoc as fsSetDoc,
    Timestamp as fsTimestamp,
} from 'firebase/firestore'
import {
    Database,
    DataSnapshot,
    get as rtdbGet,
    getDatabase,
    onValue as rtdbOnValue,
    ref as rtdbRef,
    remove as rtdbRemove,
    set as rtdbSet,
} from 'firebase/database'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import {
    AblyMessage,
    MultiplayerMessageType,
    ScsClientMessage,
    ScsServerMessage,
    ScsStatus,
} from '@/shared/types/multiplayer.ts'
import * as logging from '@/client/logging.ts'
import { useBusStore } from '@/client/store/bus.ts'

export function simulateNetworkDelay(time: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, time))
}

export type MessageHandler<T = ScsServerMessage> = (data: T) => void | Promise<void>

/**
 * SCS : Succubus Club Server
 */

const SCS_URL = import.meta.env.VITE_SCS_URL

export class ScsClient {
    private ws: Websocket
    private openHandler: VoidFunction | null = null
    private closeHandler: VoidFunction | null = null
    private messageHandlers = new Map<MultiplayerMessageType, Set<MessageHandler>>()

    public connect() {
        const multiplayer = useMultiplayerStore()
        multiplayer.scsStatus = ScsStatus.Connecting
        this.ws = new WebsocketBuilder(SCS_URL)
            .withBackoff(new LinearBackoff(0, 2000, 30000))
            .withBuffer(new ArrayQueue())
            .onOpen(() => {
                multiplayer.scsStatus = ScsStatus.Connected
                this.openHandler?.()
            })
            .onClose(() => {
                multiplayer.scsStatus = ScsStatus.Disconnected
                this.closeHandler?.()
            })
            .onMessage((_ws, event) => {
                try {
                    const message: ScsServerMessage = JSON.parse(event.data as string)
                    this.handleMessage(message)
                } catch (error) {
                    logging.captureMessage(`Failed to parse message: ${error}`, 'error')
                }
            })
            .onError((_ws, event) => {
                logging.captureMessage(`${event}`)
            })
            .build()
    }

    private handleMessage(message: ScsServerMessage) {
        const type = message.type
        if (typeof type !== 'string' || !this.messageHandlers.has(type)) return

        this.messageHandlers.get(type)?.forEach(handler => {
            // Capture all errors on receivers
            try {
                handler(message)
            } catch (error) {
                logging.captureException(error)
            }
        })
    }

    send(message: ScsClientMessage) {
        // Capture all errors on senders
        try {
            this.ws.send(JSON.stringify(message))
        } catch (e) {
            const bus = useBusStore()
            logging.captureException(e)
            bus.alertWarning('Experiencing connection issues')
        }
    }

    onOpen(openHandler: VoidFunction) {
        this.openHandler = openHandler
    }

    onClose(closeHandler: VoidFunction) {
        this.closeHandler = closeHandler
    }

    on<T = unknown>(type: MultiplayerMessageType, handler: MessageHandler<T>) {
        if (!this.messageHandlers.has(type)) {
            this.messageHandlers.set(type, new Set())
        }
        this.messageHandlers.get(type)?.add(handler as MessageHandler)
    }

    disconnect() {
        this.ws.close()
        this.messageHandlers.clear()
    }
}

let scsClient: ScsClient | null = null

export function getScsClient() {
    if (!scsClient) {
        scsClient = new ScsClient()
    }
    return scsClient
}

export function releaseScsClient() {
    if (scsClient) {
        scsClient.disconnect()
    }
    scsClient = null
}

/**
 * Ably
 */

const ABRUPT_DISCONNECTION_DELAY = 5 * 1000 // 5 seconds

let ably: Ably.Realtime | null = null

export function getAbly(): Ably.Realtime {
    if (!ably) {
        const multiplayer = useMultiplayerStore()

        const ablyConfig: Record<string, unknown> = {
            clientId: multiplayer.selfUser.permId,
            echoMessages: false,
            plugins: { Objects },
            transportParams: {
                remainPresentFor: ABRUPT_DISCONNECTION_DELAY,
            },
        }
        if (import.meta.env.DEV) {
            ablyConfig.key = import.meta.env.VITE_ABLY_API_KEY
        } else {
            ablyConfig.authUrl = '/api/ablyAuth'
            ablyConfig.authMethod = 'POST'
            ablyConfig.authHeaders = { clientId: multiplayer.selfUser.permId }
        }
        ably = new Ably.Realtime(ablyConfig)
    }
    return ably
}

export async function ablySubscribe<T>(
    channel: RealtimeChannel,
    messageType: MultiplayerMessageType,
    messageHandler: MessageHandler<T>,
) {
    await channel.subscribe(messageType, async (message: InboundMessage) => {
        // Capture all errors on receivers
        try {
            await messageHandler(message.data as T)
        } catch (e) {
            logging.captureException(e)
        }
    })
}

export async function ablyPublish(
    channel: RealtimeChannel,
    messageType: MultiplayerMessageType,
    message: AblyMessage,
) {
    /*
        if (messageType == PubsubMessageType.GameMutation) {
            await simulateNetworkDelay(useGameStateStore().centralPlayerSeatingIndex * 1500)
        }
     */

    // Capture all errors on senders
    try {
        await channel.publish(messageType, message)
    } catch (e) {
        const bus = useBusStore()
        logging.captureException(e)
        bus.alertWarning('Experiencing connection issues')
    }
}

export async function detachChannel(channel: Ably.RealtimeChannel) {
    try {
        await channel.detach()
    } catch (error) {
        if (error instanceof Error && error.message !== 'Connection closed') {
            logging.captureException(error)
        }
    }
}

/**
 * Firebase
 */

let firebase: FirebaseApp | null = null
let rtdb: Database | null = null
let firestore: Firestore | null = null

export function getFirebase(): FirebaseApp {
    if (!firebase) {
        firebase = initializeApp({
            apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
            authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
            databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
            projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
            storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
            messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
            appId: import.meta.env.VITE_FIREBASE_APP_ID,
        })
    }
    return firebase
}

// In firebase terminology, RTDB stands for "Real-Time Database"
export function getRtdb() {
    if (!rtdb) {
        rtdb = getDatabase(getFirebase())
    }
    return rtdb
}

export function getFirestore() {
    if (!firestore) {
        firestore = _getFirestore(getFirebase())
    }
    return firestore
}

// Make aliases to avoid name collision with vue ref
export { DataSnapshot, rtdbRef, rtdbGet, rtdbSet, rtdbRemove, rtdbOnValue }
export { fsCollection, fsDoc, fsSetDoc, fsGetDoc, fsDeleteDoc, fsOnSnapshot, fsBytes, fsTimestamp }
