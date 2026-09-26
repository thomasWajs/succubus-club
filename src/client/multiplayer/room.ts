import { watch, WatchHandle } from 'vue'
import { PresenceMessage } from 'ably'
import {
    ablyPublish,
    ablySubscribe,
    getRtdb,
    releaseScsClient,
    rtdbRef,
    rtdbUpdate,
} from '@/client/gateway/realtime.ts'
import {
    CommunicationMode,
    DeckMessage,
    EMPTY_SEATING,
    GameMutationMessage,
    GameRoom,
    LeaveSeatMessage,
    MultiplayerMessageType,
    PermanentId,
    PickSeatMessage,
    RoomId,
    RoomRole,
    ScsRollSeatingMessage,
    SerializedChatMessage,
    SerializedMultiplayerGame,
    User,
} from '@/shared/types/multiplayer.ts'
import {
    canTakeRoomRole,
    getRoomPermIds,
    getRoomRole,
    isSeated,
    removeFromSeating,
    resolveRoomRole,
} from '@/shared/multiplayer/roles.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { useBusStore } from '@/client/store/bus.ts'
import * as logging from '@/client/logging.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { useHistoryStore } from '@/client/store/history.ts'
import { resetState, startGame } from '@/client/state/setup.ts'
import { AnyGameMutation } from '@/shared/state/gameMutations.ts'
import {
    applyInitialGameState,
    makeMutationMessage,
    receiveChatMessage,
    receiveMutationMessage,
    resetPendingSyncMessage,
    startGameResync,
} from '@/client/multiplayer/sync.ts'
import { broadcastRoomMeta, deleteGameRoom, GAME_ROOMS_KEY } from '@/client/multiplayer/lobby.ts'
import { Key } from '@/client/multiplayer/encryption.ts'
import { ChatMessage } from '@/shared/types/history.ts'
import {
    ablyCommunication,
    getRoomChannel,
    onReceiveRequestResyncGameState,
} from '@/client/multiplayer/communication/ably.ts'
import { Communication } from '@/client/multiplayer/communication'
import {
    onReceiveGameSync,
    onReceiveMutationRejected,
    onReceiveServerError,
    scsCommunication,
} from '@/client/multiplayer/communication/scs.ts'
import { NotInAGameRoom } from '@/client/types.ts'
import { MAX_PLAYERS } from '@/shared/const/model.ts'

export function getCommunication(gameRoom?: GameRoom): Communication {
    if (!gameRoom) {
        gameRoom = useMultiplayerStore().currentGameRoom
    }

    if (!gameRoom) {
        throw new NotInAGameRoom(`Not connected to a game room`)
    }

    if (gameRoom.communication == CommunicationMode.Ably) {
        return ablyCommunication
    } else {
        return scsCommunication
    }
}

export function ensureGameRoom(): GameRoom {
    const multiplayer = useMultiplayerStore()
    const comm = getCommunication()

    if (!comm.isInRoom() || !multiplayer.currentGameRoom) {
        throw new NotInAGameRoom(`Not in a game room`)
    }

    return multiplayer.currentGameRoom
}

/**
 * Joins / Leave
 */

