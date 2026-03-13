import { WebSocket, WebSocketServer } from 'ws'
import { handleJoinRoom, handleLeaveRoom, handleSetupGame, leaveRoom, RoomNotFound } from './rooms'
import { handleGameMutation, handleShuffleCardRegion } from './gameState.ts'
import {
    ErrorMessage,
    MultiplayerMessageType,
    ScsClientMessage,
    ScsServerMessage,
} from '@/shared/types/multiplayer.ts'
import { ClientId, ConnectionInfo } from './types.ts'
import { generateClientOid } from '@/shared/state/ids.ts'
import { getUser, handleSetUser, removeUser } from './users.ts'
import { initServer } from './initServer.ts'

initServer()

const PORT = parseInt(process.env.WS_PORT || '3001')

// Track all active connections
const connections = new Map<ClientId, ConnectionInfo>()

/**
 * Initialize WebSocket Server
 */
const wsServer = new WebSocketServer({ port: PORT })

console.log(`WebSocket server listening on port ${PORT}`)

/**
 * Handle new client connections
 */
wsServer.on('connection', (webSocket: WebSocket) => {
    console.log('New client connected')

    const clientId = generateClientOid()

    // Initialize connection info
    connections.set(clientId, {
        clientId,
        webSocket,
        permId: '', // Will be set on joinRoom
        roomId: null,
    })

    /**
     * Handle incoming messages
     */
    webSocket.on('message', async (data: Buffer) => {
        try {
            const message: ScsClientMessage = JSON.parse(data.toString())

            const connection = connections.get(clientId)
            if (!connection) {
                return
            }

            console.log(`Received message: ${JSON.stringify(message)}`)

            switch (message.type) {
                case MultiplayerMessageType.SetUser:
                    await handleSetUser(connection, message)
                    break

                case MultiplayerMessageType.JoinRoom:
                    await handleJoinRoom(connection, message)
                    break

                case MultiplayerMessageType.LeaveRoom:
                    await handleLeaveRoom(connection)
                    break

                case MultiplayerMessageType.RollSeating:
                    // TODO: Implement RollSeating
                    break

                case MultiplayerMessageType.SetupGame:
                    await handleSetupGame(connection, message)
                    break

                case MultiplayerMessageType.GameMutation:
                    await handleGameMutation(connection, message)
                    break

                case MultiplayerMessageType.ShuffleCardRegion:
                    await handleShuffleCardRegion(connection, message)
                    break

                case MultiplayerMessageType.RequestResync:
                    // TODO: Implement state sync
                    break

                default:
                    sendError(webSocket, `Unknown message type: ${(message as any).type}`)
            }
        } catch (error) {
            if (error instanceof RoomNotFound) {
                console.error('RoomNotFound when handling message:', error)
                sendError(webSocket, 'Not in a game room')
            } else {
                console.error('Error handling message:', error)
                sendError(webSocket, 'Failed to process message')
            }
        }
    })

    /**
     * Handle client disconnection
     */
    webSocket.on('close', () => {
        const connection = connections.get(clientId)
        if (connection) {
            handleDisconnect(connection)
        }
        connections.delete(clientId)
    })

    /**
     * Handle errors
     */
    webSocket.on('error', error => {
        console.error('WebSocket error:', error)
    })
})

/**
 * Handle server errors
 */
wsServer.on('error', error => {
    console.error('Server error:', error)
})

/**
 * Handle player disconnection
 */
export function handleDisconnect(connection: ConnectionInfo) {
    const user = getUser(connection.permId)
    leaveRoom(connection)
    if (user) {
        removeUser(user.permId)
    }
    console.log(`Player ${user?.name} disconnected`)
}

/**
 * Utility: Send message to a client
 */
export function send(webSocket: WebSocket, message: ScsServerMessage) {
    if (webSocket.readyState === WebSocket.OPEN) {
        webSocket.send(JSON.stringify(message))
    }
}

/**
 * Utility: Send error to a client
 */
export function sendError(webSocket: WebSocket, errorMessage: string) {
    const message: ErrorMessage = {
        type: MultiplayerMessageType.Error,
        message: errorMessage,
    }
    send(webSocket, message)
}

/**
 * Graceful shutdown
 */
function gracefulShutdown() {
    console.log('Shutting down server...')
    wsServer.close(() => {
        console.log('Server closed')
        process.exit(0)
    })
}

process.on('SIGINT', gracefulShutdown)
process.on('SIGTERM', gracefulShutdown)
