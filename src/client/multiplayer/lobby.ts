import { watch, WatchHandle } from 'vue'
import {
    DataSnapshot,
    detachAndReleaseChannel,
    getAbly,
    getRtdb,
    getScsClient,
    releaseScsClient,
    rtdbGet,
    rtdbOnValue,
    rtdbRef,
    rtdbRemove,
    rtdbSet,
} from '@/client/gateway/realtime.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import * as logging from '@/client/logging.ts'
import { useBusStore } from '@/client/store/bus.ts'
import { CommunicationMode, GameRoom, RoomId, ScsStatus } from '@/shared/types/multiplayer.ts'
import { getCommunication, joinGameRoom, leaveGameRoom } from '@/client/multiplayer/room.ts'
import { computeKey } from '@/client/multiplayer/encryption.ts'
import { scsCommunication } from '@/client/multiplayer/communication/scs.ts'
import { generateRoomId } from '@/shared/state/ids.ts'
import { DbSavedGame } from '@/client/gateway/db.ts'

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

    const scsClient = getScsClient()
    scsClient.onOpen(scsCommunication.announce)
    scsClient.onClose(scsCommunication.handleDisconnect)
    scsClient.connect()

    return {
        multiplayer: useMultiplayerStore(),
        rtdb,
        ably,
        scsClient,
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

    try {
        const { rtdb, lobbyChannel } = await useLobby()
        if (lobbyChannel.state != 'attached') {
            return
        }

        // Presence / Users
        await lobbyChannel.presence.enter(multiplayer.selfUser)
        await syncUsers()
        await lobbyChannel.presence.subscribe(syncUsers)

        // Game room list
        rtdbOnValue(rtdbRef(rtdb, GAME_ROOMS_KEY), syncGameRooms)

        if (import.meta.env.DEV) {
            await pruneAblyChannels()
        }
    } catch (e) {
        logging.captureException(e)
        bus.alertError('Error joining lobby. Please try again')
        return
    }

    await setupSelfUserWatcher()
    await setupSelfDeckWatcher()
}

export async function leaveLobby() {
    if (!_lobby) {
        return
    }

    const { lobbyChannel } = await _lobby

    unwatchSelfUser?.()
    unwatchSelfUser = null
    unwatchSelfDeck?.()
    unwatchSelfDeck = null

    // Releasing from the channel will also unsubscribe all listeners
    // Detaching from the channel will also leave the presence
    await detachAndReleaseChannel(lobbyChannel)

    _lobby = null

    // Disconnect websocket to SCS
    releaseScsClient()
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

async function syncGameRooms(snapshot: DataSnapshot) {
    const { multiplayer } = await useLobby()
    const storedGameRooms = snapshot.val() as Record<RoomId, GameRoom> | null
    const gameRooms: Record<RoomId, GameRoom> = {}

    for (const [roomId, gameRoom] of Object.entries(storedGameRooms ?? {})) {
        // rtdb removes empty arrays, which breaks typescript assumptions, which sucks
        gameRoom.players ??= []
        gameRoom.competingPlayers ??= []
        gameRoom.spectators ??= []
        gameRoom.judges ??= []

        gameRooms[roomId] = gameRoom
    }

    multiplayer.gameRooms = gameRooms
}

export async function createGameRoom(
    roomName: string,
    password: string = '',
    communication: CommunicationMode = CommunicationMode.Ably,
    enableAids: boolean = true,
    allowSpectators: boolean = true,
    savedGame?: DbSavedGame,
) {
    const { multiplayer } = await useLobby()

    if (multiplayer.gameRoomNames.includes(roomName) || roomName == LOBBY_CHANNEL_NAME) {
        const bus = useBusStore()
        bus.alertError('A game room with this name already exists.')
        return
    }

    if (communication == CommunicationMode.SCS && multiplayer.scsStatus == ScsStatus.Disconnected) {
        const bus = useBusStore()
        bus.alertError('SCS is offline. You can use Direct Connection.')
        return
    }

    let key
    if (password) {
        multiplayer.password = password
        key = await computeKey(password)
    }

    const gameRoom: GameRoom = {
        id: savedGame ? savedGame.roomId : generateRoomId(),
        name: roomName,
        hostId: multiplayer.selfUser.permId,
        communication,
        isStarted: false,
        isSavedGame: !!savedGame,
        hasPassword: password != '',
        passwordHash: key?.hash ?? '',
        enableAids,
        allowSpectators,
        players: [multiplayer.selfUser.permId],
        competingPlayers: savedGame ? savedGame.competingPlayers : [],
        spectators: [],
        judges: [],
    }
    // Don't try to coalesce inline with 'seating: savedGame?.seating',
    // as firebase refuse to receive undefined properties
    if (savedGame?.seating) {
        gameRoom.seating = savedGame.seating
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

// This is only for dev, because Vercel ain't here to prune the channels
async function pruneAblyChannels() {
    const { ably } = await useLobby()
    const rtdb = getRtdb()
    const snapshot = await rtdbGet(rtdbRef(rtdb, GAME_ROOMS_KEY))
    const storedGameRooms = snapshot.val() as Record<RoomId, GameRoom> | null

    let activeChannels = []
    // @ts-expect-error - Ably request method type compatibility
    const channelsResponse = await ably.request('GET', '/channels', { by: 'value' })
    activeChannels = channelsResponse.items
        .filter(channel => channel.status?.occupancy?.metrics?.connections ?? 0 > 0)
        .map(channel => channel.name)

    for (const roomId of Object.keys(storedGameRooms ?? {})) {
        if (!activeChannels.includes(roomId)) {
            await deleteGameRoom(roomId)
        }
    }
}