export async function joinGameRoom(gameRoom: GameRoom, key?: Key) {
    const multiplayer = useMultiplayerStore()
    const bus = useBusStore()
    const comm = getCommunication(gameRoom)

    try {
        // We're already there : do nothing
        if (multiplayer.currentGameRoomId == gameRoom.id) {
            return
        }

        if (
            gameRoom.isSavedGame &&
            !gameRoom.competingPlayers.includes(multiplayer.selfUser.permId)
        ) {
            bus.alertError('Only players from the saved game can join the room')
            return
        }

        // Leave any previous room
        await leaveGameRoom()

        multiplayer.selfIsReady = false
        multiplayer.currentGameRoomId = gameRoom.id
        multiplayer.snapshotCurrentGameRoom()

        // We'll always need an ably room, for presence and non-gameState messages
        await ablyCommunication.joinRoom(gameRoom.id, key)
        const roomChannel = getRoomChannel()

        /**
         * Set up room event handlers
         */

        // In SCS mode, subscribe to RollSeating, GameState and MutationRejected from server
        let scsSubscriptions: Promise<void>[] = []
        if (gameRoom.communication === CommunicationMode.SCS) {
            scsSubscriptions = [
                scsCommunication.subscribe(
                    MultiplayerMessageType.RollSeating,
                    onReceiveRollSeating,
                ),
                scsCommunication.subscribe(MultiplayerMessageType.GameState, onReceiveGameSync),
                scsCommunication.subscribe(
                    MultiplayerMessageType.MutationRejected,
                    onReceiveMutationRejected,
                ),
                scsCommunication.subscribe(MultiplayerMessageType.Error, onReceiveServerError),
            ]
        }

        // Activate all subscriptions before entering presence : peers react to our presence
        // entry by re-sending state ( e.g. onMemberJoin resends decks ), and with
        // echoMessages:false we'd otherwise race our own subscribe against their replies and
        // miss messages sent while we were still announcing ourselves.
        await Promise.all([
            // Presence / Users
            roomChannel.presence.subscribe('enter', onMemberJoin),
            roomChannel.presence.subscribe('leave', onMemberLeave),

            // Game messages
            comm.subscribe(MultiplayerMessageType.LaunchGame, comm.onReceiveLaunchGame),
            comm.subscribe(MultiplayerMessageType.GameMutation, receiveGameMutation),
            comm.subscribe(MultiplayerMessageType.Deck, receiveDeck),
            // Chat is authoritative per mode : Ably peers in Ably mode, the server in SCS mode
            comm.subscribe(MultiplayerMessageType.Chat, onReceiveChatMessage),

            // Seat picking is always through ably
            ablySubscribe(
                roomChannel,
                MultiplayerMessageType.RequestResync,
                onReceiveRequestResyncGameState,
            ),
            ablySubscribe(roomChannel, MultiplayerMessageType.PickSeat, onReceivePickSeat),
            ablySubscribe(roomChannel, MultiplayerMessageType.LeaveSeat, onReceiveLeaveSeat),

            ...scsSubscriptions,
        ])

        // Enter presence so peers ( onMemberJoin ) and ably ( on an auto-reconnect ) know
        // we're in the room. Our role isn't part of it : it's read back from rtdb instead.
        await roomChannel.presence.enter(multiplayer.selfUser)

        // Seed room membership from presence, so host-presence and writer election track
        // who is actually in the room rather than the churn-prone lobby presence. The
        // 'enter'/'leave' subscriptions above are already active, so no member is missed.
        multiplayer.clearRoomMembers()
        for (const member of await roomChannel.presence.get()) {
            const memberUser = member.data as User | undefined
            if (memberUser) {
                multiplayer.upsertRoomMember(memberUser)
            }
        }

        // Anyone can become the room writer, so all client must setup a room watcher
        setupGameRoomWatcher()

        // If ably, it's already joined. If SCS, we need to join.
        await comm.joinRoom(gameRoom.id, key)

        const permId = multiplayer.selfUser.permId
        const role = resolveRoomRole(gameRoom, permId)
        multiplayer.setGameRoomRole(permId, role)
        // Persist our own role. The host that just created the room already seeded itself as a
        // player in the create write, so this is a harmless idempotent re-write for them.
        await commitRoomRole(gameRoom.id, permId, role)

        if (multiplayer.selfDeck) {
            await comm.sendDeck()
        }
    } catch (e) {
        logging.captureException(e)
        bus.alertError('Error joining game room. Please try again')
        return
    }
}

