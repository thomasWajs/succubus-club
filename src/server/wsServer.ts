import 'instrument'

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
import { generateClientOid } from '@/shared/state/ids.ts'
import { getUser, handleSetUser, removeUser } from './users.ts'
import { captureException } from './logging.ts'
import logger from './logger.ts'

// Track all active connections
const connections = new Map<ClientId, ConnectionInfo>()

export let wsServer = new WebSocketServer({ noServer: true })

/**
 * Handle new client connections
 */
wsServer.on('connection', (webSocket: WebSocket, req) => {
    const remoteAddress =
        (req.headers['x-real-ip'] as string) ??
        req.headers['x-forwarded-for']?.toString().split(',')[0].trim() ??
        req.socket.remoteAddress

    logger.info('New client connected : ' + remoteAddress)

    const clientId = generateClientOid()

    // Initialize connection info
    connections.set(clientId, {
        clientId,
        webSocket,
        remoteAddress,
        permId: '', // Will be set on setUser
        roomId: null, // Will be set on joinRoom
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

            logger.debug(`Received message: ${JSON.stringify(message)}`)

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

                case MultiplayerMessageType.Deck:
                    await handleDeck(connection, message)
                    break

                case MultiplayerMessageType.RollSeating:
                    await handleRollSeating(connection)
                    break

                case MultiplayerMessageType.SetupGame:
                    await handleSetupGame(connection)
                    break

                case MultiplayerMessageType.GameMutation:
                    await handleGameMutation(connection, message)
                    break

                case MultiplayerMessageType.ShuffleCardRegion:
                    await handleShuffleCardRegion(connection, message)
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
