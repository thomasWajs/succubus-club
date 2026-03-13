// Register server code into shared functions
import { registerGameState, setGameResources } from '@/shared/registries.ts'
import { initWasmHasher } from '@/shared/serialization.ts'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { initTables, loadPersistedData } from './persistence.ts'
import { restoreRooms } from './rooms.ts'

export function initServer() {
    //registerMutationTrigger({ act, actSelf })

    initWasmHasher()
    loadCardbase()
    initTables()
    restorePersistedData()
}

function loadCardbase() {
    const cardbasePath = resolve('../../public/assets/cardbase.json')
    const cardbase = JSON.parse(readFileSync(cardbasePath, 'utf-8'))
    setGameResources('cardbase', cardbase)
}

function restorePersistedData() {
    const { rooms, gameStates } = loadPersistedData()

    restoreRooms(rooms)

    // Register game states in the registry
    for (const gameState of gameStates) {
        registerGameState(gameState.gameId, gameState)
    }
}
