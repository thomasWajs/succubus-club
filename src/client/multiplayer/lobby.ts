import { watch, WatchHandle } from 'vue'
import {
    DataSnapshot,
    detachChannel,
    getAbly,
    getRtdb,
    rtdbOnValue,
    rtdbRef,
    rtdbRemove,
    rtdbSet,
} from '@/client/gateway/realtime.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import * as logging from '@/client/logging.ts'
import { useBusStore } from '@/client/store/bus.ts'
import { CommunicationMode, GameRoom, RoomId, Seating } from '@/shared/types/multiplayer.ts'
import { getCommunication, joinGameRoom, leaveGameRoom } from '@/client/multiplayer/room.ts'
import { computeKey } from '@/client/multiplayer/encryption.ts'
import { scsCommunication } from '@/client/multiplayer/communication/scs.ts'
import { hash } from '@/shared/serialization.ts'

let LOBBY_CHANNEL_NAME = 'Lobby'
const GAME_ROOMS_KEY = 'gameRooms'
const DEBOUNCE_DELAY = 500 // milliseconds

if (import.meta.env.DEV) {
    LOBBY_CHANNEL_NAME = `{dev} ${LOBBY_CHANNEL_NAME}`
}

let unwatchSelfUser: WatchHandle | null = null
let unwatchSelfDeck: WatchHandle | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

let _lobby: ReturnType<typeof connectLobby> | null = null

async function connectLobby() {
    const rtdb = getRtdb()

    const ably = getAbly()
    const lobbyChannel = ably.channels.get(LOBBY_CHANNEL_NAME)
    await lobbyChannel.attach()

    return {
        multiplayer: useMultiplayerStore(),
        rtdb,
        ably,
        lobbyChannel,
    }
}
async function useLobby() {
    if (!_lobby) {
        _lobby = connectLobby()
    }
    return await _lobby
}

export async function joinLobby() {
    const bus = useBusStore()
    const multiplayer = useMultiplayerStore()

    if (multiplayer.hasJoinedLobby) {
        return
    }

    multiplayer.upsertUser(multiplayer.selfUser)
    if (multiplayer.selfDeck) {
        multiplayer.userDecks[multiplayer.selfUser.permId] = multiplayer.selfDeck
    }

    const { rtdb, lobbyChannel } = await useLobby()
    try {
        if (lobbyChannel.state != 'attached') {
            return
        }

        // Presence / Users
        await lobbyChannel.presence.enter(multiplayer.selfUser)
        await syncUsers()
        await lobbyChannel.presence.subscribe(syncUsers)

        scsCommunication.setUser()

        // Game room list
        rtdbOnValue(rtdbRef(rtdb, GAME_ROOMS_KEY), syncGameRooms)
    } catch (e) {
        logging.captureException(e)
        bus.alertError('Error joining lobby. Please try again')
        return
    }

    await setupSelfUserWatcher()
    await setupSelfDeckWatcher()
}

export async function leaveLobby() {
    const { ably, lobbyChannel } = await useLobby()

    unwatchSelfUser?.()
    unwatchSelfUser = null
    unwatchSelfDeck?.()
    unwatchSelfDeck = null

    // Detaching from the channel will also leave the presence
    await detachChannel(lobbyChannel)
    // Releasing from the channel will also unsubscribe all listeners
    ably.channels.release(LOBBY_CHANNEL_NAME)
    _lobby = null
}

export async function leaveMultiplayer() {
    const multiplayer = useMultiplayerStore()
    if (multiplayer.currentGameRoomId) {
        await leaveGameRoom()
    }
    await leaveLobby()
    multiplayer.$reset()
}

/**
 * Presence / Users
 */

async function syncUsers() {
    const { multiplayer, lobbyChannel } = await useLobby()

    if (lobbyChannel.state != 'attached') {
        return
    }

    const presenceSet = await lobbyChannel.presence.get()
    multiplayer.users = {}
    // Loop to call upsertUser to fetch their avatar
    for (const member of presenceSet) {
        multiplayer.upsertUser(member.data)
    }
}

