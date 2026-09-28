import Ably from 'ably'
import { getDatabase } from 'firebase-admin/database'
import { firebaseAdminApp } from './firebaseConfig.mjs'

const GAME_ROOMS_KEY = 'gameRooms'
const ABLY_API_KEY = process.env.ABLY_API_KEY
const rtdb = getDatabase(firebaseAdminApp)
const gameRoomsRef = rtdb.ref(GAME_ROOMS_KEY)

// A room is written to rtdb before its creator's Ably presence enter resolves (see
// createGameRoom in lobby.ts), so a webhook firing in that window would otherwise see a
// room with nobody in it yet and delete it. Give every room a grace period before it's
// eligible for pruning at all.
const MIN_ROOM_AGE_MS = 30_000

export async function POST(request) {
    const authHeader = request.headers.get('authorization')

    if (!process.env.ABLY_SECRET || authHeader !== `Bearer ${process.env.ABLY_SECRET}`) {
        return Response.json({ success: false }, { status: 401 })
    }

    const snapshot = await gameRoomsRef.once('value')
    const storedGameRooms = snapshot.val()

    if (!storedGameRooms) {
        return Response.json({ success: true }, { status: 200 })
    }

    const ably = new Ably.Rest({ key: ABLY_API_KEY })
    const now = Date.now()

    const channelsResponse = await ably.request('GET', '/channels', { by: 'value' })
    const activeChannels = channelsResponse.items
        .filter(channel => channel.status?.occupancy?.metrics?.connections ?? 0 > 0)
        .map(channel => channel.name)

    for (const [roomId, gameRoom] of Object.entries(storedGameRooms)) {
        // Temporary, for outdated clients
        if (!gameRoom.createdAt) {
            continue
        }

        // Enforce the grace period
        if (typeof gameRoom?.createdAt === 'number' && now - gameRoom.createdAt < MIN_ROOM_AGE_MS) {
            continue
        }

        if (!activeChannels.includes(roomId)) {
            await rtdb.ref(`${GAME_ROOMS_KEY}/${roomId}`).remove()
        }
    }

    // If the occupancy metrics lags too much, use the direct presence length instead :
    /*
    await Promise.all(
        Object.entries(storedGameRooms).map(async ([roomId, gameRoom]) => {
            if (
                typeof gameRoom?.createdAt === 'number' &&
                now - gameRoom.createdAt < MIN_ROOM_AGE_MS
            ) {
                return
            }

            // Occupancy metrics from the channel-enumeration endpoint lag behind actual
            // presence, which is exactly what caused live rooms to be pruned. Ask the
            // channel directly for its current presence set instead.
            // Ably.Rest's presence.get() resolves a PaginatedResult, not a plain array
            // (unlike the Realtime client), so the members are under .items.
            const presenceSet = await ably.channels.get(roomId).presence.get()
            if (presenceSet.items.length === 0) {
                await rtdb.ref(`${GAME_ROOMS_KEY}/${roomId}`).remove()
            }
        }),
    )
     */

    return Response.json({ success: true }, { status: 200 })
}
