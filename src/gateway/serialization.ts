import {
    AnyGameMutation,
    GameMutationId,
    GameMutationName,
    gameMutations,
} from '@/state/gameMutations.ts'
import { GameState, GameStateKey, useGameStateStore } from '@/store/gameState.ts'
import { JsonValue } from 'trystero'
import { Card, CardOid, CryptCard, LibraryCard } from '@/model/Card.ts'
import { Player, PlayerCardRegions, PlayerOid } from '@/model/Player.ts'
import { CardRegion } from '@/model/CardRegion.ts'
import xxhash, { XXHashAPI } from 'xxhash-wasm'
import { stringify as stableStringify } from 'safe-stable-stringify'
import { useHistoryStore } from '@/store/history.ts'
import { useCoreStore } from '@/store/core.ts'

const GAME_STATE_VERSION = 1

export type JsonObject = { [key: string]: JsonValue }

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

// export type SerializedChatMessage = Serialized<ChatMessage>
export type SerializedChatMessage = JsonObject

export type SerializedGameMutation = {
    name: GameMutationName
    timestamp: string
    params: JsonObject
    authorOid: number
    cancelsMutationId?: GameMutationId
}

type SerializedGameState = {
    cards: Record<string, SerializedCard>
    players: Record<string, SerializedPlayer>
} & { [K in Exclude<GameStateKey, 'cards' | 'players'>]: JsonValue }

type SerializedHistory = {
    logEntries: JsonObject[]
    gameMutations: SerializedGameMutation[]
}

export type SerializedGame = {
    version: number
    gameState: SerializedGameState
    history: SerializedHistory
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
        const result: JsonObject = {}
        for (const [k, v] of Object.entries(value)) {
            result[k] = serializeValueRecursive(v)
        }
        return result
    }

    // Fallback for anything else
    return null
}

export function serializeObject<T extends object>(object: T): { [K in keyof T]: JsonValue } {
    const result: Record<string, JsonValue> = {}

    for (const [key, value] of Object.entries(object)) {
        result[key] = serializeValueRecursive(value)
    }

    return result as { [K in keyof T]: JsonValue }
}

export function deserializeObject<T = unknown>(jsonObject: JsonObject): T {
    const gameState = useGameStateStore()

    return JSON.parse(JSON.stringify(jsonObject), (_, value) => {
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
    })
}

export function serializeGameMutation(gameMutation: AnyGameMutation): SerializedGameMutation {
    return {
        name: gameMutation.name,
        timestamp: gameMutation.timestamp.toISOString(),
        params: serializeObject(gameMutation.params),
        authorOid: gameMutation.author.oid,
        cancelsMutationId: gameMutation.cancelsMutationId,
    }
}

export function deserializeGameMutation(gameMutationJson: SerializedGameMutation): AnyGameMutation {
    const gameState = useGameStateStore()

    const definition = gameMutations[gameMutationJson.name]
    if (!definition) {
        throw new Error(`Unknown GameMutation : ${gameMutationJson.name}`)
    }
    const GameMutationClass = definition.gameMutationClass

    const author = gameState.players[gameMutationJson.authorOid]
    return new GameMutationClass(
        deserializeObject(gameMutationJson.params),
        new Date(gameMutationJson.timestamp),
        author,
        gameMutationJson.cancelsMutationId,
    )
}

export function serializeHistory(): SerializedHistory {
    const history = useHistoryStore()
    return {
        logEntries: history.logEntries.map(l => serializeObject(l)),
        gameMutations: history.gameMutations.map(m => serializeGameMutation(m as AnyGameMutation)),
    }
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

export function loadGame(serializedGame: SerializedGame) {
    if (serializedGame.version != GAME_STATE_VERSION) {
        throw new Error(
            `Game state version mismatch : ${serializedGame.version} != ${GAME_STATE_VERSION}`,
        )
    }

    const gameState = useGameStateStore()
    const history = useHistoryStore()

    const gameStateData = serializedGame.gameState
    type PlayerCardRegionsKey = keyof PlayerCardRegions

    /** Deserialize Cards **/
    const jsonCards = gameStateData.cards
    const cards = {} as Record<CardOid, Card>

    for (const cardData of Object.values(jsonCards)) {
        // Krcg id of crypt card begins by 2, library begins by 1
        const CardClass = cardData.krcgId[0] === '2' ? CryptCard : LibraryCard
        const card = new CardClass(cardData.oid, cardData.krcgId, cardData.controllerOid)
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
            playerData.handSize,
        )
    }
    gameState.players = players

    /** Deserialize Other values **/

    for (const [key, value] of Object.entries(gameStateData)) {
        if (key != 'cards' && key != 'players' && key in gameState.$state) {
            Object.assign(gameState.$state, { [key]: value })
        }
    }

    history.logEntries = serializedGame.history.logEntries.map(l => deserializeObject(l))
    history.gameMutations = serializedGame.history.gameMutations.map(m =>
        deserializeGameMutation(m),
    )

    useCoreStore().gameStateIsReady = true
}

let hasher: XXHashAPI | null = null
xxhash().then(_hasher_ => (hasher = _hasher_))

export function hashObject(object: object) {
    if (!hasher) {
        throw new Error('hasher not initialized')
    }
    return hasher.h32(stableStringify(object))
}

export function hashGameState(gameState: GameState) {
    return hashObject(gameState)
}
