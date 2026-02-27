import { WebSocket } from 'ws'
import { PermanentId, RoomId } from '@/shared/types/multiplayer.ts'
import {
    ConnectionInfo,
    JoinRoomMessage,
    LeaveRoomMessage,
    RoomStateMessage,
    ServerMessage,
} from '@/shared/types/server.ts'
import { send, sendError } from './index.ts'

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
 * Get or create a room
 */
function getOrCreateRoom(roomId: RoomId): Room {
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
 * Handle player joining a room
 */
export async function handleJoinRoom(
    ws: WebSocket,
    message: JoinRoomMessage,
    connections: Map<WebSocket, ConnectionInfo>,
) {
    const { roomId, userId, userName } = message

    // Update connection info
    const connInfo = connections.get(ws)
    if (!connInfo) {
        sendError(ws, 'Connection not found')
        return
    }

    connInfo.userId = userId
    connInfo.userName = userName
    connInfo.roomId = roomId

    // Add player to room
    const room = getOrCreateRoom(roomId)
    room.players.set(userId, { ws, userName })

    console.log(`Player ${userName} joined room ${roomId}`)

    // Broadcast updated room state to all players in the room
    broadcastRoomState(room)
}

/**
 * Handle player leaving a room
 */
export async function handleLeaveRoom(
    ws: WebSocket,
    message: LeaveRoomMessage,
    connections: Map<WebSocket, ConnectionInfo>,
) {
    console.log(message)

    const connInfo = connections.get(ws)
    if (!connInfo || !connInfo.roomId) {
        sendError(ws, 'Not in a room')
        return
    }

    const room = rooms.get(connInfo.roomId)
    if (!room) {
        sendError(ws, 'Room not found')
        return
    }

    // Remove player from room
    room.players.delete(connInfo.userId)
    connInfo.roomId = null

    console.log(`Player ${connInfo.userName} left room ${room.id}`)

    // If room is empty, delete it
    if (room.players.size === 0) {
        rooms.delete(room.id)
        console.log(`Deleted empty room: ${room.id}`)
    } else {
        // Broadcast updated room state
        broadcastRoomState(room)
    }
}

/**
 * Handle player disconnection
 */
export function handleDisconnect(ws: WebSocket, connections: Map<WebSocket, ConnectionInfo>) {
    const connInfo = connections.get(ws)
    if (!connInfo || !connInfo.roomId) {
        return
    }

    const room = rooms.get(connInfo.roomId)
    if (!room) {
        return
    }

    // Remove player from room
    room.players.delete(connInfo.userId)

    console.log(`Player ${connInfo.userName} disconnected from room ${room.id}`)

    // If room is empty, delete it
    if (room.players.size === 0) {
        rooms.delete(room.id)
        console.log(`Deleted empty room: ${room.id}`)
    } else {
        // Broadcast updated room state
        broadcastRoomState(room)
    }
}

/**
 * Broadcast a message to all players in a room
 */
export function broadcast(roomId: RoomId, message: ServerMessage) {
    const room = rooms.get(roomId)
    if (!room) {
        console.error(`Room not found: ${roomId}`)
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
        roomId: room.id,
        players,
        isStarted: room.isStarted,
    }

    for (const player of room.players.values()) {
        send(player.ws, message)
    }
}

/**
 * Get room by ID
 */
export function getRoom(roomId: RoomId): Room | undefined {
    return rooms.get(roomId)
}

/**
 * Get all rooms (for debugging/admin)
 */
export function getAllRooms(): Room[] {
    return Array.from(rooms.values())
}
