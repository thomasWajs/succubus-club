import { useMultiplayerStore } from '@/store/multiplayer.ts'
import { Room } from 'trystero'
import {
    joinRoom,
    GameRoom,
    makeNetAction,
    onPeerDisconnect,
    PeerId,
    TRYSTERO_CONFIG,
    User,
    PermanentId,
} from '@/multiplayer/common.ts'
import { joinGameRoom, leaveGameRoom } from '@/multiplayer/room.ts'
import { useBusStore } from '@/store/bus.ts'
import { watch, WatchHandle } from 'vue'
import * as logging from '@/logging.ts'
import { waitUntil } from '@/utils.ts'

export const LOBBY_ROOM = 'Lobby'
const HEARTBEAT_INTERVAL = 1000 * 15 // 15 seconds

let lobby: Room | null = null
type LobbyActions = ReturnType<typeof makeLobbyActions>
export let lobbyActions: LobbyActions | null = null
let unwatchSelfUser: WatchHandle | null = null
let selfUserHeartbeatIntervalId: ReturnType<typeof setInterval> | null = null

function makeLobbyActions(lobby: Room) {
    return {
        // Param: User to create or update
        broadcastUser: makeNetAction<User>(lobby, 'b7tUser', onReceiveUser),
        // Param : None
        requestUser: makeNetAction<null>(lobby, 'reqUser', onReceiveRequestUser),
        // Param: GameRoom to create or update
        broadcastGameRoom: makeNetAction<GameRoom>(lobby, 'b7tGameRoom', onReceiveGameRoom),
        // Param : None
        requestGameRoom: makeNetAction<null>(lobby, 'reqGameRoom', onReceiveRequestGameRoom),
        // Param : Room Name
        deleteGameRoom: makeNetAction<string>(lobby, 'delGameRoom', onReceiveDeleteGameRoom),
    }
}

function setupSelfUserWatcher() {
    const multiplayer = useMultiplayerStore()

    // Watcher is already active, do nothing.
    if (unwatchSelfUser) {
        return
    }

    // Watch for changes to selfUser and broadcast when it updates
    unwatchSelfUser = watch(
        () => multiplayer.selfUser,
        selfUser => {
            multiplayer.upsertUser(multiplayer.selfUser)
            lobbyActions?.broadcastUser.send(selfUser)
        },
        { deep: true }, // Watch for deep changes in the User object
    )
    document.addEventListener('beforeunload', unwatchSelfUser)
}

// Send regularly our user, in case peers mess up with their multiplayer.users.
// This makes flaky connections more robust.
function setupSelfUserHeartbeat() {
    selfUserHeartbeatIntervalId = setInterval(() => {
        lobbyActions?.broadcastUser.send(useMultiplayerStore().selfUser)
    }, HEARTBEAT_INTERVAL)
}

export function joinLobby() {
    const multiplayer = useMultiplayerStore()
    const bus = useBusStore()

    if (multiplayer.hasJoinedLobby) {
        return
    }

    multiplayer.upsertUser(multiplayer.selfUser)

    try {
        lobby = joinRoom(TRYSTERO_CONFIG, LOBBY_ROOM)
    } catch (e) {
        logging.captureException(e)
        bus.alertError('Error joining lobby. Please try again')
        return
    }

    lobbyActions = makeLobbyActions(lobby)

    /**
     * Set up lobby event handlers
     */

    lobby.onPeerJoin(onPeerJoin)
    lobby.onPeerLeave(onPeerLeave)

    // Announce ourselves to everybody in the lobby
    lobbyActions.broadcastUser.send(multiplayer.selfUser)

    setupSelfUserWatcher()
    setupSelfUserHeartbeat()
}

export function leaveLobby() {
    const multiplayer = useMultiplayerStore()

    if (multiplayer.currentGameRoomName) {
        leaveGameRoom()
    }

    multiplayer.$reset()
    lobby?.leave()
    lobby = null
    lobbyActions = null
    if (selfUserHeartbeatIntervalId) {
        clearInterval(selfUserHeartbeatIntervalId)
    }
}