async function setupSelfUserWatcher() {
    // Watcher is already active, do nothing.
    if (unwatchSelfUser) {
        return
    }

    const { multiplayer, lobbyChannel } = await useLobby()

    // Watch for changes to selfUser and broadcast when it updates
    // Use a debounce timer to prevent sending a burst of updates on e.g. username edit
    unwatchSelfUser = watch(
        () => multiplayer.selfUser,
        selfUser => {
            if (debounceTimer) {
                clearTimeout(debounceTimer)
            }

            // Override the user in the list from ably
            multiplayer.upsertUser(multiplayer.selfUser)

            debounceTimer = setTimeout(() => {
                scsCommunication.setUser()

                if (lobbyChannel.state == 'attached') {
                    lobbyChannel.presence.update(selfUser)
                }
                debounceTimer = null
            }, DEBOUNCE_DELAY)
        },
    )
}

async function setupSelfDeckWatcher() {
    // Watcher is already active, do nothing.
    if (unwatchSelfDeck) {
        return
    }

    const { multiplayer } = await useLobby()

    // Watch for changes to selfUser and broadcast when it updates
    // Use a debounce timer to prevent sending a burst of updates on e.g. username edit
    unwatchSelfDeck = watch(
        () => multiplayer.selfDeck,
        selfDeck => {
            if (!selfDeck) {
                return
            }
            multiplayer.userDecks[multiplayer.selfUser.permId] = selfDeck
            const gameRoom = multiplayer.currentGameRoom
            if (!gameRoom) {
                return
            }
            const comm = getCommunication(gameRoom)
            comm.sendDeck()
        },
    )
}

/**
 * Game room list
 */

function gameRoomRef(roomId: RoomId) {
    return rtdbRef(getRtdb(), `${GAME_ROOMS_KEY}/${roomId}`)
}

let pruneChannels = true
async function syncGameRooms(snapshot: DataSnapshot) {
    const { multiplayer, ably } = await useLobby()
    const storedGameRooms = snapshot.val() as Record<RoomId, GameRoom> | null
    const gameRooms: Record<RoomId, GameRoom> = {}

    if (storedGameRooms) {
        // TODO : replace pruneChannels by a webhook to Vercel to clean on presence leave
        let activeChannels = []
        if (pruneChannels) {
            // @ts-expect-error - Ably request method type compatibility
            const channelsResponse = await ably.request('GET', '/channels', { by: 'value' })
            activeChannels = channelsResponse.items
                .filter(channel => channel.status?.occupancy?.metrics?.connections ?? 0 > 0)
                .map(channel => channel.name)
        }

        for (const [roomId, gameRoom] of Object.entries(storedGameRooms)) {
            if (pruneChannels && !activeChannels.includes(roomId)) {
                await deleteGameRoom(roomId)
            } else {
                // rtdb removes empty arrays, which breaks typescript assumptions, which sucks
                if (!gameRoom.spectators) {
                    gameRoom.spectators = []
                }
                gameRooms[roomId] = gameRoom
            }
        }
    }

    multiplayer.gameRooms = gameRooms
    pruneChannels = false
}

export async function createGameRoom(
    roomName: string,
    password: string = '',
    communication: CommunicationMode,
    enableAids: boolean = true,
    allowSpectators: boolean = true,
    seating: Seating = [],
    isStarted: boolean = false,
) {
    const { multiplayer } = await useLobby()

    if (multiplayer.gameRoomNames.includes(roomName) || roomName == LOBBY_CHANNEL_NAME) {
        const bus = useBusStore()
        bus.alertError('A game room with this name already exists.')
        return
    }

    let key
    if (password) {
        multiplayer.password = password
        key = await computeKey(password)
    }

    const gameRoom = {
        id: hash(roomName).toString(),
        name: roomName,
        hostId: multiplayer.selfUser.permId,
        communication,
        isStarted,
        hasPassword: password != '',
        passwordHash: key?.hash ?? '',
        enableAids,
        allowSpectators,
        players: [multiplayer.selfUser.permId],
        seating,
        spectators: [],
    }
    multiplayer.upsertGameRoom(gameRoom)
    await joinGameRoom(gameRoom, key)
    await broadcastGameRoom(gameRoom)
}

export async function broadcastGameRoom(gameRoom: GameRoom) {
    rtdbSet(gameRoomRef(gameRoom.id), gameRoom)
}

export async function deleteGameRoom(roomId: RoomId) {
    rtdbRemove(gameRoomRef(roomId))
}
