import {
    InternedLogEntry,
    InternedObject,
    InternId,
    JsonValue,
    PackedGameMutation,
    PackedMutationHistoryEntry,
    Serialized,
    SerializedCard,
    SerializedCardRegion,
    SerializedGameMutation,
    SerializedGameState,
    SerializedHistory,
    SerializedPlayer,
} from '@/shared/types/multiplayer.ts'
import { DATE_PREFIX, OID_PREFIX } from '@/shared/const/multiplayer.ts'
import { AnyGameMutation, GameMutationName, gameMutations } from '@/shared/state/gameMutations.ts'
import { GameId, PlayerCardRegions, PlayerOid } from '@/shared/types/model.ts'
import { getGameState, registerGameState } from '@/shared/registries.ts'
import { HistoryStore } from '@/shared/state/history.ts'
import { PlayerVision } from '@/shared/types/state.ts'
import { Card, CryptCard, LibraryCard } from '@/shared/model/Card.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { stringify as stableStringify } from 'safe-stable-stringify'
import xxhash, { XXHashAPI } from 'xxhash-wasm'
import { Player } from '@/shared/model/Player.ts'
import { CardRegion } from '@/shared/model/CardRegion.ts'

/**
 * Hashing functions
 */

let wasmHasher: XXHashAPI | null = null

export async function initWasmHasher() {
    wasmHasher = await xxhash()
}

export function hash(content: string) {
    if (!wasmHasher) {
        throw new Error('hasher not initialized')
    }
    return wasmHasher.h32(content)
}

export function hashObject(object: object) {
    return hash(stableStringify(object))
}

/**
 * Generic serialization
 */

export function serializeValueRecursive(value: unknown): JsonValue {
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

export function deserializeValueRecursive(value: JsonValue, gameId: GameId): unknown {
    const gameState = getGameState(gameId)

    // Handle null
    if (value === null) {
        return null
    }

    // Handle string special cases (Dates and OIDs)
    if (typeof value === 'string') {
        if (value.startsWith(DATE_PREFIX)) {
            return new Date(value.substring(DATE_PREFIX.length))
        }

        const allStateObjects = {
            ...gameState.allStateObjects,
            ...gameState.staleCards,
        }
        if (value.startsWith(OID_PREFIX)) {
            const oid = value.substring(OID_PREFIX.length)
            const stateObject = allStateObjects[oid]
            if (!stateObject) {
                throw new Error(`Unknown state object : ${oid}`)
            }
            return stateObject
        }
        return value
    }

    // Handle arrays
    if (Array.isArray(value)) {
        return value.map(item => deserializeValueRecursive(item, gameId))
    }

    // Handle objects
    if (typeof value === 'object') {
        const result: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(value)) {
            result[k] = deserializeValueRecursive(v, gameId)
        }
        return result
    }

    return value
}

export function deserializeObject<T = unknown>(serializedObject: Serialized<T>, gameId: GameId): T {
    return deserializeValueRecursive(serializedObject, gameId) as T
}

export function rehydrateCard(
    gameState: GameState,
    cardData: SerializedCard,
    target: 'cards' | 'staleCards' = 'cards',
) {
    const CardClass = cardData.isCrypt ? CryptCard : LibraryCard
    const card = new CardClass(gameState.gameId, cardData.oid, cardData.ownerOid)
    Object.assign(card, cardData)
    gameState[target][card.oid] = card
}

/**
 * Game state serialization
 */

export function serializeGameState(gameState: GameState): SerializedGameState {
    return {
        ...serializeObject(gameState),
        // Override the serializeObject values here,
        // because it has transformed Player, Card and CardRegion objects into and "OID_" string
        cards: JSON.parse(JSON.stringify(gameState.cards)),
        staleCards: JSON.parse(JSON.stringify(gameState.staleCards)),
        players: JSON.parse(JSON.stringify(gameState.players)),
    } as unknown as SerializedGameState
}

export function deserializeGameState(
    serializedGameState: SerializedGameState,
    gameState: GameState,
) {
    const gameId = serializedGameState.gameId as string

    gameState.gameId = gameId
    registerGameState(gameId, gameState)

    /** Deserialize Cards **/
    const jsonCards = serializedGameState.cards
    for (const cardData of Object.values(jsonCards)) {
        rehydrateCard(gameState, cardData, 'cards')
    }
    const jsonStaleCards = serializedGameState.staleCards
    for (const cardData of Object.values(jsonStaleCards)) {
        rehydrateCard(gameState, cardData, 'staleCards')
    }

    /** Deserialize Players **/
    type PlayerCardRegionsKey = keyof PlayerCardRegions
    const jsonPlayers = serializedGameState.players
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

    for (const [key, value] of Object.entries(serializedGameState)) {
        if (key != 'cards' && key != 'staleCards' && key != 'players' && key in gameState) {
            Object.assign(gameState, { [key]: deserializeValueRecursive(value, gameId) })
        }
    }
}

/**
 * History serialization
 */

