import { nanoid } from 'nanoid'

function generateId() {
    return nanoid()
}

export function generateRoomId() {
    return `room-${generateId()}`
}

export function generateClientId() {
    return `client-${generateId()}`
}

export function generateGameId() {
    return `game-${generateId()}`
}

export function generateCardOid() {
    return `card-${generateId()}`
}

export function generateCardRegionOid() {
    return `cardRegion-${generateId()}`
}

export function generatePlayerOid() {
    return `player-${generateId()}`
}