export async function leaveGameRoom() {
    const multiplayer = useMultiplayerStore()
    // First call, in case we're returning early
    multiplayer.currentGameRoomFallback = null

    const gameRoom = multiplayer.currentGameRoom
    if (!gameRoom) {
        return
    }

    const comm = getCommunication(gameRoom)
    if (!comm.isInRoom()) {
        return
    }

    // We're the last user in the room, we can delete it.
    // Every role counts : judges and spectators still need the room to exist.
    if (multiplayer.allGameRoomUsers.length == 1 && multiplayer.currentGameRoomId) {
        await deleteGameRoom(multiplayer.currentGameRoomId)
    } else {
        // A deliberate leave always frees our role, whatever it is. The "keep role while
        // offline" reservation ( see onMemberLeave ) only makes sense for an accidental
        // disconnect ; here we're still connected, so we persist our own release directly
        // instead of waiting on a peer to observe our presence 'leave'.
        await commitReleaseRoomRole(gameRoom.id, multiplayer.selfUser.permId)
    }

    unwatchGameRoom?.()
    unwatchGameRoom = null
    // Second call, to erase the snapshot mades by the game room watcher
    multiplayer.currentGameRoomFallback = null
    // We're always connected to ably ( for presence )
    await ablyCommunication.leaveRoom()
    // Needed if conencted to SCS
    await comm.leaveRoom()
    multiplayer.selfIsReady = false
    multiplayer.currentGameRoomId = null
    multiplayer.clearRoomMembers()
    // Wipe the room chat : it belongs to the room we're leaving.
    useHistoryStore().clearChat()
    // Reset the pending sync message, in case there's still messages in there
    resetPendingSyncMessage()
}

/**
 * GameRoom watcher
 */

let unwatchGameRoom: WatchHandle | null = null
export function setupGameRoomWatcher() {
    // Watcher is already active, do nothing.
    if (unwatchGameRoom) {
        return
    }

    const multiplayer = useMultiplayerStore()

    // Watch for changes to currentGameRoom and broadcast when it updates
    unwatchGameRoom = watch(
        () => multiplayer.currentGameRoom,
        gameRoom => {
            // Snapshot only if not already reading currentGameRoomFallback,
            // else we would end up in a recursive loop
            if (gameRoom != multiplayer.currentGameRoomFallback) {
                multiplayer.snapshotCurrentGameRoom()
            }

            // Roles are written per-user ( see commitRoomRole ), so the room writer only persists
            // the room metadata and seating here : a whole-object set would clobber a role
            // move made concurrently by another client.
            //
            // Only persist for a room that still exists in RTDB. When it has been removed there,
            // currentGameRoom is just the local fallback ; a metadata update from it would
            // resurrect the room without its per-user roles subtree ( 0 players, everyone
            // kicked ). The RTDB rules reject such a write too, this simply avoids attempting it.
            //
            // This check is best-effort, not airtight : it's a TOCTOU window. Between the room
            // being removed in RTDB and onGameRoomRemoved clearing the local gameRooms entry,
            // isLiveRoom is still true, so a deep change here could still fire a resurrecting
            // broadcastRoomMeta. That write is the last line of defence's job : being at the
            // $roomId node, it re-runs the 'roles' required-child validation and is rejected,
            // so it lands in the .catch below rather than recreating a roles-less room.
            const roomId = multiplayer.currentGameRoomId
            const isLiveRoom = !!roomId && roomId in multiplayer.gameRooms
            if (gameRoom && isLiveRoom && multiplayer.selfIsRoomWriter) {
                broadcastRoomMeta(gameRoom).catch(logging.captureException)
            }
        },
        { deep: true }, // Watch for deep changes in the gameRoom object
    )
}

/**
 * Presence / Users
 */