export function serializeHistory(history: HistoryStore, withArchive: boolean): SerializedHistory {
    // Compress strings into a string pool
    const stringPool: string[] = []
    const stringToId = new Map<string, string>()
    const internString = (str: string): string => {
        if (!stringToId.has(str)) {
            const id = String(stringPool.length)
            stringPool.push(str)
            stringToId.set(str, id)
        }
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return stringToId.get(str)!
    }
    const internObjectKeys = (object: Record<string, unknown>): InternedObject => {
        return Object.fromEntries(
            Object.entries(object).map(([k, v]) => [
                internString(k),
                typeof v === 'string' ? internString(v) : v,
            ]),
        )
    }

    const logEntries: InternedLogEntry[] = history.logEntries.map(logEntry => {
        const playerVision =
            logEntry.playerVision ?
                internObjectKeys(serializeObject(logEntry.playerVision))
            :   undefined

        return {
            t: internString(logEntry.text),
            i: serializeValueRecursive(logEntry.timestamp) as string,
            a: internString(logEntry.authorName),
            r: internString(logEntry.authorColorRgba),
            n: logEntry.cancelText ? internString(logEntry.cancelText) : undefined,
            p: playerVision,
            c: logEntry.card ? serializeValueRecursive(logEntry.card) : undefined,
            m: logEntry.mutationId,
        }
    })

    const gameMutations: PackedMutationHistoryEntry[] = history.gameMutations.map(mutationEntry => {
        const packedGameMutation = packGameMutation(
            deserializeGameMutation(mutationEntry.serializedMutation as SerializedGameMutation),
        )
        const internedGameMutation = {
            ...packedGameMutation,
            g: internString(packedGameMutation.g),
            n: internString(packedGameMutation.n),
            p: internObjectKeys(packedGameMutation.p),
            a: internString(packedGameMutation.a),
            s: internObjectKeys(packedGameMutation.s),
        }

        return {
            i: mutationEntry.id,
            c: mutationEntry.isIgnoredForCancel,
            u: mutationEntry.isUserCancellable,
            g: internedGameMutation,
        }
    })

    return {
        stringPool,
        logEntries,
        gameMutations,
        archive: withArchive ? history.archive : undefined,
    }
}

export function deserializeHistory(
    gameId: GameId,
    serializedHistory: SerializedHistory,
    history: HistoryStore,
) {
    const stringPool = serializedHistory.stringPool
    const resolveString = (internId: InternId): string => stringPool[Number(internId)]

    const resolveObjectKeys = <T>(obj: Record<string, unknown>): T =>
        Object.fromEntries(
            Object.entries(obj).map(([k, v]) => [
                stringPool[Number(k)],
                typeof v === 'string' ? resolveString(v) : v,
            ]),
        ) as T

    history.logEntries = serializedHistory.logEntries.map(logEntry => {
        const playerVision =
            logEntry.p ?
                deserializeObject<PlayerVision>(resolveObjectKeys(logEntry.p), gameId)
            :   undefined

        return {
            text: resolveString(logEntry.t),
            timestamp: deserializeValueRecursive(logEntry.i, gameId) as Date,
            authorName: resolveString(logEntry.a),
            authorColorRgba: resolveString(logEntry.r),
            cancelText: logEntry.n ? resolveString(logEntry.n) : undefined,
            playerVision,
            card: logEntry.c ? (deserializeValueRecursive(logEntry.c, gameId) as Card) : undefined,
            mutationId: logEntry.m,
        }
    })

    history.gameMutations = serializedHistory.gameMutations.map(mutationEntry => {
        const packedGameMutation: PackedGameMutation = {
            ...mutationEntry.g,
            g: resolveString(mutationEntry.g.g),
            n: resolveString(mutationEntry.g.n) as GameMutationName,
            p: resolveObjectKeys(mutationEntry.g.p),
            a: resolveString(mutationEntry.g.a),
            s: resolveObjectKeys(mutationEntry.g.s),
        }

        return {
            id: mutationEntry.i,
            isIgnoredForCancel: mutationEntry.c,
            isUserCancellable: mutationEntry.u,
            serializedMutation: serializeGameMutation(unpackGameMutation(packedGameMutation)),
        }
    })

    if (serializedHistory.archive) {
        history.archive = serializedHistory.archive
    }
}

/**
 * Game mutations serialization
 */

export function serializeGameMutation(gameMutation: AnyGameMutation): SerializedGameMutation {
    return {
        gameId: gameMutation.gameId,
        name: gameMutation.name,
        timestamp: gameMutation.timestamp.toISOString(),
        params: serializeObject(gameMutation.params),
        authorOid: gameMutation.author.oid,
        previousState: serializeObject(gameMutation.previousState),
        cancelsMutationId: gameMutation.cancelsMutationId,
    }
}

export function packGameMutation(gameMutation: AnyGameMutation): PackedGameMutation {
    const serialized = serializeGameMutation(gameMutation)
    return {
        g: serialized.gameId,
        n: serialized.name,
        t: serialized.timestamp,
        p: serialized.params,
        a: serialized.authorOid,
        s: serialized.previousState,
        c: serialized.cancelsMutationId,
    }
}

export function deserializeGameMutation(gameMutationJson: SerializedGameMutation): AnyGameMutation {
    const gameId = gameMutationJson.gameId
    const gameState = getGameState(gameId)

    const definition = gameMutations[gameMutationJson.name]
    if (!definition) {
        throw new Error(`Unknown GameMutation : ${gameMutationJson.name}`)
    }
    const GameMutationClass = definition.gameMutationClass

    const author = gameState.players[gameMutationJson.authorOid]
    if (!author) {
        throw new Error(`Unknown player : ${gameMutationJson.authorOid}`)
    }

    const gameMutation = new GameMutationClass(
        gameId,
        deserializeObject(gameMutationJson.params, gameId) as never,
        new Date(gameMutationJson.timestamp),
        author,
        gameMutationJson.cancelsMutationId,
    )
    gameMutation.previousState = deserializeObject(gameMutationJson.previousState, gameId)
    return gameMutation
}

export function unpackGameMutation(packedGameMutation: PackedGameMutation): AnyGameMutation {
    return deserializeGameMutation({
        gameId: packedGameMutation.g,
        name: packedGameMutation.n,
        timestamp: packedGameMutation.t,
        params: packedGameMutation.p,
        authorOid: packedGameMutation.a,
        previousState: packedGameMutation.s,
        cancelsMutationId: packedGameMutation.c,
    })
}
