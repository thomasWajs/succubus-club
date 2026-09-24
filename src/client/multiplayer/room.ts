import { watch, WatchHandle } from 'vue'
import { PresenceMessage } from 'ably'
import {
    ablyPublish,
    ablySubscribe,
    getRtdb,
    releaseScsClient,
    rtdbRef,
    rtdbRunTransaction,
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
    RoomPresence,
    RoomRole,
    RoomRoles,
    ScsRollSeatingMessage,
    SerializedChatMessage,
    SerializedMultiplayerGame,
    SetRoomRoleMessage,
    User,
} from '@/shared/types/multiplayer.ts'
import {
    canTakeRoomRole,
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

        // Enter presence declaring our role, so peers ( and ably on an auto-reconnect )
        // can restore us to it rather than defaulting us to a player.
        const permId = multiplayer.selfUser.permId
        const role = resolveRoomRole(gameRoom, permId)
        const roomPresence: RoomPresence = { ...multiplayer.selfUser, role }
        await roomChannel.presence.enter(roomPresence)

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

        // Activate all subscriptions
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
            ablySubscribe(roomChannel, MultiplayerMessageType.SetRoomRole, onReceiveSetRoomRole),

            ...scsSubscriptions,
        ])

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

        // The host is responsible for sending game room updates to the other players
        if (multiplayer.selfIsHost) {
            setupGameRoomWatcher()
        }

        // If ably, it's already joined. If SCS, we need to join.
        await comm.joinRoom(gameRoom.id, key)

        multiplayer.setGameRoomRole(permId, role)
        // Persist our own role merge-safely, preferring the role we just declared. The host
        // that just created the room isn't in rtdb yet ( broadcastGameRoom runs right after
        // createGameRoom ), so this transaction simply aborts for them : they're already
        // seeded as a player.
        await commitJoinRoomRole(gameRoom.id, permId, role)

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
    }

    unwatchGameRoom?.()
    unwatchGameRoom = null
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

            // Seats are transaction-owned ( see commitRoomRole ), so the host only
            // persists the room metadata and seating here : a whole-object set would
            // clobber a role move made concurrently by another client.
            if (gameRoom && multiplayer.selfIsHost) {
                broadcastRoomMeta(gameRoom)
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
    // Prefer the RoomPresence carried by the event over the lobby map : a room member whose
    // lobby presence lapsed under load would otherwise be dropped entirely.
    const data = presence.data as RoomPresence | undefined
    const user = data ?? multiplayer.users[presence.clientId]
    const gameRoom = multiplayer.currentGameRoom

    if (!user || !gameRoom) {
        return
    }

    // Track room presence, and make sure their name / avatar are known for display.
    multiplayer.upsertRoomMember(user)
    multiplayer.upsertUser(user)

    // Restore the role the user themselves declares ( so a reconnecting judge/spectator
    // keeps their role even if their role array entry was lost ), unless it's no longer
    // available ( e.g. the player table filled up while they were away ).
    const declared = data?.role
    const role =
        declared && canTakeRoomRole(gameRoom, user.permId, declared) ? declared : (
            resolveRoomRole(gameRoom, user.permId)
        )
    if (role == RoomRole.Player) {
        alertReconnect(gameRoom, user)
    }
    multiplayer.setGameRoomRole(user.permId, role)

    // The single elected writer persists the (re)joining member's role, so an auto-reconnect
    // ( which never re-runs joinGameRoom ) is restored durably in rtdb, not just optimistically
    // here. Merge-safe and idempotent : the transaction aborts when nothing changes.
    if (multiplayer.selfIsRoomWriter) {
        commitJoinRoomRole(gameRoom.id, user.permId, role)
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
        multiplayer.releaseGameRoomRole(user.permId)

        // The departing client can't persist its own release, so the single elected room
        // writer does it ( host while present, else lowest permId in the room ). Every
        // client agrees on that one writer, so they no longer all race to write.
        if (gameRoom && multiplayer.selfIsRoomWriter) {
            commitReleaseRoomRole(gameRoom.id, user.permId)
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
 * Mutate locally then broadcast, like pickSeat : only the host persists the room to
 * RTDB, so a local mutation alone would be wiped by the next host broadcast.
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

    // Persist the move merge-safely, then broadcast it over ably for immediate peer UI.
    // The transaction is the durable truth ; the ably intent is only optimistic.
    await commitRoomRole(gameRoom.id, permId, role)
    await broadcastSetRoomRole(permId, role)

    // Re-declare our role in presence, so a later reconnect restores this new role.
    const roomPresence: RoomPresence = { ...multiplayer.selfUser, role }
    await getRoomChannel().presence.update(roomPresence)
}

async function broadcastSetRoomRole(permId: PermanentId, role: RoomRole) {
    const gameRoom = ensureGameRoom()
    if (gameRoom.isStarted) {
        throw new Error(`Game already started`)
    }
    const roomChannel = getRoomChannel()
    await ablyPublish(roomChannel, MultiplayerMessageType.SetRoomRole, { permId, role })
}

async function onReceiveSetRoomRole(message: SetRoomRoleMessage) {
    const multiplayer = useMultiplayerStore()
    const gameRoom = ensureGameRoom()

    // Cannot change role if the game is already started
    // Don't apply our own role changes (already applied locally)
    // Validate the role is still available. Two users racing for the last player role
    // both pass locally ; the sender's own transaction ( commitRoomRole ) is the durable
    // arbiter, this is only the optimistic local echo of their intent.
    if (
        gameRoom.isStarted ||
        message.permId === multiplayer.selfUser.permId ||
        !canTakeRoomRole(gameRoom, message.permId, message.role)
    ) {
        return
    }

    // Optimistic local update only : the sender persists the move through a transaction,
    // so we no longer broadcast the whole room here.
    multiplayer.setGameRoomRole(message.permId, message.role)
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
 * The roles map is the only part of a room several clients mutate at once. Because each user
 * owns their own key, a move to judge/spectator ( no cap ) is a plain per-user child merge :
 * concurrent moves on different users never conflict. Only taking a player role has a cross-
 * user constraint ( MAX_PLAYERS ), so that path runs a transaction scoped to the roles node.
 *
 * Leaving the player role drops the user from the turn-order seating too ; that seating write
 * rides the host's broadcastRoomMeta ( driven by the ably intent ), not these role writes.
 */
function rolesRef(roomId: RoomId) {
    return rtdbRef(getRtdb(), `${GAME_ROOMS_KEY}/${roomId}/roles`)
}

function countPlayers(roles: RoomRoles): number {
    return Object.values(roles).filter(role => role === RoomRole.Player).length
}

/**
 * Run a transaction on just the roles node. Aborts ( no write ) when the room doesn't exist
 * or when mutate reports no change. The lobby caches rooms through rtdbOnValue, so the first
 * pass holds the real value rather than a spurious null.
 */
function runRolesTransaction(roomId: RoomId, mutate: (roles: RoomRoles) => boolean) {
    return rtdbRunTransaction(rolesRef(roomId), (roles: RoomRoles | null) => {
        // null means the room isn't there : never create a roles-only room ( it would fail
        // the room shape validation anyway ).
        if (roles === null) {
            return undefined
        }
        return mutate(roles) ? roles : undefined
    })
}

/**
 * Deliberately move a user to a role ( player / judge / spectator ).
 */
export async function commitRoomRole(roomId: RoomId, permId: PermanentId, role: RoomRole) {
    if (role === RoomRole.Player) {
        // MAX_PLAYERS is a cross-user constraint : two clients racing for the last role both
        // pass their local guard, but only the first transaction to commit here wins. The
        // loser's move simply reverts on the next sync.
        await runRolesTransaction(roomId, roles => {
            if (roles[permId] === RoomRole.Player || countPlayers(roles) >= MAX_PLAYERS) {
                return false
            }
            roles[permId] = RoomRole.Player
            return true
        })
    } else {
        // Judge / spectator have no cap : a per-user child merge is enough, and it never
        // clobbers a concurrent role change on another user.
        await rtdbUpdate(rolesRef(roomId), { [permId]: role })
    }
}

/**
 * Seat a ( re )joining user with the role already resolved by the caller ( which knows the
 * room's started/seating state ). Keeps a role they still hold ; if they were resolved to a
 * player role but the table filled up meanwhile, falls back to spectator.
 */
export async function commitJoinRoomRole(roomId: RoomId, permId: PermanentId, role: RoomRole) {
    await runRolesTransaction(roomId, roles => {
        // Already seated : keep it, never override a seat they currently hold.
        if (roles[permId]) {
            return false
        }
        roles[permId] =
            role === RoomRole.Player && countPlayers(roles) >= MAX_PLAYERS ?
                RoomRole.Spectator
            :   role
        return true
    })
}

/**
 * Release a disconnecting user's player role. Judges and spectators keep their role while
 * offline ( see releaseRoomRole ), so they reclaim it on reconnect.
 */
export async function commitReleaseRoomRole(roomId: RoomId, permId: PermanentId) {
    await runRolesTransaction(roomId, role => {
        if (role[permId] !== RoomRole.Player) {
            return false
        }
        delete role[permId]
        return true
    })
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