function onMemberJoin(presence: PresenceMessage) {
    const multiplayer = useMultiplayerStore()
    // Prefer the User carried by the event over the lobby map : a room member whose lobby
    // presence lapsed under load would otherwise be dropped entirely.
    const data = presence.data as User | undefined
    const user = data ?? multiplayer.users[presence.clientId]
    const gameRoom = multiplayer.currentGameRoom

    if (!user || !gameRoom) {
        return
    }

    // Track room presence, and make sure their name / avatar are known for display.
    multiplayer.upsertRoomMember(user)
    multiplayer.upsertUser(user)

    // Resolve the (re)joining member's role from rtdb : a judge/spectator keeps the role
    // they hold there, a player gets their seat back if there's still room for them.
    const role = resolveRoomRole(gameRoom, user.permId)
    if (role == RoomRole.Player) {
        alertReconnect(gameRoom, user)
    }
    multiplayer.setGameRoomRole(user.permId, role)

    // The single elected writer persists the (re)joining member's role, so an auto-reconnect
    // ( which never re-runs joinGameRoom ) is restored durably in rtdb, not just optimistically
    // here. A per-user child write, so it can't clobber another member's role.
    //
    // Note this is a second writer on the joiner's own key : a fresh join also commits its
    // role from joinGameRoom. The two resolve the role against their own local snapshots, so
    // near MAX_PLAYERS they can disagree ( joiner sees Player, writer sees the table full and
    // resolves Spectator, or vice-versa ) and last-write-wins may briefly flip that user's
    // role. Accepted like the MAX_PLAYERS cap race ( see the Role writes note below ) : the
    // next rtdb sync converges everyone on the winning value.
    if (multiplayer.selfIsRoomWriter) {
        commitRoomRole(gameRoom.id, user.permId, role).catch(logging.captureException)
    }

    // In Ably mode, send our decklist to the newly connected user
    if (gameRoom.communication == CommunicationMode.Ably) {
        getCommunication(gameRoom).sendDeck()
    }
}

function onMemberLeave(presence: PresenceMessage) {
    const multiplayer = useMultiplayerStore()
    const gameRoom = multiplayer.currentGameRoom
    const user = (presence.data as User | undefined) ?? multiplayer.users[presence.clientId]

    // Always drop them from room presence first, so a departed writer hands off to the
    // next remaining member when we elect below.
    multiplayer.removeRoomMember(presence.clientId)

    if (user) {
        alertDisconnect(user)
        // Only a player release is worth persisting : judges and spectators keep their role
        // while offline so they reclaim it on reconnect.
        const releasedPlayer = multiplayer.releaseGameRoomRole(user.permId)

        // The departing client can't persist its own release, so the single elected room
        // writer does it ( host while present, else lowest permId in the room ). Every
        // client agrees on that one writer, so they no longer all race to write.
        if (gameRoom && releasedPlayer && multiplayer.selfIsRoomWriter) {
            commitReleaseRoomRole(gameRoom.id, user.permId).catch(logging.captureException)
        }
    }
}

function receiveDeck(deckMessage: DeckMessage) {
    const multiplayer = useMultiplayerStore()
    multiplayer.userDecks[deckMessage.permId] = deckMessage.deckList
}

/** Seating Messages */

export function rollSeating() {
    const multiplayer = useMultiplayerStore()
    const gameRoom = ensureGameRoom()
    const comm = getCommunication(gameRoom)

    // Cannot roll seating on a game that's already started
    if (gameRoom.isStarted) {
        throw new Error(`Game already started`)
    }
    if (!multiplayer.selfIsHost) {
        throw new Error(`You are not the host`)
    }

    comm.rollSeating()
}

function onReceiveRollSeating(message: ScsRollSeatingMessage) {
    const gameRoom = ensureGameRoom()

    // Cannot roll seating if the game is already started
    if (gameRoom.isStarted) {
        return
    }

    // Update the seating with the server-generated seating
    gameRoom.seating = message.seating
}

export function startPickSeating() {
    const multiplayer = useMultiplayerStore()
    const gameRoom = ensureGameRoom()
    // Cannot pick seating on a game that's already started
    if (gameRoom.isStarted) {
        throw new Error(`Game already started`)
    }
    if (!multiplayer.selfIsHost) {
        throw new Error(`You are not the host`)
    }
    // Initialize seating with 'EMPTY' marker to start pick mode
    // (RTDB wipes empty arrays, so we use a marker instead)
    gameRoom.seating = EMPTY_SEATING
}

