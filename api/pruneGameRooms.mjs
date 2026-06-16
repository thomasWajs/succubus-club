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

export async function POST(request) {
    const authHeader = request.headers.get('authorization')

    if (!process.env.ABLY_SECRET || authHeader !== `Bearer ${process.env.ABLY_SECRET}`) {
        return Response.json({ success: false }, { status: 401 })
    }

    const snapshot = await rtdbGet(gameRoomsRef)
    const storedGameRooms = snapshot.val()

    if (!storedGameRooms || storedGameRooms.empty) {
        return Response.json({ success: true }, { status: 200 })
    }

    const ably = new Ably.Rest({ key: ABLY_API_KEY })
    let activeChannels = []

    const channelsResponse = await ably.request('GET', '/channels', { by: 'value' })
    activeChannels = channelsResponse.items
        .filter(channel => channel.status?.occupancy?.metrics?.connections ?? 0 > 0)
        .map(channel => channel.name)

    for (const roomId of Object.keys(storedGameRooms)) {
        if (!activeChannels.includes(roomId)) {
            await rtdbRemove(rtdbRef(rtdb, `${GAME_ROOMS_KEY}/${roomId}`))
        }
    }

    return Response.json({ success: true }, { status: 200 })
}
