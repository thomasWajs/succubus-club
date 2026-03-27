import {
    JsonValue,
    PackedGameMutation,
    PackedLogEntry,
    PackedMutationHistoryEntry,
    Serialized,
    SerializedGameMutation,
    SerializedHistory,
} from '@/shared/types/multiplayer.ts'
import { DATE_PREFIX, OID_PREFIX } from '@/shared/const/multiplayer.ts'
import { AnyGameMutation, GameMutationParams, gameMutations } from '@/shared/state/gameMutations.ts'
import { GameId } from '@/shared/types/model.ts'
import { getGameState } from '@/shared/registries.ts'
import { HistoryStore } from '@/shared/state/history.ts'
import { PlayerVision } from '@/shared/types/state.ts'
import { Card } from '@/shared/model/Card.ts'

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
 * History serialization
 */

export function serializeHistory(history: HistoryStore): SerializedHistory {
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

    const gameMutations: PackedMutationHistoryEntry[] = history.gameMutations.map(mutationEntry => {
        const packedGameMutation = packGameMutation(
            deserializeGameMutation(mutationEntry.serializedMutation as SerializedGameMutation),
        )
        packedGameMutation.p = Object.fromEntries(
            Object.entries(packedGameMutation.p).map(([k, v]) => [internString(k), v]),
        ) as Serialized<GameMutationParams>
        packedGameMutation.s = Object.fromEntries(
            Object.entries(packedGameMutation.s).map(([k, v]) => [internString(k), v]),
        ) as Serialized<GameMutationParams>

        return {
            i: mutationEntry.id,
            c: mutationEntry.isIgnoredForCancel,
            u: mutationEntry.isUserCancellable,
            p: packedGameMutation,
        }
    })

    return {
        stringPool,
        logEntries,
        gameMutations,
    }
}

export function deserializeHistory(
    gameId: GameId,
    serializedHistory: SerializedHistory,
    history: HistoryStore,
) {
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

    history.gameMutations = serializedHistory.gameMutations.map(mutationEntry => {
        mutationEntry.p.p = Object.fromEntries(
            Object.entries(mutationEntry.p.p).map(([k, v]) => [stringPool[Number(k)], v]),
        ) as Serialized<GameMutationParams>
        mutationEntry.p.s = Object.fromEntries(
            Object.entries(mutationEntry.p.s).map(([k, v]) => [stringPool[Number(k)], v]),
        ) as Serialized<GameMutationParams>

        return {
            id: mutationEntry.i,
            isIgnoredForCancel: mutationEntry.c,
            isUserCancellable: mutationEntry.u,
            serializedMutation: serializeGameMutation(unpackGameMutation(mutationEntry.p)),
        }
    })
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
