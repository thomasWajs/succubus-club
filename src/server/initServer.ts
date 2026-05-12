// Register server code into shared functions
import { registerGameState, registerLogger, setGameResources } from '@/shared/registries.ts'
import { initWasmHasher } from '@/shared/serialization.ts'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { initTables, loadPersistedData } from './persistence.ts'
import { restoreRooms } from './rooms.ts'
import logger from './logger.ts'
import { captureException, captureMessage } from './logging.ts'

export async function initServer() {
    registerLogger({ captureException, captureMessage })
    await initWasmHasher()
    loadCardbase()
    initTables()
    restorePersistedData()
}

function loadCardbase() {
    const cardbasePath = resolve('../../public/assets/cardbase.json')
    const cardbase = JSON.parse(readFileSync(cardbasePath, 'utf-8'))
    setGameResources('cardbase', cardbase)
    logger.info('Cardbase loaded')
}

function restorePersistedData() {
    const { rooms, gameStates } = loadPersistedData()

    restoreRooms(rooms)

    // Register game states in the registry
    for (const gameState of gameStates) {
        registerGameState(gameState.gameId, gameState)
    }
}
