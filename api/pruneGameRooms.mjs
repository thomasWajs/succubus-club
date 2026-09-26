import Ably from 'ably'
import {
    get as rtdbGet,
    getDatabase,
    ref as rtdbRef,
    remove as rtdbRemove,
} from 'firebase/database'
import { firebaseApp } from './firebaseConfig.mjs'

const GAME_ROOMS_KEY = 'gameRooms'
const ABLY_API_KEY = process.env.ABLY_API_KEY
const rtdb = getDatabase(firebaseApp)
const gameRoomsRef = rtdbRef(rtdb, GAME_ROOMS_KEY)

// A room is written to rtdb before its creator's Ably presence enter resolves (see
// createGameRoom in lobby.ts), so a webhook firing in that window would otherwise see a
// room with nobody in it yet and delete it. Give every room a grace period before it's
// eligible for pruning at all.
const MIN_ROOM_AGE_MS = 15_000

export async function POST(request) {
    const authHeader = request.headers.get('authorization')

    if (!process.env.ABLY_SECRET || authHeader !== `Bearer ${process.env.ABLY_SECRET}`) {
        return Response.json({ success: false }, { status: 401 })
    }

    const snapshot = await rtdbGet(gameRoomsRef)
    const storedGameRooms = snapshot.val()

    if (!storedGameRooms) {
        return Response.json({ success: true }, { status: 200 })
    }

    const ably = new Ably.Rest({ key: ABLY_API_KEY })
    const now = Date.now()

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
            const presenceSet = await ably.channels.get(roomId).presence.get()
            if (presenceSet.length === 0) {
                await rtdbRemove(rtdbRef(rtdb, `${GAME_ROOMS_KEY}/${roomId}`))
            }
        }),
    )

    return Response.json({ success: true }, { status: 200 })
}
