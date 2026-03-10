import { useGameStateStore } from '@/client/store/gameState.ts'
import { Card, CryptCard, LibraryCard } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { CardRegion } from '@/shared/model/CardRegion.ts'

import { useHistoryStore } from '@/client/store/history.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { CborDecoderBase, CborEncoder } from '@jsonjoy.com/json-pack/lib/cbor'
import {
    PackedLogEntry,
    SerializedCardRegion,
    SerializedGame,
    SerializedHistory,
    SerializedMultiplayerGame,
    SerializedPlayer,
} from '@/shared/types/multiplayer.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { PlayerVision } from '@/shared/types/state.ts'
import { GAME_STATE_VERSION } from '@/shared/const/multiplayer.ts'
import { CardOid, PlayerCardRegions, PlayerOid } from '@/shared/types/model.ts'
import { registerGameState } from '@/shared/registries.ts'
import {
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

    const gameStateData = serializedGame.gameState
    const gameId = gameStateData.gameId as string
    registerGameState(gameId, gameState)

    /** Deserialize Cards **/
    const jsonCards = gameStateData.cards
    const cards = {} as Record<CardOid, Card>

    for (const cardData of Object.values(jsonCards)) {
        const CardClass = cardData.isCrypt ? CryptCard : LibraryCard
        const card = new CardClass(gameId, cardData.oid, cardData.ownerOid)
        Object.assign(card, cardData)
        cards[card.oid] = card
    }
    // noinspection JSConstantReassignment
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
    // noinspection JSConstantReassignment
    gameState.players = players

    /** Deserialize Other values **/

    for (const [key, value] of Object.entries(gameStateData)) {
        if (key != 'cards' && key != 'players' && key in gameState.$state) {
            Object.assign(gameState.$state, { [key]: deserializeValueRecursive(value, gameId) })
        }
    }

    deserializeHistory(serializedGame.history)

    useCoreStore().gameStateIsReady = true
}

/**
 * CBOR Encoding
 */

export const cborEncoder = new CborEncoder()
export const cborDecoder = new CborDecoderBase()
