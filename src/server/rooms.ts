import { WebSocket } from 'ws'
import { PermanentId, RoomId } from '@/shared/types/multiplayer.ts'
import { JoinRoomMessage, RoomStateMessage, ServerMessage } from '@/shared/types/server.ts'
import { ConnectionInfo, send } from './index.ts'
import { deleteGameState } from './state.ts'

/**
 * Room structure
 */
type Room = {
    id: RoomId
    players: Map<PermanentId, { ws: WebSocket; userName: string }>
    isStarted: boolean
    createdAt: Date
}

// Active rooms
const rooms = new Map<RoomId, Room>()

/**
 * Get room by ID
 */
export function getRoom(roomId: RoomId | null): Room | undefined {
    if (!roomId) {
        return undefined
    }
    return rooms.get(roomId)
}

/**
 * Get or create a room
 */
export function getOrCreateRoom(roomId: RoomId): Room {
    let room = rooms.get(roomId)
    if (!room) {
        room = {
            id: roomId,
            players: new Map(),
            isStarted: false,
            createdAt: new Date(),
        }
        rooms.set(roomId, room)
        console.log(`Created room: ${roomId}`)
    }
    return room
}

/**
 * Get all rooms (for debugging/admin)
 */
export function getAllRooms(): Room[] {
    return Array.from(rooms.values())
}

/**
 * Leave Room
 */
export function leaveRoom(connection: ConnectionInfo): Room | undefined {
    const room = getRoom(connection.roomId)
    if (!room) {
        return
    }

    // Remove player from room
    room.players.delete(connection.userId)

    // If room is empty, delete it
    if (room.players.size === 0) {
        deleteGameState(room.id)
        rooms.delete(room.id)
        console.log(`Deleted empty room: ${room.id}`)
    } else {
        // Broadcast updated room state
        broadcastRoomState(room)
    }
}

/**
 * Handle player joining a room
 */
export async function handleJoinRoom(connection: ConnectionInfo, message: JoinRoomMessage) {
    const { roomId, userId, userName } = message

    // Update connection info
    connection.userId = userId
    connection.userName = userName
    connection.roomId = roomId

    // Add player to room
    const room = getOrCreateRoom(roomId)
    room.players.set(userId, { ws: connection.webSocket, userName })

    console.log(`Player ${userName} joined room ${roomId}`)

    // Broadcast updated room state to all players in the room
    broadcastRoomState(room)
}

/**
 * Handle player leaving a room
 */
export async function handleLeaveRoom(connection: ConnectionInfo) {
    leaveRoom(connection)
    connection.roomId = null
    console.log(`Player ${connection.userName} left room ${connection.roomId}`)
}

/**
 * Handle player disconnection
 */
export function handleDisconnect(connection: ConnectionInfo) {
    leaveRoom(connection)
    console.log(`Player ${connection.userName} disconnected`)
}

/**
 * Broadcast a message to all players in a room
 */
export function broadcast(roomId: RoomId, message: ServerMessage) {
    const room = getRoom(roomId)
    if (!room) {
        return
    }

    for (const player of room.players.values()) {
        send(player.ws, message)
    }
}

/**
 * Broadcast room state to all players in the room
 */
function broadcastRoomState(room: Room) {
    const players = Array.from(room.players.entries()).map(([userId, player]) => ({
        userId,
        userName: player.userName,
    }))

    const message: RoomStateMessage = {
        type: 'roomState',
        players,
        isStarted: room.isStarted,
    }

    for (const player of room.players.values()) {
        send(player.ws, message)
    }
}
