import { nanoid } from 'nanoid'

function generateId() {
    return nanoid()
}

export function generateClientOid() {
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