export async function pickSeat(position: number) {
    const multiplayer = useMultiplayerStore()
    const gameRoom = ensureGameRoom()
    // Cannot pick seat on a game that's already started
    if (gameRoom.isStarted) {
        throw new Error(`Game already started`)
    }
    // Check if player is already seated
    if (isSeated(gameRoom, multiplayer.selfUser.permId)) {
        throw new Error(`You are already seated`)
    }
    // Only players get a turn order position : a judge or a spectator in the seating
    // would keep isSeatingReady false forever.
    if (getRoomRole(gameRoom, multiplayer.selfUser.permId) != RoomRole.Player) {
        throw new Error(`Only players can pick a seat`)
    }
    // Initialize seating if needed
    // Replace EMPTY marker with actual seating array if this is the first pick
    if (!gameRoom.seating || gameRoom.seating == EMPTY_SEATING) {
        gameRoom.seating = []
    }
    // Insert player at the specified position
    gameRoom.seating.splice(position, 0, multiplayer.selfUser.permId)

    // Broadcast the seat pick to all players
    await broadcastPickSeat(multiplayer.selfUser.permId, position)
}

async function broadcastPickSeat(permId: PermanentId, position: number) {
    const gameRoom = ensureGameRoom()
    if (gameRoom.isStarted) {
        throw new Error(`Game already started`)
    }
    const roomChannel = getRoomChannel()
    await ablyPublish(roomChannel, MultiplayerMessageType.PickSeat, { permId, position })
}

async function onReceivePickSeat(message: PickSeatMessage) {
    const multiplayer = useMultiplayerStore()
    const gameRoom = ensureGameRoom()

    // Cannot pick seat if the game is already started
    // Don't apply our own seat picks (already applied locally)
    // Validate that the player isn't already seated
    // Only players get a turn order position
    if (
        gameRoom.isStarted ||
        message.permId === multiplayer.selfUser.permId ||
        isSeated(gameRoom, message.permId) ||
        getRoomRole(gameRoom, message.permId) != RoomRole.Player
    ) {
        return
    }

    // Initialize seating if needed
    // Replace EMPTY marker with actual seating array if this is the first pick
    if (!gameRoom.seating || gameRoom.seating == EMPTY_SEATING) {
        gameRoom.seating = []
    }

    // Validate position is within valid bounds
    if (message.position < 0 || message.position > gameRoom.seating.length) {
        return
    }

    // Insert player at the specified position
    gameRoom.seating.splice(message.position, 0, message.permId)
}

export async function leaveSeat() {
    const multiplayer = useMultiplayerStore()
    const gameRoom = ensureGameRoom()
    // Cannot leave seat on a game that's already started
    if (gameRoom.isStarted) {
        throw new Error(`Game already started`)
    }
    // Check if player is seated
    if (!isSeated(gameRoom, multiplayer.selfUser.permId)) {
        throw new Error(`You are not seated`)
    }
    removeFromSeating(gameRoom, multiplayer.selfUser.permId)

    // Broadcast the seat leave to all players
    await broadcastLeaveSeat(multiplayer.selfUser.permId)
}

async function broadcastLeaveSeat(permId: PermanentId) {
    const gameRoom = ensureGameRoom()
    if (gameRoom.isStarted) {
        throw new Error(`Game already started`)
    }
    const roomChannel = getRoomChannel()
    await ablyPublish(roomChannel, MultiplayerMessageType.LeaveSeat, { permId })
}

async function onReceiveLeaveSeat(message: LeaveSeatMessage) {
    const multiplayer = useMultiplayerStore()
    const gameRoom = ensureGameRoom()

    // Cannot leave seat if the game is already started
    // Don't apply our own seat leaves (already applied locally)
    // Check if player is seated
    if (
        gameRoom.isStarted ||
        message.permId === multiplayer.selfUser.permId ||
        !isSeated(gameRoom, message.permId)
    ) {
        return
    }

    removeFromSeating(gameRoom, message.permId)
}

