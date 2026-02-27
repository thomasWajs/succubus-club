import { WebSocket, WebSocketServer } from 'ws'
import { ClientMessage, ErrorMessage, ServerMessage } from '@/shared/types/server'
import { broadcast, handleDisconnect, handleJoinRoom, handleLeaveRoom } from './rooms'
import { handleGameMutation } from './validation'
import { PermanentId, RoomId } from '@/shared/types/multiplayer.ts'

const PORT = parseInt(process.env.WS_PORT || '3001')

/**
 * Internal server types
 */
export type ConnectionInfo = {
    webSocket: WebSocket
    userId: PermanentId
    userName: string
    roomId: RoomId | null
}

// Track all active connections
const connections = new Map<WebSocket, ConnectionInfo>()

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

    // Initialize connection info
    connections.set(webSocket, {
        webSocket,
        userId: '', // Will be set on joinRoom
        userName: '', // Will be set on joinRoom
        roomId: null,
    })

    /**
     * Handle incoming messages
     */
    webSocket.on('message', async (data: Buffer) => {
        try {
            const message: ClientMessage = JSON.parse(data.toString())

            const connection = connections.get(webSocket)
            if (!connection) {
                return
            }

            console.log(`Received message: ${JSON.stringify(message)}`)

            switch (message.type) {
                // TODO : remove after tests
                case 'publish':
                    if (connection.roomId) {
                        broadcast(connection.roomId, message)
                    }
                    break

                case 'joinRoom':
                    await handleJoinRoom(connection, message)
                    break

                case 'leaveRoom':
                    await handleLeaveRoom(connection)
                    break

                case 'gameMutation':
                    await handleGameMutation(connection, message)
                    break

                case 'chat':
                    // TODO: Implement chat handling
                    break

                case 'requestState':
                    // TODO: Implement state sync
                    break

                default:
                    sendError(webSocket, `Unknown message type: ${(message as any).type}`)
            }
        } catch (error) {
            console.error('Error handling message:', error)
            sendError(webSocket, 'Failed to process message')
        }
    })

    /**
     * Handle client disconnection
     */
    webSocket.on('close', () => {
        const connection = connections.get(webSocket)
        if (connection) {
            handleDisconnect(connection)
        }
        connections.delete(webSocket)
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
 * Utility: Send message to a client
 */
export function send(ws: WebSocket, message: ServerMessage) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message))
    }
}

/**
 * Utility: Send error to a client
 */
export function sendError(ws: WebSocket, errorMessage: string) {
    const message: ErrorMessage = {
        type: 'error',
        message: errorMessage,
    }
    send(ws, message)
}

/**
 * Graceful shutdown
 */
process.on('SIGINT', () => {
    console.log('\n⏹Shutting down server...')
    wsServer.close(() => {
        console.log('Server closed')
        process.exit(0)
    })
})

process.on('SIGTERM', () => {
    console.log('\nShutting down server...')
    wsServer.close(() => {
        console.log('Server closed')
        process.exit(0)
    })
})
