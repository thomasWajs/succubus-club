import { useGameStateStore } from '@/client/store/gameState.ts'

import { useHistoryStore } from '@/client/store/history.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { CborDecoderBase, CborEncoder } from '@jsonjoy.com/json-pack/lib/cbor'
import { SerializedGame, SerializedMultiplayerGame } from '@/shared/types/multiplayer.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { GAME_STATE_VERSION } from '@/shared/const/multiplayer.ts'
import {
    deserializeGameState,
    deserializeHistory,
    serializeGameState,
    serializeHistory,
} from '@/shared/serialization.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { HistoryStore } from '@/shared/state/history.ts'

export function serializeGame(): SerializedGame {
    const rawState = useGameStateStore().$state
    const serializedGameState = serializeGameState(rawState as GameState)
    const rawHistory = useHistoryStore().$state
    const serializedHistory = serializeHistory(rawHistory as HistoryStore, true)

    return {
        version: GAME_STATE_VERSION,
        gameState: serializedGameState,
        history: serializedHistory,
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
    const history = useHistoryStore()

    deserializeGameState(serializedGame.gameState, gameState)
    deserializeHistory(gameState.gameId, serializedGame.history, history as HistoryStore)

    useCoreStore().gameStateIsReady = true
}

/**
 * CBOR Encoding
 */

export const cborEncoder = new CborEncoder()
export const cborDecoder = new CborDecoderBase()
