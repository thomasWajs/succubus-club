import { getRtdb, rtdbRef, rtdbGet, rtdbRemove, rtdbSet } from '@/gateway/realtime.ts'
import { useCoreStore } from '@/store/core.ts'
import { cborDecoder, cborEncoder, hashObject, SerializedGame } from '@/gateway/serialization.ts'

const GAME_STATE_KEY = 'gameStates'
const GAME_STATE_STORAGE_DURATION = 1000 * 30

function getGameStatePath(gameHash: number) {
    return `${GAME_STATE_KEY}/${useCoreStore().userProfile.permanentId}-${gameHash}`
}

export async function storeGameState(serializedGame: SerializedGame) {
    const gameHash = hashObject(serializedGame)
    const gameStatePath = getGameStatePath(gameHash)
    const encodedGame = cborEncoder.encode(serializedGame).toBase64()
    await rtdbSet(rtdbRef(getRtdb(), gameStatePath), encodedGame)
    return gameStatePath
}

// Store the gameState, then delete it after a while
export async function storeGameStateTemp(serializedGame: SerializedGame) {
    const gameStatePath = await storeGameState(serializedGame)
    setTimeout(() => {
        rtdbRemove(rtdbRef(getRtdb(), gameStatePath))
    }, GAME_STATE_STORAGE_DURATION)
    return gameStatePath
}

export async function fetchGameState(gameStatePath: string): Promise<SerializedGame | null> {
    const fetched = (await rtdbGet(rtdbRef(getRtdb(), gameStatePath))).val()
    if (fetched) {
        return cborDecoder.decode(Uint8Array.fromBase64(fetched)) as SerializedGame
    }
    return null
}
