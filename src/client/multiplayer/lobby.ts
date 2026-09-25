import { watch, WatchHandle } from 'vue'
import Ably from 'ably'
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
    rtdbUpdate,
} from '@/client/gateway/realtime.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import * as logging from '@/client/logging.ts'
import { useBusStore } from '@/client/store/bus.ts'
import {
    CommunicationMode,
    GameRoom,
    RoomId,
    RoomRole,
    ScsStatus,
} from '@/shared/types/multiplayer.ts'
import { getCommunication, joinGameRoom, leaveGameRoom } from '@/client/multiplayer/room.ts'
import { computeKey } from '@/client/multiplayer/encryption.ts'
import { scsCommunication } from '@/client/multiplayer/communication/scs.ts'
import { generateRoomId } from '@/shared/state/ids.ts'
import { DbSavedGame } from '@/client/gateway/db.ts'

let LOBBY_CHANNEL_NAME = 'Lobby'
export const GAME_ROOMS_KEY = 'gameRooms'
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
        await seedUsers()
        // Consume per-member presence deltas ( O(1) each ) instead of rebuilding the
        // whole user map on every event ( which was O(N) per event, so O(N^2) overall ).
        await lobbyChannel.presence.subscribe(onPresenceEvent)
        // Ably replays presence as a SYNC after a non-continuous reconnection, so
        // reconcile the full set on every (re)attach to recover from continuity loss.
        lobbyChannel.on('attached', seedUsers)

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

// Rebuild the whole user map from the full presence set. Used to seed on join and to
// reconcile on every (re)attach. Kept off the hot path : presence deltas are handled
// incrementally by onPresenceEvent.
async function seedUsers() {
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
    // selfUser is authoritative locally. The remote presence copy lags behind by the
    // update debounce, so re-assert self last to avoid a stale ready/name flicker.
    multiplayer.upsertUser(multiplayer.selfUser)
}

// Handle a single presence delta in O(1), instead of rebuilding the whole map.
async function onPresenceEvent(member: Ably.PresenceMessage) {
    const { multiplayer, lobbyChannel } = await useLobby()

    // With echoMessages:false we never receive our own presence events. selfUser is
    // authoritative locally ( updated optimistically by the watcher ), so ignore self.
    if (member.clientId == multiplayer.selfUser.permId) {
        return
    }

    if (member.action == 'leave' || member.action == 'absent') {
        // A user may hold several connections ( e.g. multiple tabs ) under one clientId.
        // Only drop them once their last connection is gone, to avoid removing a user
        // who is still present through another connection.
        const remaining = await lobbyChannel.presence.get({ clientId: member.clientId })
        if (remaining.length == 0) {
            delete multiplayer.users[member.clientId]
        }
    } else {
        // enter | present | update
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
        // rtdb removes empty containers, which breaks typescript assumptions, which sucks
        gameRoom.roles ??= {}
        gameRoom.competingPlayers ??= []

        gameRooms[roomId] = gameRoom
    }

    multiplayer.gameRooms = gameRooms
}

export async function createGameRoom(
    roomName: string,
    password: string = '',
    communication: CommunicationMode = CommunicationMode.Ably,
    isCasual: boolean = true,
    allowSpectators: boolean = true,
    isFreeTable: boolean = false,
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
        isCasual,
        allowSpectators,
        isFreeTable,
        roles: { [multiplayer.selfUser.permId]: RoomRole.Player },
        competingPlayers: savedGame ? savedGame.competingPlayers : [],
    }
    // Don't try to coalesce inline with 'seating: savedGame?.seating',
    // as firebase refuse to receive undefined properties
    if (savedGame?.seating) {
        gameRoom.seating = savedGame.seating
    }
    multiplayer.upsertGameRoom(gameRoom)
    // The room object must exist in rtdb before any per-user role write (commitRoomRole,
    // triggered inside joinGameRoom), else that write is a roles-only update on a
    // nonexistent room node, which fails the $roomId shape validation (hasChildren(...)).
    await broadcastGameRoom(gameRoom)
    await joinGameRoom(gameRoom, key)
}

export async function broadcastGameRoom(gameRoom: GameRoom) {
    await rtdbSet(gameRoomRef(gameRoom.id), gameRoom)
}

/**
 * Persist everything but the roles.
 *
 * The host still owns the room metadata and the turn-order seating, but the roles map is
 * written per-user ( see commitRoomRole ). A metadata write must never carry it, else a
 * stale snapshot would clobber a role move made concurrently by someone else ( roles
 * jumping between players/spectators, users vanishing ).
 */
export async function broadcastRoomMeta(gameRoom: GameRoom) {
    const meta: Partial<GameRoom> = { ...gameRoom }
    delete meta.roles
    // Awaited so a rejected write ( e.g. the RTDB rules refusing a roles-less room ) rejects
    // this promise for the caller to handle, rather than becoming an unhandled rejection.
    await rtdbUpdate(gameRoomRef(gameRoom.id), meta)
}

export async function deleteGameRoom(roomId: RoomId) {
    await rtdbRemove(gameRoomRef(roomId))
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