/** Room Seat Messages */

/**
 * Move ourselves to another room role ( player / judge / spectator ).
 *
 * Persisted through rtdb only : this is not realtime-sensitive, so peers just pick it up
 * from the per-user role write via the room watcher, rather than also broadcasting an
 * optimistic intent over ably.
 */
export async function setSelfRoomRole(role: RoomRole) {
    const multiplayer = useMultiplayerStore()
    const gameRoom = ensureGameRoom()
    const permId = multiplayer.selfUser.permId

    // Cannot change role on a game that's already started
    if (gameRoom.isStarted) {
        throw new Error(`Game already started`)
    }
    // Already there : nothing to do
    if (getRoomRole(gameRoom, permId) == role) {
        return
    }
    if (!canTakeRoomRole(gameRoom, permId, role)) {
        throw new Error(`You cannot take this role`)
    }

    multiplayer.setGameRoomRole(permId, role)

    // Judges and spectators never gate the game start
    if (role != RoomRole.Player) {
        multiplayer.selfIsReady = false
    }

    await commitRoomRole(gameRoom.id, permId, role)
}

/** Game launching */

export async function launchGame() {
    const core = useCoreStore()
    const gameRoom = ensureGameRoom()
    const comm = getCommunication(gameRoom)

    // Cannot launch a game that's already started
    if (gameRoom.isStarted || core.gameIsStarted) {
        throw new Error(`Game already started`)
    }

    // Guard the player cap here : role writes don't enforce it atomically, so a race could
    // have seated a 6th player. Refuse rather than start an oversized game.
    if (getRoomPermIds(gameRoom, RoomRole.Player).length > MAX_PLAYERS) {
        throw new Error(`Cannot launch with more than ${MAX_PLAYERS} players`)
    }

    if (!gameRoom.seating || gameRoom.seating == EMPTY_SEATING) {
        throw new Error('Seating is not ready')
    }

    await comm.launchGame(gameRoom)

    // Disconnect from SCS websocket if we won't be using it
    if (gameRoom.communication != CommunicationMode.SCS) {
        releaseScsClient()
    }
}

export async function receiveLaunchGame(serializedGame: SerializedMultiplayerGame) {
    const core = useCoreStore()
    const gameRoom = ensureGameRoom()
    // Cannot launch a game if we're already in one
    if (core.gameIsStarted) {
        return
    }

    await applyInitialGameState(serializedGame)
    startGame()
    await core.userProfile.setLastMultiGame(gameRoom.id)

    // Disconnect from SCS websocket if we won't be using it
    if (gameRoom.communication != CommunicationMode.SCS) {
        releaseScsClient()
    }
}

/** Chat Messages */

export async function sendChat(message: ChatMessage) {
    // Chat works both in the game room ( before start ) and in the running game.
    const gameRoom = ensureGameRoom()

    // Once the game has started, only players and judges may chat. Spectators
    // ( including users who joined after the start ) are muted. In SCS the server
    // enforces this too ; in Ably ( no server ) this client guard is the enforcement.
    if (gameRoom.isStarted) {
        const role = getRoomRole(gameRoom, useMultiplayerStore().selfUser.permId)
        if (role != RoomRole.Player && role != RoomRole.Judge) {
            return
        }
    }

    // The transport handles echo and delivery : Ably echoes locally and broadcasts to
    // peers ; SCS sends to the server, which stores it and rebroadcasts to the room.
    await getCommunication().sendChat(message)
}

export async function onReceiveChatMessage(serializedMessage: SerializedChatMessage) {
    // Chat works both in the game room ( before start ) and in the running game.
    ensureGameRoom()
    await receiveChatMessage(serializedMessage)
}

/** Game Mutation Messages */

export async function broadcastGameMutation(gameMutation: AnyGameMutation) {
    const gameRoom = ensureGameRoom()
    if (!gameRoom.isStarted) {
        return
    }
    const comm = getCommunication(gameRoom)

    const message = await makeMutationMessage(gameMutation)
    await comm.broadcastGameMutation(message)
}

