import { useGameStateStore } from '@/client/store/gameState.ts'
import { Card, CryptCard, LibraryCard } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { CardRegion } from '@/shared/model/CardRegion.ts'
import xxhash, { XXHashAPI } from 'xxhash-wasm'
import { useCoreStore } from '@/client/store/core.ts'
import { CborDecoderBase, CborEncoder } from '@jsonjoy.com/json-pack/lib/cbor'
import {
    SerializedCardRegion,
    SerializedGame,
    SerializedGameState,
    SerializedMultiplayerGame,
    SerializedPlayer,
} from '@/shared/types/multiplayer.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { GAME_STATE_VERSION } from '@/shared/const/multiplayer.ts'
import { CardOid, PlayerCardRegions, PlayerOid } from '@/shared/types/model.ts'
import { isCryptId, registerGameState, registerHasher } from '@/shared/registries.ts'
import {
    deserializeHistory,
    deserializeValueRecursive,
    serializeHistory,
    serializeObject,
} from '@/shared/serialization.ts'
import { HistoryStore } from '@/shared/state/history.ts'
import { useHistoryStore } from '@/client/store/history.ts'

export function serializeGame(): SerializedGame {
    const rawState = useGameStateStore().$state

    const serializedGameState = {
        ...serializeObject(rawState),
        // Override the serializeObject values here,
        // because it has transformed Player, Card and CardRegion objects into and "OID_" string
        cards: JSON.parse(JSON.stringify(rawState.cards)),
        players: JSON.parse(JSON.stringify(rawState.players)),
    } as unknown as SerializedGameState

    const rawHistory = useHistoryStore().$state
    const serializedHistory = serializeHistory(rawHistory as HistoryStore)

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

    const gameStateData = serializedGame.gameState
    const gameId = gameStateData.gameId as string
    registerGameState(gameId, gameState)

    /** Deserialize Cards **/
    const jsonCards = gameStateData.cards
    const cards = {} as Record<CardOid, Card>

    for (const cardData of Object.values(jsonCards)) {
        const CardClass = isCryptId(cardData.krcgId) ? CryptCard : LibraryCard
        const card = new CardClass(gameId, cardData.oid, cardData.krcgId, cardData.ownerOid)
        Object.assign(card, cardData)
        cards[card.oid] = card
    }
    gameState.cards = cards

    /** Deserialize Players **/
    type PlayerCardRegionsKey = keyof PlayerCardRegions
    const jsonPlayers = gameStateData.players
    const players = {} as Record<PlayerOid, Player>

    for (const playerData of Object.values(jsonPlayers) as SerializedPlayer[]) {
        const cardRegions = {} as PlayerCardRegions
        for (const [regionName, regionData] of Object.entries(playerData.cardRegions) as [
            PlayerCardRegionsKey,
            SerializedCardRegion,
        ][]) {
            cardRegions[regionName] = new CardRegion<never>(
                gameId,
                regionData.oid,
                regionData.name,
                regionData.visibility,
                regionData.cardsOid,
            )
        }

        const playerOid = playerData.oid
        players[playerOid] = new Player(
            gameId,
            playerOid,
            playerData.permId,
            cardRegions,
            playerData.name,
            playerData.rgbaColor,
            playerData.pool,
            playerData.victoryPoints,
            playerData.isOusted,
            // playerData.handSize,
        )
    }
    gameState.players = players

    /** Deserialize Other values **/

    for (const [key, value] of Object.entries(gameStateData)) {
        if (key != 'cards' && key != 'players' && key in gameState.$state) {
            Object.assign(gameState.$state, { [key]: deserializeValueRecursive(value, gameId) })
        }
    }

    const history = useHistoryStore()
    deserializeHistory(gameState.gameId, serializedGame.history, history as HistoryStore)

    useCoreStore().gameStateIsReady = true
}

/**
 * Hashing functions
 */

let wasmHasher: XXHashAPI | null = null

export function initWasmHasher() {
    xxhash().then(_hasher_ => {
        wasmHasher = _hasher_
        registerHasher(wasmHash)
    })
}

export function wasmHash(content: string) {
    if (!wasmHasher) {
        throw new Error('hasher not initialized')
    }
    return wasmHasher.h32(content)
}

export const cborEncoder = new CborEncoder()
export const cborDecoder = new CborDecoderBase()
