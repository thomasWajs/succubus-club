import { PermanentId, SetUserMessage, User } from '@/shared/types/multiplayer.ts'
import { ConnectionInfo } from './types.ts'

// Track active users
const users = new Map<PermanentId, User>()
const userConnections = new Map<PermanentId, ConnectionInfo>()

export function getUser(permId: PermanentId) {
    return users.get(permId)
}

export function getUserConnection(permId: PermanentId) {
    return userConnections.get(permId)
}

export function addUser(permId: PermanentId, user: User, connection: ConnectionInfo) {
    users.set(permId, user)
    userConnections.set(permId, connection)
}

export function removeUser(permId: PermanentId) {
    users.delete(permId)
}

/**
 * Handle user setting its data
 */
export async function handleSetUser(connection: ConnectionInfo, message: SetUserMessage) {
    const { permId, name, deckList, isReady } = message
    connection.permId = permId
    const user = { permId, name, deckList, isReady, avatarId: null }
    addUser(permId, user, connection)
    console.log(`Player ${name} set their data.`)
}
