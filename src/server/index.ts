import { WebSocket, WebSocketServer } from 'ws'
import { ClientMessage, ConnectionInfo, ErrorMessage, ServerMessage } from '@/shared/types/server'
import { broadcast, handleDisconnect, handleJoinRoom, handleLeaveRoom } from './rooms'
import { handleGameMutation } from './validation'

const PORT = parseInt(process.env.WS_PORT || '3001')

// Track all active connections
const connections = new Map<WebSocket, ConnectionInfo>()

/**
 * Initialize WebSocket Server
 */
const wss = new WebSocketServer({ port: PORT })

console.log(`WebSocket server listening on port ${PORT}`)

/**
 * Handle new client connections
 */
wss.on('connection', (ws: WebSocket) => {
    console.log('New client connected')

    // Initialize connection info
    connections.set(ws, {
        userId: '', // Will be set on joinRoom
        userName: '', // Will be set on joinRoom
        roomId: null,
    })

    /**
     * Handle incoming messages
     */
    ws.on('message', async (data: Buffer) => {
        try {
            const message: ClientMessage = JSON.parse(data.toString())

            console.log(`Received message: ${JSON.stringify(message)}`)

            switch (message.type) {
                // TODO : remove after tests
                case 'publish':
                    const connection = connections.get(ws)
                    if (!connection || !connection.roomId) {
                        break
                    }
                    broadcast(connection.roomId, message)
                    break

                case 'joinRoom':
                    await handleJoinRoom(ws, message, connections)
                    break

                case 'leaveRoom':
                    await handleLeaveRoom(ws, message, connections)
                    break

                case 'gameMutation':
                    await handleGameMutation(ws, message, connections)
                    break

                case 'chat':
                    // TODO: Implement chat handling
                    console.log('Chat message received:', message.text)
                    break

                case 'requestState':
                    // TODO: Implement state sync
                    console.log('State request received for room:', message.roomId)
                    break

                default:
                    sendError(ws, `Unknown message type: ${(message as any).type}`)
            }
        } catch (error) {
            console.error('Error handling message:', error)
            sendError(ws, 'Failed to process message')
        }
    })

    /**
     * Handle client disconnection
     */
    ws.on('close', () => {
        console.log('Client disconnected')
        const connInfo = connections.get(ws)
        if (connInfo) {
            handleDisconnect(ws, connections)
        }
        connections.delete(ws)
    })

    /**
     * Handle errors
     */
    ws.on('error', error => {
        console.error('WebSocket error:', error)
    })
})

/**
 * Handle server errors
 */
wss.on('error', error => {
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
    wss.close(() => {
        console.log('Server closed')
        process.exit(0)
    })
})

process.on('SIGTERM', () => {
    console.log('\nShutting down server...')
    wss.close(() => {
        console.log('Server closed')
        process.exit(0)
    })
})