function onPeerJoin(peerId: PeerId) {
    const multiplayer = useMultiplayerStore()

    // When someone joins, send them our user info
    lobbyActions?.broadcastUser.send(multiplayer.selfUser, peerId)

    // And our current game room if applicable
    broadcastCurrentGameRoom(peerId)

    setupPeerUserCheck(peerId)
        // Special case for host reconnection : send them the game room when we have their permId
        .then(() => {
            broadcastCurrentGameRoom(peerId)
        })
}

function onPeerLeave(peerId: PeerId) {
    onPeerDisconnect(peerId, true)
}

function onReceiveUser(user: User) {
    useMultiplayerStore().upsertUser(user)
}

function onReceiveRequestUser(_: null, peerId: PeerId) {
    lobbyActions?.broadcastUser.send(useMultiplayerStore().selfUser, peerId)
}

function onReceiveGameRoom(gameRoom: GameRoom) {
    useMultiplayerStore().upsertGameRoom(gameRoom)
}

function onReceiveRequestGameRoom(_: null, peerId: PeerId) {
    // Send our current game room if applicable
    broadcastCurrentGameRoom(peerId)
}

function onReceiveDeleteGameRoom(name: string) {
    useMultiplayerStore().deleteGameRoom(name)
}

export async function createGameRoom(
    roomName: string,
    seating: PermanentId[] = [],
    isStarted: boolean = false,
) {
    const multiplayer = useMultiplayerStore()

    if (multiplayer.gameRoomNames.includes(roomName)) {
        const bus = useBusStore()
        bus.alertError('A game room with this name already exists.')
        return
    }

    const gameRoom = {
        name: roomName,
        hostId: multiplayer.selfUser.permId,
        isStarted,
        hasPassword: false,
        players: [multiplayer.selfUser.permId],
        // spectators: [],
        seating,
    }
    multiplayer.upsertGameRoom(gameRoom)
    await joinGameRoom(gameRoom)
    lobbyActions?.broadcastGameRoom.send(gameRoom)
}

function broadcastCurrentGameRoom(peerId: PeerId) {
    const multiplayer = useMultiplayerStore()

    if (multiplayer.currentGameRoom) {
        // In the general case, only the host broadcast its game room
        if (multiplayer.selfIsHost) {
            lobbyActions?.broadcastGameRoom.send(multiplayer.currentGameRoom, peerId)
        }
        // However there's a special case :
        // when the host has left / disconnected, we need to send him the game room
        // so he can come back
        if (multiplayer.currentGameRoom.hostId == multiplayer.peerMapping[peerId]) {
            lobbyActions?.broadcastGameRoom.send(multiplayer.currentGameRoom, peerId)
        }
    }
}

export function refreshGameRooms() {
    const multiplayer = useMultiplayerStore()

    let myGameRoom = null
    if (multiplayer.currentGameRoom && multiplayer.selfIsHost) {
        myGameRoom = multiplayer.currentGameRoom
    }
    multiplayer.gameRooms = {}
    if (myGameRoom) {
        multiplayer.upsertGameRoom(myGameRoom)
    }
    lobbyActions?.requestGameRoom.send(null)
}

/**
 * Ensure we correctly received the User for each peer
 */

const PEER_USER_CHECK_INTERVAL = 2000 // each 2 seconds
const MAX_PEER_USER_CHECK_ATTEMPTS = 30 // give up after 1 minute
function setupPeerUserCheck(peerId: PeerId) {
    const multiplayer = useMultiplayerStore()
    return waitUntil(
        () => peerId in multiplayer.peerMapping || !lobby || !(peerId in lobby.getPeers()),
        PEER_USER_CHECK_INTERVAL,
        MAX_PEER_USER_CHECK_ATTEMPTS,
        () => lobbyActions?.requestUser.send(null, peerId),
    )
}
