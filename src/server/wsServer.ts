import http from 'http'
import { WebSocket, WebSocketServer } from 'ws'
import {
    handleDeck,
    handleJoinRoom,
    handleLeaveRoom,
    handleRollSeating,
    handleSetupGame,
    leaveRoom,
    RoomNotFound,
} from './rooms'

import {
    handleGameMutation,
    handleRandomResultRequest,
    handleRequestResync,
    handleShuffleCardRegion,
    UserNotIdentified,
} from './gameState.ts'
import {
    ErrorMessage,
    MultiplayerMessageType,
    ScsClientMessage,
    ScsServerMessage,
} from '@/shared/types/multiplayer.ts'
import { ClientId, ConnectionInfo } from './types.ts'
import { generateClientId } from '@/shared/state/ids.ts'
import { getUser, handleSetUser, removeUser } from './users.ts'
import { captureException } from './capture.ts'
import logger from './logger.ts'
import { cleanupOldGames } from './persistence.ts'

const PORT = parseInt(process.env.SCS_PORT ?? '3001')

const SETUSER_TIMEOUT_MS = 30_000 // 30 seconds

// Track all active connections
const connections = new Map<ClientId, ConnectionInfo>()

const server = http.createServer()
export let wsServer = new WebSocketServer({ server })

/**
 * Handle new client connections
 */
wsServer.on('connection', (webSocket: WebSocket, req) => {
    const remoteAddress =
        (req.headers['x-real-ip'] as string) ??
        req.headers['x-forwarded-for']?.toString().split(',')[0].trim() ??
        req.socket.remoteAddress

    logger.info('New client connected : ' + remoteAddress)

    const clientId = generateClientId()

    // Initialize connection info
    connections.set(clientId, {
        clientId,
        webSocket,
        remoteAddress,
        permId: '', // Will be set on setUser
        roomId: null, // Will be set on joinRoom
    })

    // Client must send a SetUser message promptly, or get disconnected
    let setUserTimeout: ReturnType<typeof setTimeout> | null = null
    setUserTimeout = setTimeout(() => {
        const connection = connections.get(clientId)
        if (connection && !connection.permId) {
            logger.info(`Disconnecting client ${clientId} - no SetUser received within 30s`)

            handleDisconnect(connection)

            try {
                webSocket.close(1002, 'SetUser timeout')
            } catch {}

            connections.delete(clientId)
        }
    }, SETUSER_TIMEOUT_MS).unref() // .unref() prevents keeping process alive

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

            logger.debug(`Received message: ${JSON.stringify(message)}`)

            switch (message.type) {
                case MultiplayerMessageType.SetUser:
                    // Clear timeout - user identified!
                    if (setUserTimeout) {
                        clearTimeout(setUserTimeout)
                        setUserTimeout = null
                    }

                    await handleSetUser(connection, message)

                    // A cron-job could call the cleanup periodically.
                    // For now, just clean on every user connection.
                    cleanupOldGames()

                    break

                case MultiplayerMessageType.JoinRoom:
                    await handleJoinRoom(connection, message)
                    break

                case MultiplayerMessageType.LeaveRoom:
                    await handleLeaveRoom(connection)
                    break

                case MultiplayerMessageType.Deck:
                    await handleDeck(connection, message)
                    break

                case MultiplayerMessageType.RollSeating:
                    await handleRollSeating(connection, message)
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
                case MultiplayerMessageType.RandomResultRequest:
                    await handleRandomResultRequest(connection, message)
                    break
                case MultiplayerMessageType.RequestResync:
                    handleRequestResync(connection)
                    break

                default:
                    sendError(webSocket, `Unknown message type: ${(message as any).type}`)
            }
        } catch (error) {
            if (error instanceof RoomNotFound) {
                sendError(webSocket, 'Not in a game room')
            } else if (error instanceof UserNotIdentified) {
                sendError(webSocket, 'User is not identified')
            } else {
                captureException(error)
                sendError(webSocket, `${error}`)
            }
        }
    })

    /**
     * Handle client disconnection
     */
    webSocket.on('close', () => {
        if (setUserTimeout) {
            clearTimeout(setUserTimeout)
        }

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
        captureException(error)
    })
})

/**
 * Handle server errors
 */
wsServer.on('error', error => {
    captureException(error)
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
    logger.info(`Player ${user?.name} disconnected`)
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
 * Start listening
 */
export function startWsServer() {
    server.listen(PORT)
    logger.info(`WebSocket server listening on port ${PORT}`)
}

/**
 * Graceful shutdown
 */
export async function stopWsServer() {
    await new Promise<void>((resolve, reject) => {
        wsServer.close(err => {
            if (err) reject(err)
            else {
                logger.info(`Websocket server closed`)
                resolve()
            }
        })
    })
}
