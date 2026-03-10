import {
    JsonValue,
    PackedGameMutation,
    Serialized,
    SerializedGameMutation,
    SerializedGameState,
} from '@/shared/types/multiplayer.ts'
import { DATE_PREFIX, OID_PREFIX } from '@/shared/const/multiplayer.ts'
import { AnyGameMutation, gameMutations } from '@/shared/state/gameMutations.ts'
import { GameId } from '@/shared/types/model.ts'
import { getGameState } from '@/shared/registries.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { stringify as stableStringify } from 'safe-stable-stringify'
import xxhash, { XXHashAPI } from 'xxhash-wasm'

/**
 * Hashing functions
 */

let wasmHasher: XXHashAPI | null = null

export function initWasmHasher() {
    xxhash().then(_hasher_ => {
        wasmHasher = _hasher_
    })
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

/**
 * Game state serialization
 */

export function serializeGameState(gameState: GameState): SerializedGameState {
    return {
        ...serializeObject(gameState),
        // Override the serializeObject values here,
        // because it has transformed Player, Card and CardRegion objects into and "OID_" string
        cards: JSON.parse(JSON.stringify(gameState.cards)),
        players: JSON.parse(JSON.stringify(gameState.players)),
    } as unknown as SerializedGameState
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

export function unpackGameMutation(packedGameMutation: PackedGameMutation) {
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
