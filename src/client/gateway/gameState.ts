import {
    fsBytes,
    fsCollection,
    fsDeleteDoc,
    fsDoc,
    fsGetDoc,
    fsSetDoc,
    fsTimestamp,
    getFirestore,
} from '@/client/gateway/realtime.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { cborDecoder, cborEncoder } from '@/client/gateway/serialization.ts'
import { SerializedMultiplayerGame } from '@/shared/types/multiplayer.ts'
import { hashObject } from '@/shared/serialization.ts'
import * as logging from '@/client/logging.ts'
import { useBusStore } from '@/client/store/bus.ts'

type GameStateDoc = {
    encodedGame: fsBytes
    ttl: fsTimestamp
}

const GAME_STATE_KEY = 'gameStates'
const GAME_STATE_STORAGE_DURATION = 1000 * 60

const gameStateCollection = fsCollection(getFirestore(), GAME_STATE_KEY)

/*
function getGameStatePath(gameHash: number) {
    return `${GAME_STATE_KEY}/${useCoreStore().userProfile.permanentId}-${gameHash}`
}
 */

export async function storeGameState(serializedGame: SerializedMultiplayerGame) {
    const gameHash = hashObject(serializedGame)
    const gameStateId = `${useCoreStore().userProfile.permanentId}-${gameHash}`
    const encodedGame = cborEncoder.encode(serializedGame)
    const gameStateDoc: GameStateDoc = {
        encodedGame: fsBytes.fromUint8Array(encodedGame),
        ttl: fsTimestamp.fromMillis(Date.now() + GAME_STATE_STORAGE_DURATION),
    }
    await fsSetDoc(fsDoc(gameStateCollection, gameStateId), gameStateDoc)

    // Delete the game state after a while
    setTimeout(() => {
        fsDeleteDoc(fsDoc(gameStateCollection, gameStateId))
    }, GAME_STATE_STORAGE_DURATION)

    return gameStateId

    // UInt8Array.toBase64 is not widespread enough for now,
    // and I don't want to setup a polyfill just for this.
    /*
    const gameHash = hashObject(serializedGame)
    const gameStatePath = getGameStatePath(gameHash)
    const encodedGame = cborEncoder.encode(serializedGame).toBase64()
    const gameStateDoc: GameStateDoc = {
        encodedGame: encodedGame.toBase64(),
        ttl: fsTimestamp.fromMillis(Date.now() + GAME_STATE_STORAGE_DURATION),
    }
    await rtdbSet(rtdbRef(getRtdb(), gameStatePath), encodedGame)

    // Delete the game state after a while
    setTimeout(() => {
        rtdbRemove(rtdbRef(getRtdb(), gameStatePath))
    }, GAME_STATE_STORAGE_DURATION)

    return gameStatePath
     */
}

export async function fetchGameState(gameStateId: string): Promise<SerializedMultiplayerGame> {
    const gameStateDoc = fsDoc(gameStateCollection, gameStateId)
    const snapshot = await fsGetDoc(gameStateDoc)

    let serializedGame = null
    if (snapshot.exists()) {
        try {
            const gameStateDoc = snapshot.data() as GameStateDoc
            serializedGame = cborDecoder.decode(
                // Firestore returns a view with a byteOffset > 0
                // .slice() with no args always returns a fresh, offset-0 copy
                gameStateDoc.encodedGame.toUint8Array().slice(),
            ) as SerializedMultiplayerGame
        } catch (error) {
            logging.captureException(error)
        }
    }

    if (!serializedGame) {
        useBusStore().alertError('An error occurred while retreiving the game state')
        throw new Error(`Failed to fetch game state ${gameStateId}`)
    }

    return serializedGame

    // UInt8Array.fromBase64 is not widespread enough for now,
    // and I don't want to setup a polyfill just for this.
    /*
    const fetched = (await rtdbGet(rtdbRef(getRtdb(), gameStateId))).val()
    if (fetched) {
        return cborDecoder.decode(Uint8Array.fromBase64(fetched.encodedGame)) as SerializedGame
    }
    return null

     */
}
