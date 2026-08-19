import { MAX_PLAYERS } from '@/shared/const/model.ts'
import {
    EMPTY_SEATING,
    GameRoom,
    PermanentId,
    RoomSeat,
    RoomSeats,
} from '@/shared/types/multiplayer.ts'

/**
 * Room seats : where a user sits in a game room, before the game starts.
 *
 * Every seat write must go through applyRoomSeat / releaseRoomSeat, so that the three
 * seat arrays of a GameRoom stay mutually exclusive.
 *
 * These helpers are pure ( GameRoom in, GameRoom out ) so the SCS server can use them too.
 */

// In display order
export const ROOM_SEATS = [RoomSeat.Player, RoomSeat.Judge, RoomSeat.Spectator]

function seatArray(gameRoom: GameRoom, seat: RoomSeat): PermanentId[] {
    switch (seat) {
        case RoomSeat.Player:
            return gameRoom.players
        case RoomSeat.Judge:
            return gameRoom.judges
        case RoomSeat.Spectator:
            return gameRoom.spectators
    }
}

/**
 * Is this permId in the turn order seating ?
 * Never test gameRoom.seating.includes() directly : seating can be the EMPTY_SEATING
 * marker string, on which includes() silently becomes a substring match.
 */
export function isSeated(gameRoom: GameRoom, permId: PermanentId): boolean {
    const seating = gameRoom.seating
    return Array.isArray(seating) && seating.includes(permId)
}

export function getRoomSeat(gameRoom: GameRoom, permId: PermanentId): RoomSeat | null {
    return ROOM_SEATS.find(seat => seatArray(gameRoom, seat).includes(permId)) ?? null
}

export function getRoomPermIds(gameRoom: GameRoom): PermanentId[] {
    return ROOM_SEATS.flatMap(seat => seatArray(gameRoom, seat))
}

/**
 * Flatten the three seat arrays into a permId -> seat map, to hand over to the SCS server.
 */
export function getRoomSeats(gameRoom: GameRoom): RoomSeats {
    const seats: RoomSeats = {}
    for (const seat of ROOM_SEATS) {
        for (const permId of seatArray(gameRoom, seat)) {
            // First seat wins, to keep the same precedence as getRoomSeat, in case a
            // room broadcast by an older client holds the same permId twice.
            seats[permId] ??= seat
        }
    }
    return seats
}

/**
 * Is there physically room for this permId in that seat ?
 * This is the involuntary rule, used both to assign a seat on join and as a part
 * of the voluntary canTakeRoomSeat guard.
 */
function hasRoomForSeat(gameRoom: GameRoom, permId: PermanentId, seat: RoomSeat): boolean {
    if (seat != RoomSeat.Player) {
        return true
    }
    if (gameRoom.isStarted) {
        // Started games only accept players existing in the seating
        return isSeated(gameRoom, permId)
    }
    // Pending games accept new players up until MAX_PLAYERS
    return gameRoom.players.length < MAX_PLAYERS || gameRoom.players.includes(permId)
}

/**
 * Can this user deliberately move to that seat ?
 */
export function canTakeRoomSeat(gameRoom: GameRoom, permId: PermanentId, seat: RoomSeat): boolean {
    // Seats are locked once the game is started
    if (gameRoom.isStarted) {
        return false
    }
    // A competing player of a saved game must stay at the table, else the game
    // could never be resumed ( see the missingSavedGamePlayers getter )
    if (
        seat != RoomSeat.Player &&
        gameRoom.isSavedGame &&
        gameRoom.competingPlayers.includes(permId)
    ) {
        return false
    }
    return hasRoomForSeat(gameRoom, permId, seat)
}

/**
 * Which seat should this user get when joining, or when a presence event fires ?
 *
 * A judge or a spectator keeps their seat while offline ( see releaseRoomSeat ), so a
 * reconnection is simply resolved by the seat they already hold.
 */
export function resolveRoomSeat(gameRoom: GameRoom, permId: PermanentId): RoomSeat {
    // Already holding a seat : keep it ( reconnection, idempotent rejoin, late presence )
    const currentSeat = getRoomSeat(gameRoom, permId)
    if (currentSeat) {
        return currentSeat
    }
    return hasRoomForSeat(gameRoom, permId, RoomSeat.Player) ? RoomSeat.Player : RoomSeat.Spectator
}

/**
 * Drop this permId from the turn order seating.
 * Only for a deliberate move out of the player seat : a player who merely disconnected
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
 * Drop a permId from every seat, to keep the three seats mutually exclusive.
 */
function clearRoomSeats(gameRoom: GameRoom, permId: PermanentId) {
    // Loop over every seat rather than just getRoomSeat's : a room broadcast by an
    // older client could hold the same permId twice.
    for (const seat of ROOM_SEATS) {
        const seated = seatArray(gameRoom, seat)
        const index = seated.indexOf(permId)
        if (index > -1) {
            seated.splice(index, 1)
        }
    }
}

/**
 * Handle a user disconnecting from the room, without touching the seating.
 *
 * Only the player seat is released. players means "at the table and connected" : it
 * feeds the MAX_PLAYERS cap, isSeatingReady and the readiness getters, so a ghost there
 * would block the game start.
 *
 * Judges and spectators keep their seat while offline, so they get it back on
 * reconnection without needing any client-side memory. Nothing gates on their count, and
 * every getter maps them through the known users, so an offline one doesn't show up.
 */
export function releaseRoomSeat(gameRoom: GameRoom, permId: PermanentId): boolean {
    const index = gameRoom.players.indexOf(permId)
    if (index > -1) {
        gameRoom.players.splice(index, 1)
        return true
    }
    return false
}

/**
 * Move a user to a seat, exclusively. Returns false when it changes nothing.
 */
export function applyRoomSeat(gameRoom: GameRoom, permId: PermanentId, seat: RoomSeat): boolean {
    // Never touch the arrays on a no-op : the host watcher is deep, it would
    // broadcast the whole room to RTDB for nothing on every presence event.
    if (getRoomSeat(gameRoom, permId) == seat) {
        return false
    }

    clearRoomSeats(gameRoom, permId)
    if (seat != RoomSeat.Player) {
        // Leaving the table : give up the turn order position
        removeFromSeating(gameRoom, permId)
    }
    seatArray(gameRoom, seat).push(permId)

    return true
}

/**
 * The players to seat when rolling seating. Judges and spectators never get a seat.
 */
export function getSeatingCandidates(gameRoom: GameRoom): PermanentId[] {
    // Returns a new array : shuffleArray shuffles in place, and we don't want
    // the seating to end up aliasing gameRoom.players.
    return gameRoom.players.filter(
        permId => !gameRoom.judges.includes(permId) && !gameRoom.spectators.includes(permId),
    )
}
