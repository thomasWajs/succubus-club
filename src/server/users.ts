import { PermanentId, SetUserMessage, User } from '@/shared/types/multiplayer.ts'
import { ConnectionInfo } from './types.ts'
import logger from './logger.ts'

// Track active users
const users = new Map<PermanentId, User>()
const userConnections = new Map<PermanentId, ConnectionInfo>()

export function getUser(permId: PermanentId) {
    return users.get(permId)
}

export function getUserConnection(permId: PermanentId) {
    return userConnections.get(permId)
}

function upsertUser(permId: PermanentId, user: User, connection: ConnectionInfo) {
    connection.permId = permId
    users.set(permId, user)
    userConnections.set(permId, connection)
}

export function removeUser(permId: PermanentId) {
    users.delete(permId)
    userConnections.delete(permId)
}

/**
 * Handle user setting its data
 */
export async function handleSetUser(connection: ConnectionInfo, message: SetUserMessage) {
    const { permId, name, isReady } = message

    if (connection.permId && connection.permId != permId) {
        throw new Error(`Connection is already set for another user : ${connection.permId}`)
    }

    if (connection.permId == '' && (users.has(permId) || userConnections.has(permId))) {
        const oldConnectionInfo = userConnections.get(permId)
        // Remote adresses are the same, assume the user were not correctly disconnected and is connecting back.
        if (connection.remoteAddress == oldConnectionInfo?.remoteAddress) {
            // Clean the old state
            removeUser(permId)
        } else {
            // Remote adresses differs, that seems suspicious, reject the connection
            throw new Error(`User ${permId} already exists`)
        }
    }

    const user = { permId, name, isReady, avatarId: null }
    upsertUser(permId, user, connection)
    logger.info(`Player ${name} set their data.`)
}