export async function receiveGameMutation(gameMutationMessage: GameMutationMessage) {
    const gameRoom = ensureGameRoom()
    // Cannot receive mutations if the game is not started
    if (!gameRoom.isStarted) {
        return
    }
    await receiveMutationMessage(gameMutationMessage)
}

/** State Sync Messages */

export async function requestResyncGameState(isUserRequest: boolean = false) {
    const gameRoom = ensureGameRoom()
    if (!gameRoom.isStarted) {
        return
    }
    const comm = getCommunication(gameRoom)

    startGameResync(isUserRequest)
    await comm.requestResyncGameState()
}

export async function connectIntoGame(gameRoom?: GameRoom) {
    const bus = useBusStore()

    if (gameRoom) {
        await joinGameRoom(gameRoom)
    }

    ensureGameRoom()
    bus.isResyncing = true
    resetState()
    startGame()
    await requestResyncGameState()
}

/**
 * Role writes.
 *
 * The roles map is the only part of a room several clients mutate at once, and each user owns
 * their own key, so every role change is a plain per-user child write : concurrent moves on
 * different users merge instead of clobbering. MAX_PLAYERS is not enforced atomically here -
 * the client guards it optimistically ( canTakeRoomRole / resolveRoomRole ) and launchGame
 * refuses an oversized table - so a precise last-seat race could momentarily seat a 6th
 * player, which we accept rather than pay for a transaction.
 *
 * Leaving the player role drops the user from the turn-order seating too ; that seating write
 * rides the host's broadcastRoomMeta ( driven by the ably intent ), not these role writes.
 */
function rolesRef(roomId: RoomId) {
    return rtdbRef(getRtdb(), `${GAME_ROOMS_KEY}/${roomId}/roles`)
}

/**
 * Move a user to a role ( player / judge / spectator ), or seat a ( re )joining user with the
 * role the caller already resolved. A single-key child write, so it merges with concurrent
 * role changes on other users.
 */
async function commitRoomRole(roomId: RoomId, permId: PermanentId, role: RoomRole) {
    await rtdbUpdate(rolesRef(roomId), { [permId]: role })
}

/**
 * Release a user's room role entirely ( a single-key delete, like commitRoomRole ). Two
 * callers, two purposes :
 * - onMemberLeave persists another member's release after an accidental disconnect, and
 *   only for a player role : judges and spectators keep theirs while offline ( see
 *   releaseRoomRole ) so they reclaim it on reconnect. The caller gates on the local
 *   release having removed a player.
 * - leaveGameRoom persists our own release on a deliberate leave, whatever our role, since
 *   there's no "reconnect" to reserve it for.
 */
async function commitReleaseRoomRole(roomId: RoomId, permId: PermanentId) {
    await rtdbUpdate(rolesRef(roomId), { [permId]: null })
}

/**
 * Connection / Disconnection Alerts
 */

const last_disconnect_alert = {} as Record<PermanentId, Date>

function alertDisconnect(user: User) {
    const bus = useBusStore()
    const multiplayer = useMultiplayerStore()

    const gameRoom = multiplayer.currentGameRoom
    if (gameRoom?.isStarted && getRoomRole(gameRoom, user.permId) === RoomRole.Player) {
        bus.alertWarning(`${user.name} has left the game.`)
        last_disconnect_alert[user.permId] = new Date()
    }
}

function alertReconnect(gameRoom: GameRoom, user: User) {
    const bus = useBusStore()

    // Alert the reconnection if a peer join while :
    // the game is started AND he's seated AND we alerted for the disconnection
    if (
        gameRoom.isStarted &&
        isSeated(gameRoom, user.permId) &&
        last_disconnect_alert[user.permId]
    ) {
        bus.alertSuccess(`${user.name} has reconnected into the game room.`)
        delete last_disconnect_alert[user.permId]
    }
}
