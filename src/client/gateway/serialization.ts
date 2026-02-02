import { AnyGameMutation, gameMutations } from '@/shared/state/gameMutations.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { Card, CryptCard, LibraryCard } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { CardRegion } from '@/shared/model/CardRegion.ts'
import xxhash, { XXHashAPI } from 'xxhash-wasm'

import { useHistoryStore } from '@/client/store/history.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { CborDecoderBase, CborEncoder } from '@jsonjoy.com/json-pack/lib/cbor'
import {
    JsonValue,
    Serialized,
    SerializedCardRegion,
    SerializedGame,
    SerializedGameMutation,
    SerializedGameState,
    SerializedHistory,
    SerializedLogEntry,
    SerializedMultiplayerGame,
    SerializedPlayer,
} from '@/shared/types/multiplayer.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { PlayerVision } from '@/shared/types/state.ts'
import { useTimer } from '@/shared/state/useTimer.ts'
import { DATE_PREFIX, GAME_STATE_VERSION, OID_PREFIX } from '@/shared/const/multiplayer.ts'
import { CardOid, PlayerCardRegions, PlayerOid } from '@/shared/types/model.ts'
import { isCryptId, registerGameState, registerHasher } from '@/shared/registries.ts'

function serializeValueRecursive(value: unknown): JsonValue {
    // Handle null and undefined
    if (value === null || value === undefined) {
        return null
    }

    // Handle primitives
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value
    }

    // Handle Date objects
    if (value instanceof Date) {
        return DATE_PREFIX + value.toISOString()
    }

    // Handle objects with oid
    if (value && typeof value === 'object' && 'oid' in value) {
        return OID_PREFIX + value.oid
    }

    // Handle arrays
    if (Array.isArray(value)) {
        return value.map(item => serializeValueRecursive(item))
    }

    // Handle plain objects
    if (typeof value === 'object') {
        const result: Serialized<unknown> = {}
        for (const [k, v] of Object.entries(value)) {
            result[k] = serializeValueRecursive(v)
        }
        return result
    }

    // Fallback for anything else
    return null
}

export function serializeObject<T extends object>(object: T) {
    return serializeValueRecursive(object) as Serialized<T> & object
}

export function deserializeValueRecursive(value: JsonValue): unknown {
    const gameState = useGameStateStore()

    // Handle null
    if (value === null) {
        return null
    }

    // Handle string special cases (Dates and OIDs)
    if (typeof value === 'string') {
        if (value.startsWith(DATE_PREFIX)) {
            return new Date(value.substring(DATE_PREFIX.length))
        }

        if (value.startsWith(OID_PREFIX)) {
            const oid = value.substring(OID_PREFIX.length)
            const stateObject = gameState.allStateObjects[oid]
            if (!stateObject) {
                throw new Error(`Unknown state object : ${oid}`)
            }
            return stateObject
        }
        return value
    }

    // Handle arrays
    if (Array.isArray(value)) {
        return value.map(item => deserializeValueRecursive(item))
    }

    // Handle objects
    if (typeof value === 'object') {
        const result: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(value)) {
            result[k] = deserializeValueRecursive(v)
        }
        return result
    }

    return value
}

export function deserializeObject<T = unknown>(serializedObject: Serialized<T>): T {
    return deserializeValueRecursive(serializedObject) as T
}

export function serializeGameMutation(gameMutation: AnyGameMutation): SerializedGameMutation {
    return {
        n: gameMutation.name,
        t: gameMutation.timestamp.toISOString(),
        p: serializeObject(gameMutation.params),
        a: gameMutation.author.oid,
        s: serializeObject(gameMutation.previousState),
        c: gameMutation.cancelsMutationId,
    }
}

export function deserializeGameMutation(gameMutationJson: SerializedGameMutation): AnyGameMutation {
    const gameState = useGameStateStore()

    const definition = gameMutations[gameMutationJson.n]
    if (!definition) {
        throw new Error(`Unknown GameMutation : ${gameMutationJson.n}`)
    }
    const GameMutationClass = definition.gameMutationClass

    const author = gameState.players[gameMutationJson.a]
    if (!author) {
        throw new Error(`Unknown player : ${gameMutationJson.a}`)
    }

    const gameMutation = new GameMutationClass(
        gameState.gameId,
        deserializeObject(gameMutationJson.p) as never,
        new Date(gameMutationJson.t),
        author,
        gameMutationJson.c,
    )
    gameMutation.previousState = deserializeObject(gameMutationJson.s)
    return gameMutation
}

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

    const logEntries: SerializedLogEntry[] = history.logEntries.map(logEntry => ({
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
        gameMutations: history.gameMutations.map(m => serializeGameMutation(m as AnyGameMutation)),
    }
}

export function deserializeHistory(serializedHistory: SerializedHistory) {
    const history = useHistoryStore()

    const stringPool = serializedHistory.stringPool
    history.logEntries = serializedHistory.logEntries.map(logEntry => ({
        text: stringPool[logEntry.t],
        timestamp: deserializeValueRecursive(logEntry.i) as Date,
        authorName: stringPool[logEntry.a],
        authorColorRgba: stringPool[logEntry.r],
        cancelText: logEntry.n ? stringPool[logEntry.n] : undefined,
        playerVision: logEntry.p ? deserializeObject<PlayerVision>(logEntry.p) : undefined,
        card: logEntry.c ? (deserializeValueRecursive(logEntry.c) as Card) : undefined,
        mutationId: logEntry.m,
    }))
    history.gameMutations = serializedHistory.gameMutations.map(m => deserializeGameMutation(m))
}

export function serializeGame(): SerializedGame {
    const rawState = useGameStateStore().$state

    const serializedGameState = {
        ...serializeObject(rawState),
        // Override the serializeObject values here,
        // because it has transformed Player, Card and CardRegion objects into and "OID_" string
        cards: JSON.parse(JSON.stringify(rawState.cards)),
        players: JSON.parse(JSON.stringify(rawState.players)),
    } as unknown as SerializedGameState

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
            Object.assign(gameState.$state, { [key]: deserializeValueRecursive(value) })
        }
    }

    deserializeHistory(serializedGame.history)

    // Start timer if needed.
    // TODO : account for time drift !
    if (gameState.timerRemainingTime !== null) {
        useTimer(gameState.gameId).applyStartTimer(gameState.timerRemainingTime)
    }

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
