import { MAX_PLAYERS } from '@/shared/const/model.ts'
import { EMPTY_SEATING, GameRoom, PermanentId, RoomRole } from '@/shared/types/multiplayer.ts'

/**
 * Room role : where a user sits in a game room, before the game starts.
 *
 * A room stores its roles as a single permId -> RoomRole map ( gameRoom.roles ), so the
 * three roles are mutually exclusive by construction : a user holds exactly one role and can
 * never appear twice. Every role write still goes through applyRoomRole / releaseRoomRole, so
 * the coupling with the turn-order seating stays in one place.
 *
 * These helpers are pure ( GameRoom in, GameRoom out ) so the SCS server can use them too.
 */

// In display order
export const ROOM_ROLES = [RoomRole.Player, RoomRole.Judge, RoomRole.Spectator]

/**
 * Is this permId in the turn order seating ?
 * Never test gameRoom.seating.includes() directly : seating can be the EMPTY_SEATING
 * marker string, on which includes() silently becomes a substring match.
 */
export function isSeated(gameRoom: GameRoom, permId: PermanentId): boolean {
    const seating = gameRoom.seating
    return Array.isArray(seating) && seating.includes(permId)
}

export function getRoomRole(gameRoom: GameRoom, permId: PermanentId): RoomRole | null {
    return gameRoom.roles[permId] ?? null
}

/**
 * The permIds in a room, optionally filtered on a specific role
 */
export function getRoomPermIds(gameRoom: GameRoom, role?: RoomRole): PermanentId[] {
    let permIds = Object.keys(gameRoom.roles)
    if (role) {
        permIds = permIds.filter(permId => gameRoom.roles[permId] === role)
    }
    return permIds
}

/**
 * Is there physically room for this permId in that role ?
 * This is the involuntary rule, used both to assign a role on join and as a part
 * of the voluntary canTakeRoomRole guard.
 */
function hasRoomForRole(gameRoom: GameRoom, permId: PermanentId, role: RoomRole): boolean {
    if (role != RoomRole.Player) {
        return true
    }
    if (gameRoom.isStarted) {
        // Started games only accept players existing in the seating
        return isSeated(gameRoom, permId)
    }
    // Pending games accept new players up until MAX_PLAYERS
    return (
        getRoomPermIds(gameRoom, RoomRole.Player).length < MAX_PLAYERS ||
        gameRoom.roles[permId] === RoomRole.Player
    )
}

/**
 * Can this user deliberately move to that role ?
 */
export function canTakeRoomRole(gameRoom: GameRoom, permId: PermanentId, role: RoomRole): boolean {
    // Seats are locked once the game is started
    if (gameRoom.isStarted) {
        return false
    }
    // A competing player of a saved game must stay at the table, else the game
    // could never be resumed ( see the missingSavedGamePlayers getter )
    if (
        role != RoomRole.Player &&
        gameRoom.isSavedGame &&
        gameRoom.competingPlayers.includes(permId)
    ) {
        return false
    }
    return hasRoomForRole(gameRoom, permId, role)
}

/**
 * Which role should this user get when joining, or when a presence event fires ?
 *
 * A judge or a spectator keeps their role while offline ( see releaseRoomRole ), so a
 * reconnection is simply resolved by the role they already hold.
 */
export function resolveRoomRole(gameRoom: GameRoom, permId: PermanentId): RoomRole {
    // Already holding a role : keep it ( reconnection, idempotent rejoin, late presence )
    const currentRole = getRoomRole(gameRoom, permId)
    if (currentRole) {
        return currentRole
    }
    return hasRoomForRole(gameRoom, permId, RoomRole.Player) ? RoomRole.Player : RoomRole.Spectator
}

/**
 * Drop this permId from the turn order seating.
 * Only for a deliberate move out of the player role : a player who merely disconnected
 * keeps their position, so they can reconnect into it.
 */
export function removeFromSeating(gameRoom: GameRoom, permId: PermanentId) {
    const seating = gameRoom.seating
    if (!Array.isArray(seating)) {
        return
    }

    const index = seating.indexOf(permId)
    if (index > -1) {
        seating.splice(index, 1)
    }

    // If seating is now empty, restore EMPTY marker (RTDB wipes empty arrays)
    if (seating.length === 0) {
        gameRoom.seating = EMPTY_SEATING
    }
}

/**
 * Handle a user disconnecting from the room, without touching the seating.
 *
 * Only the player role is released. A player means "at the table and connected" : it
 * feeds the MAX_PLAYERS cap, isSeatingReady and the readiness getters, so a ghost there
 * would block the game start.
 *
 * Judges and spectators keep their role while offline, so they get it back on
 * reconnection without needing any client-side memory. Nothing gates on their count, and
 * every getter maps them through the known users, so an offline one doesn't show up.
 */
export function releaseRoomRole(gameRoom: GameRoom, permId: PermanentId): boolean {
    if (gameRoom.roles[permId] === RoomRole.Player) {
        delete gameRoom.roles[permId]
        return true
    }
    return false
}

/**
 * Move a user to a role, exclusively
 */
export function applyRoomRole(gameRoom: GameRoom, permId: PermanentId, role: RoomRole) {
    // Never touch the map on a no-op : the host watcher is deep, it would broadcast the
    // whole room metadata to RTDB for nothing on every presence event.
    if (getRoomRole(gameRoom, permId) == role) {
        return
    }

    if (role != RoomRole.Player) {
        // Leaving the table : give up the turn order position
        removeFromSeating(gameRoom, permId)
    }
    gameRoom.roles[permId] = role
}

/**
 * The players to seat when rolling seating. Judges and spectators never get a seat.
 */
export function getSeatingCandidates(gameRoom: GameRoom): PermanentId[] {
    // Returns a new array : shuffleArray shuffles in place, and we don't want
    // the seating to end up aliasing anything internal.
    return getRoomPermIds(gameRoom, RoomRole.Player)
}
