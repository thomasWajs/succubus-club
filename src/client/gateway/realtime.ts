import { ArrayQueue, ExponentialBackoff, Websocket, WebsocketBuilder } from 'websocket-ts'
import Ably, { InboundMessage, messageCallback, RealtimeChannel } from 'ably'
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
import { PubsubMessageType } from '@/shared/types/multiplayer.ts'
import * as logging from '@/client/logging.ts'
import { useBusStore } from '@/client/store/bus.ts'

export function simulateNetworkDelay(time: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, time))
}

/**
 * SCS : Succubus Club Server
 */

const SCS_URL = import.meta.env.VITE_SCS_URL

type MessageHandler<T = unknown> = (data: T) => void | Promise<void>

export class ScsClient {
    private ws: Websocket
    private listeners = new Map<string, Set<MessageHandler>>()

    constructor(url: string) {
        this.ws = new WebsocketBuilder(url)
            .withBackoff(new ExponentialBackoff(1000, 6))
            .withBuffer(new ArrayQueue())
            .onMessage((_ws, event) => {
                try {
                    const message = JSON.parse(event.data as string) as Record<string, unknown>
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

    private handleMessage(message: Record<string, unknown>) {
        const type = message.type
        if (typeof type !== 'string' || !this.listeners.has(type)) return

        this.listeners.get(type)?.forEach(handler => {
            try {
                handler(message)
            } catch (error) {
                logging.captureMessage(`Error in message handler: ${error}`, 'error')
            }
        })
    }

    send(type: string, data?: Record<string, unknown>) {
        this.ws.send(JSON.stringify({ type, ...data }))
    }

    on<T = unknown>(type: string, handler: MessageHandler<T>) {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, new Set())
        }
        this.listeners.get(type)?.add(handler as MessageHandler)
    }

    disconnect() {
        this.ws.close()
        this.listeners.clear()
    }

    isConnected(): boolean {
        return this.ws.readyState === WebSocket.OPEN
    }
}

let scsClient: ScsClient | null = null

export function getScsClient() {
    if (!scsClient) {
        scsClient = new ScsClient(SCS_URL)
    }
    return scsClient
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
    messageType: PubsubMessageType,
    messageHandler: messageCallback<T>,
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

export async function ablyPublish<T>(
    channel: RealtimeChannel,
    messageType: PubsubMessageType,
    message: T,
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
            apiKey: import.meta.env.FIREBASE_API_KEY,
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
