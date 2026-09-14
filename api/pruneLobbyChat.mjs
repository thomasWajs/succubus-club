import {
    get as rtdbGet,
    getDatabase,
    ref as rtdbRef,
    remove as rtdbRemove,
} from 'firebase/database'
import { firebaseApp } from './firebaseConfig.mjs'

const LOBBY_CHAT_KEY = 'lobbyChat'
const RETENTION_MS = 120 * 24 * 60 * 60 * 1000 // 120 days

const rtdb = getDatabase(firebaseApp)
const lobbyChatRef = rtdbRef(rtdb, LOBBY_CHAT_KEY)

export async function GET(request) {
    const authHeader = request.headers.get('authorization')

    if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return Response.json({ success: false }, { status: 401 })
    }

    const snapshot = await rtdbGet(lobbyChatRef)
    const channels = snapshot.val()

    if (!channels) {
        return Response.json({ success: true, removed: 0 }, { status: 200 })
    }

    const cutoff = Date.now() - RETENTION_MS
    let removed = 0

    for (const [languageCode, messages] of Object.entries(channels)) {
        for (const [messageId, message] of Object.entries(messages ?? {})) {
            if (typeof message?.ts === 'number' && message.ts < cutoff) {
                await rtdbRemove(rtdbRef(rtdb, `${LOBBY_CHAT_KEY}/${languageCode}/${messageId}`))
                removed++
            }
        }
    }

    return Response.json({ success: true, removed }, { status: 200 })
}
