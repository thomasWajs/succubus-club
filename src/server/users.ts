import { createHash, timingSafeEqual } from 'node:crypto'
import { PermanentId, SetUserMessage, User } from '@/shared/types/multiplayer.ts'
import { ConnectionInfo } from './types.ts'
import logger from './logger.ts'
import { loadUserSecretHash, saveUserSecretHash, touchUserSecret } from './persistence.ts'

// Track active users
const users = new Map<PermanentId, User>()
const userConnections = new Map<PermanentId, ConnectionInfo>()

const MIN_SECRET_LENGTH = 16
const MAX_SECRET_LENGTH = 256

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

// Trust on first use: the first secret presented with a permId is persisted (hashed) and then
// required for it. The permId is public (shared with the other clients), the secret is not.
function verifySecret(permId: PermanentId, secret: unknown) {
    if (
        typeof secret !== 'string' ||
        secret.length < MIN_SECRET_LENGTH ||
        secret.length > MAX_SECRET_LENGTH
    ) {
        throw new Error('Missing or invalid user secret')
    }

    const hash = createHash('sha256').update(secret).digest()
    const knownHex = loadUserSecretHash(permId)
    if (!knownHex) {
        saveUserSecretHash(permId, hash.toString('hex'))
    } else if (!timingSafeEqual(hash, Buffer.from(knownHex, 'hex'))) {
        throw new Error(`User ${permId} already exists`)
    } else {
        touchUserSecret(permId)
    }
}

/**
 * Handle user setting its data.
 * Returns the previous connection of this user when the new one replaced it,
 * so the caller can dispose of it.
 */
export async function handleSetUser(
    connection: ConnectionInfo,
    message: SetUserMessage,
): Promise<ConnectionInfo | undefined> {
    const { permId, name, isReady, secret } = message

    if (connection.permId && connection.permId != permId) {
        throw new Error(`Connection is already set for another user : ${connection.permId}`)
    }

    // Only the holder of the secret can speak as this permId
    verifySecret(permId, secret)

    // The identity is proven: if an older connection still holds this permId,
    // it is stale (not correctly disconnected), so the new one takes over.
    let replacedConnection: ConnectionInfo | undefined
    if (connection.permId == '') {
        const oldConnection = userConnections.get(permId)
        if (oldConnection && oldConnection !== connection) {
            replacedConnection = oldConnection
        }
        removeUser(permId)
    }

    const user = { permId, name, isReady, avatarId: null }
    upsertUser(permId, user, connection)
    logger.info(`Player ${name} set their data.`)

    return replacedConnection
}
