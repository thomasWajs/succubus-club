import {
    ensureAnonymousAuth,
    getRtdb,
    rtdbLimitToLast,
    rtdbOnChildAdded,
    rtdbPush,
    rtdbQuery,
    rtdbRef,
    rtdbServerTimestamp,
    rtdbUpdate,
} from '@/client/gateway/realtime.ts'
import * as logging from '@/client/logging.ts'

// One append-only channel per official language, keyed by language code.
const LOBBY_CHAT_KEY = 'lobbyChat'
const CHAT_COOLDOWN_KEY = 'chatCooldown'

// Keep the payload within the RTDB security-rule limits.
export const CHAT_MAX_LENGTH = 500
const CHAT_MAX_NAME_LENGTH = 60

// How many past messages to load when opening a channel.
const HISTORY_LIMIT = 200

// Minimum gap between two sends from this client. Mirrors ( and stays above ) the
// per-uid cooldown enforced by the security rules, so honest users are throttled in
// the UI and never hit a rule rejection.
export const CHAT_SEND_COOLDOWN_MS = 2000

// The shape the LobbyChat component consumes.
export interface LobbyChatMessage {
    authorName: string
    text: string
    timestamp: Date
}

// The shape stored in RTDB. `authorUid` is the anonymous-auth uid ( validated
// server-side against auth.uid ) ; `ts` is a server timestamp.
interface StoredChatMessage {
    text: string
    name: string
    authorUid: string
    ts: number
}

function chatPath(languageCode: string) {
    return `${LOBBY_CHAT_KEY}/${languageCode}`
}

// Subscribe to a language channel. `onChildAdded` replays the last HISTORY_LIMIT
// messages in chronological order, then fires once per new message : exactly the
// append-only feed we want. Returns an unsubscribe function.
export function subscribeLobbyChat(
    languageCode: string,
    onMessage: (message: LobbyChatMessage) => void,
): () => void {
    const channelQuery = rtdbQuery(
        rtdbRef(getRtdb(), chatPath(languageCode)),
        rtdbLimitToLast(HISTORY_LIMIT),
    )
    return rtdbOnChildAdded(channelQuery, snapshot => {
        const stored = snapshot.val() as StoredChatMessage | null
        if (!stored || typeof stored.text !== 'string' || typeof stored.name !== 'string') {
            return
        }
        onMessage({ authorName: stored.name, text: stored.text, timestamp: new Date(stored.ts) })
    })
}

let lastSentAt = 0

// Send a message to a language channel. Writes the message and the per-uid cooldown
// marker in a single atomic multi-path update : the security rule rejects the whole
// update if the cooldown has not elapsed, so a spamming client can't outrun it.
export async function sendLobbyChat(languageCode: string, name: string, rawText: string) {
    const text = rawText.trim().slice(0, CHAT_MAX_LENGTH)
    if (!text) {
        return
    }

    // App-layer throttle : drop accidental rapid double-sends before touching the network.
    const now = Date.now()
    if (now - lastSentAt < CHAT_SEND_COOLDOWN_MS) {
        return
    }

    try {
        const authorUid = await ensureAnonymousAuth()
        const rtdb = getRtdb()

        // Reserve a push id so the message and cooldown marker can be written together.
        const messageRef = rtdbPush(rtdbRef(rtdb, chatPath(languageCode)))
        if (!messageRef.key) {
            return
        }

        const message: Omit<StoredChatMessage, 'ts'> & { ts: object } = {
            text,
            name: name.slice(0, CHAT_MAX_NAME_LENGTH),
            authorUid,
            ts: rtdbServerTimestamp(),
        }

        await rtdbUpdate(rtdbRef(rtdb), {
            [`${chatPath(languageCode)}/${messageRef.key}`]: message,
            [`${CHAT_COOLDOWN_KEY}/${authorUid}`]: rtdbServerTimestamp(),
        })
        lastSentAt = now
    } catch (error) {
        logging.captureException(error)
    }
}

// Kick off the anonymous sign-in ahead of the first send, to hide its latency.
export function warmUpChatAuth() {
    ensureAnonymousAuth().catch(logging.captureException)
}
