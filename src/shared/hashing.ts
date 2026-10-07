import type { JsonValue, Serialized } from '@/shared/types/multiplayer.ts'
import { DATE_PREFIX, OID_PREFIX } from '@/shared/const/multiplayer.ts'
import { stringify as stableStringify } from 'safe-stable-stringify'
import xxhash, { XXHashAPI } from 'xxhash-wasm'

/**
 * Hashing and generic serialization, without any dependency on the game model: mutations need
 * them to compute their id, so this file must stay a leaf.
 */

let wasmHasher: XXHashAPI | null = null

export async function initWasmHasher() {
    wasmHasher = await xxhash()
}

export function isHasherReady(): boolean {
    return !!wasmHasher
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
