import { useGameStateStore } from '@/client/store/gameState.ts'
import { Card } from '@/shared/model/Card.ts'

import { useHistoryStore } from '@/client/store/history.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { CborDecoderBase, CborEncoder } from '@jsonjoy.com/json-pack/lib/cbor'
import {
    PackedLogEntry,
    SerializedGame,
    SerializedHistory,
    SerializedMultiplayerGame,
} from '@/shared/types/multiplayer.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { PlayerVision } from '@/shared/types/state.ts'
import { GAME_STATE_VERSION } from '@/shared/const/multiplayer.ts'
import {
    deserializeGameState,
    deserializeObject,
    deserializeValueRecursive,
    serializeGameState,
    serializeObject,
    serializeValueRecursive,
} from '@/shared/serialization.ts'
import { GameState } from '@/shared/state/gameState.ts'

export function serializeHistory(): SerializedHistory {
    const history = useHistoryStore()

    // Compress strings into a string pool
    const stringPool: string[] = []
    const stringToId = new Map<string, number>()
    const internString = (str: string): number => {
        if (!stringToId.has(str)) {
            const id = stringPool.length
            stringPool.push(str)
            stringToId.set(str, id)
        }
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return stringToId.get(str)!
    }

    const logEntries: PackedLogEntry[] = history.logEntries.map(logEntry => ({
        t: internString(logEntry.text),
        i: serializeValueRecursive(logEntry.timestamp) as string,
        a: internString(logEntry.authorName),
        r: internString(logEntry.authorColorRgba),
        n: logEntry.cancelText ? internString(logEntry.cancelText) : undefined,
        p: logEntry.playerVision ? serializeObject(logEntry.playerVision) : undefined,
        c: logEntry.card ? serializeValueRecursive(logEntry.card) : undefined,
        m: logEntry.mutationId,
    }))

    return {
        stringPool,
        logEntries,
        gameMutations: serializeObject(history.gameMutations),
    }
}

export function deserializeHistory(serializedHistory: SerializedHistory) {
    const history = useHistoryStore()
    const gameId = useGameStateStore().gameId

    const stringPool = serializedHistory.stringPool
    history.logEntries = serializedHistory.logEntries.map(logEntry => ({
        text: stringPool[logEntry.t],
        timestamp: deserializeValueRecursive(logEntry.i, gameId) as Date,
        authorName: stringPool[logEntry.a],
        authorColorRgba: stringPool[logEntry.r],
        cancelText: logEntry.n ? stringPool[logEntry.n] : undefined,
        playerVision: logEntry.p ? deserializeObject<PlayerVision>(logEntry.p, gameId) : undefined,
        card: logEntry.c ? (deserializeValueRecursive(logEntry.c, gameId) as Card) : undefined,
        mutationId: logEntry.m,
    }))
    history.gameMutations = serializedHistory.gameMutations
}

export function serializeGame(): SerializedGame {
    const rawState = useGameStateStore().$state
    const serializedGameState = serializeGameState(rawState as GameState)

    return {
        version: GAME_STATE_VERSION,
        gameState: serializedGameState,
        history: serializeHistory(),
    }
}

export function serializeMultiplayerGame(): SerializedMultiplayerGame {
    const multiplayer = useMultiplayerStore()
    const objectClocks = Object.fromEntries(
        Object.entries(multiplayer.objectClocks).map(([versioningId, clock]) => [
            versioningId,
            clock.version,
        ]),
    )
    return {
        objectClocks,
        mutationVersions: multiplayer.mutationVersions,
        ...serializeGame(),
    }
}

export function loadGame(serializedGame: SerializedGame) {
    if (serializedGame.version != GAME_STATE_VERSION) {
        throw new Error(
            `Game state version mismatch : ${serializedGame.version} != ${GAME_STATE_VERSION}`,
        )
    }

    const gameState = useGameStateStore()
    const serializedGameState = serializedGame.gameState
    deserializeGameState(serializedGameState, gameState)

    deserializeHistory(serializedGame.history)

    useCoreStore().gameStateIsReady = true
}

/**
 * CBOR Encoding
 */

export const cborEncoder = new CborEncoder()
export const cborDecoder = new CborDecoderBase()
