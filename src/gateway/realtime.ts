import Ably, { RealtimeChannel, messageCallback, InboundMessage } from 'ably'
import Objects from 'ably/objects'
import { initializeApp, FirebaseApp } from 'firebase/app'
import {
    Database,
    getDatabase,
    DataSnapshot,
    ref as rtdbRef,
    get as rtdbGet,
    set as rtdbSet,
    remove as rtdbRemove,
    onValue as rtdbOnValue,
} from 'firebase/database'
import { useMultiplayerStore } from '@/store/multiplayer.ts'
import { PubsubMessageType } from '@/multiplayer/types.ts'
import * as logging from '@/logging.ts'
import { useBusStore } from '@/store/bus.ts'

export function simulateNetworkDelay(time: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, time))
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
    await channel.subscribe(messageType, (message: InboundMessage) => {
        // Capture all errors on receivers
        try {
            messageHandler(message.data as T)
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
            await simulateNetworkDelay(useGameStateStore().selfPlayerSeatingIndex * 1500)
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

/**
 * Firebase
 */

let firebase: FirebaseApp | null = null
let rtdb: Database | null = null

export function getFirebase(): FirebaseApp {
    if (!firebase) {
        firebase = initializeApp({
            databaseURL: 'https://succubus-club-default-rtdb.europe-west1.firebasedatabase.app/',
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

// Make aliases to avoid name collision with vue ref
export { DataSnapshot, rtdbRef, rtdbGet, rtdbSet, rtdbRemove, rtdbOnValue }
