import {
    AnyGameMutation,
    GameMutationId,
    GameMutationName,
    GameMutationParams,
    gameMutations,
} from '@/state/gameMutations.ts'
import { GameStateKey, useGameStateStore } from '@/store/gameState.ts'
import { Card, CardOid, CryptCard, LibraryCard } from '@/model/Card.ts'
import { Player, PlayerCardRegions, PlayerOid } from '@/model/Player.ts'
import { CardRegion } from '@/model/CardRegion.ts'
import xxhash, { XXHashAPI } from 'xxhash-wasm'
import { stringify as stableStringify } from 'safe-stable-stringify'
import { ChatMessage, useHistoryStore } from '@/store/history.ts'
import { useCoreStore } from '@/store/core.ts'
import { isCryptId } from '@/resources/cards.ts'
import { CborEncoder, CborDecoderBase } from '@jsonjoy.com/json-pack/lib/cbor'
import { VectorClockVersion, VersioningId } from '@/multiplayer/types.ts'
import { useMultiplayerStore } from '@/store/multiplayer.ts'
import { PlayerVision } from '@/state/types.ts'
import { useTimer } from '@/game/composables/useTimer.ts'

const GAME_STATE_VERSION = 5

type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue }

type Serialized<T> = JsonValue & {
    [K in keyof T]: T[K] extends Date ? string
    : // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    T[K] extends Function ? never
    : T[K] extends object ? Serialized<T[K]>
    : T[K]
}
type SerializedPlayer = Serialized<Player>
type SerializedCard = Serialized<Card>
type SerializedCardRegion = Serialized<CardRegion<Card>>

type SerializedGameState = {
    cards: Record<string, SerializedCard>
    players: Record<string, SerializedPlayer>
} & { [K in Exclude<GameStateKey, 'cards' | 'players'>]: JsonValue }

// Here we use a compressed representation of the GameMutation class, to save space.
// It's really not readable, but it works.
export type SerializedGameMutation = {
    n: GameMutationName // name
    t: string // timestamp
    p: Serialized<GameMutationParams> // params
    a: number // authorOid
    s: Serialized<GameMutationParams> // previousState
    c?: GameMutationId // cancelsMutationId
}

// Same compression strategy than for SerializedGameMutation
export type SerializedLogEntry = {
    t: number // text as string index in stringPool
    i: string // timestamp
    a: number // authorName as string index in stringPool
    r: number // authorColorRgba as string index in stringPool
    n?: number // cancelText as string index in stringPool
    p?: Serialized<PlayerVision> // playerVision
    c?: JsonValue // card
    m?: GameMutationId // mutationId
}

export type SerializedChatMessage = Serialized<ChatMessage>

type SerializedHistory = {
    stringPool: string[]
    logEntries: SerializedLogEntry[]
    gameMutations: SerializedGameMutation[]
}

export type SerializedGame = {
    version: number
    gameState: SerializedGameState
    history: SerializedHistory
}
export type SerializedMultiplayerGame = SerializedGame & {
    objectClocks: Record<VersioningId, VectorClockVersion>
    mutationVersions: Record<GameMutationId, VectorClockVersion>
}

const OID_PREFIX = 'OID_'
const DATE_PREFIX = 'DATE_'

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
    return serializeValueRecursive(object) as Serialized<T>
}

export function deserializeValue(value: JsonValue) {
    const gameState = useGameStateStore()

    if (typeof value === 'string') {
        if (value.startsWith(DATE_PREFIX)) {
            return new Date(value.substring(DATE_PREFIX.length))
        }

        if (value.startsWith(OID_PREFIX)) {
            const oid = parseInt(value.substring(OID_PREFIX.length))
            const stateObject = gameState.allStateObjects[oid]
            if (!stateObject) {
                throw new Error(`Unknown state object : ${oid}`)
            }
            return stateObject
        }
    }

    return value
}

export function deserializeObject<T = unknown>(serializedObject: Serialized<T>): T {
    return JSON.parse(JSON.stringify(serializedObject), (_, value) => {
        return deserializeValue(value)
    })
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
        timestamp: deserializeValue(logEntry.i) as Date,
        authorName: stringPool[logEntry.a],
        authorColorRgba: stringPool[logEntry.r],
        cancelText: logEntry.n ? stringPool[logEntry.n] : undefined,
        playerVision: logEntry.p ? deserializeObject<PlayerVision>(logEntry.p) : undefined,
        card: logEntry.c ? (deserializeValue(logEntry.c) as Card) : undefined,
        mutationId: logEntry.m,
    }))
    history.gameMutations = serializedHistory.gameMutations.map(m => deserializeGameMutation(m))
}

export function serializeGame(): SerializedGame {
    return {
        version: GAME_STATE_VERSION,
        // Don't use serializeObject here, as that would transform Player, Card and CardRegion
        // objects into and "OID_" string
        gameState: JSON.parse(JSON.stringify(useGameStateStore().$state)),
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
    type PlayerCardRegionsKey = keyof PlayerCardRegions

    /** Deserialize Cards **/
    const jsonCards = gameStateData.cards
    const cards = {} as Record<CardOid, Card>

    for (const cardData of Object.values(jsonCards)) {
        const CardClass = isCryptId(cardData.krcgId) ? CryptCard : LibraryCard
        const card = new CardClass(cardData.oid, cardData.krcgId, cardData.ownerOid)
        Object.assign(card, cardData)
        cards[card.oid] = card
    }
    gameState.cards = cards

    /** Deserialize Players **/
    const jsonPlayers = gameStateData.players
    const players = {} as Record<PlayerOid, Player>

    for (const playerData of Object.values(jsonPlayers) as SerializedPlayer[]) {
        const cardRegions = {} as PlayerCardRegions
        for (const [regionName, regionData] of Object.entries(playerData.cardRegions) as [
            PlayerCardRegionsKey,
            SerializedCardRegion,
        ][]) {
            cardRegions[regionName] = new CardRegion<never>(
                regionData.oid,
                regionData.name,
                regionData.visibility,
                regionData.cardsOid,
            )
        }

        players[playerData.oid] = new Player(
            playerData.oid,
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
            Object.assign(gameState.$state, { [key]: value })
        }
    }

    deserializeHistory(serializedGame.history)

    // Start timer if needed.
    // TODO : account for time drift !
    if (gameState.timerRemainingTime !== null) {
        useTimer().applyStartTimer(gameState.timerRemainingTime)
    }

    useCoreStore().gameStateIsReady = true
}

/**
 * Hashing functions
 */

let hasher: XXHashAPI | null = null
xxhash().then(_hasher_ => (hasher = _hasher_))

export function hash(content: string) {
    if (!hasher) {
        throw new Error('hasher not initialized')
    }
    return hasher.h32(content)
}

export function hashObject(object: object) {
    return hash(stableStringify(object))
}

export const cborEncoder = new CborEncoder()
export const cborDecoder = new CborDecoderBase()
