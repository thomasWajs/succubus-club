let nextOid: number = 1

function generateId() {
    return `${nextOid++}`
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
