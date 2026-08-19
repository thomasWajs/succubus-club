import { send, sendError } from './wsServer.ts'
import { captureException } from './capture.ts'
import logger from './logger.ts'
import { broadcastTailored, ensureRoom } from './rooms.ts'
import {
    EMPTY_SEATING,
    MultiplayerMessageType,
    MutationSyncMode,
    PackedGameMutation,
    PermanentId,
    RoomSeat,
    RoomSeats,
    ScsGameMutationMessage,
    ScsGameStateMessage,
    SerializedCard,
    ScsMutationRejectedMessage,
    ScsRandomResultRequestMessage,
    ScsShuffleCardRegionMessage,
    SerializedMultiplayerGame,
} from '@/shared/types/multiplayer.ts'
import { ConnectionInfo, RateLimitInfo, Room, SERVER_PERM_ID, StartedRoom } from './types.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { setupMultiplayerGameState } from '@/shared/state/setup.ts'
import { getUser } from './users.ts'
import { KnownCards } from '@/shared/types/state.ts'
import { anyoneCanSee, canSeeOrPeek } from '@/shared/state/cardVisibility.ts'
import { UNKNOWN_MINION_ATTRS, UNKNOWN_VAMPIRE_ATTRS } from '@/shared/model/Card.ts'
import {
    hashObject,
    packGameMutation,
    rehydrateCard,
    serializeGameState,
    serializeHistory,
    unpackGameMutation,
} from '@/shared/serialization.ts'
import * as persistence from './persistence.ts'
import { generateCardOid } from '@/shared/state/ids.ts'
import { CardOid } from '@/shared/types/model.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { shuffleArray } from '@/shared/utils.ts'
import { GAME_STATE_VERSION } from '@/shared/const/multiplayer.ts'
import { ClockCompare, VectorClock } from '@/shared/multiplayer/clock.ts'

const RATE_LIMIT_WINDOW = 1000 // 1 second
const RATE_LIMIT_MAX = 50 // Max mutations per window

export class UserNotIdentified extends Error {}

/**
 * Track rate limits for each user
 */
const rateLimits = new Map<PermanentId, RateLimitInfo>()

/**
 * Check rate limit for a player
 */
function checkRateLimit(permId: PermanentId): boolean {
    const now = Date.now()
    const info = rateLimits.get(permId)

    if (!info || now - info.windowStart > RATE_LIMIT_WINDOW) {
        // Start new window
        rateLimits.set(permId, { count: 1, windowStart: now })
        return true
    }

    if (info.count >= RATE_LIMIT_MAX) {
        return false // Rate limit exceeded
    }

    info.count++
    return true
}

/**
 * Create initial game state for launching a game
 */
export function createGameState(room: Room): GameState {
    if (!room.seating || room.seating == EMPTY_SEATING) {
        throw new Error(`No seating in game room`)
    }

    const gameState = new GameState()
    // Games are strict In SCS, that's the whole point
    gameState.isStrictGame = true
    const seatedUsers = room.seating.map(permId => getUser(permId))
    setupMultiplayerGameState(gameState, seatedUsers, room.userDecks)

    room.gameId = gameState.gameId
    room.gameState = gameState
    persistence.saveRoom(room)

    return gameState
}

/**
 * Get player for a game state (returns undefined if not found)
 */
export function getPlayer(gameState: GameState, permId: PermanentId) {
    const playerOid = gameState.usersToPlayer[permId]
    return playerOid ? gameState.players[playerOid] : undefined
}

/**
 * In a game state, get cards that are known by a given user
 */
export function getKnownCards(
    gameState: GameState,
    permId: PermanentId,
    seats: RoomSeats,
): KnownCards {
    const userKnownCards: KnownCards = {}
    // A judge oversees the game : they see and peek every card
    const isJudge = seats[permId] == RoomSeat.Judge
    const player = getPlayer(gameState, permId)
    for (const card of Object.values(gameState.cards)) {
        if (
            card.krcgId &&
            (isJudge || anyoneCanSee(card) || (player && canSeeOrPeek(player, card)))
        ) {
            userKnownCards[card.oid] = card.krcgId
        }
    }
    return userKnownCards
}

/**
 * Hide the attributes of a card the user doesn't know, to avoid leaking info on hidden
 * cards. Does nothing for a card they know.
 *
 * A crypt card keeps the UNKNOWN markers : everyone can see it's a crypt card, and
 * that's exactly the state CryptCard builds by default. It also has to keep them, as
 * initMinionAttrs only refills attrs that hold the marker.
 * A library card drops them entirely : being an ally is hidden information, and
 * LibraryCard.initMinionAttrs recreates them on reveal.
 */
function redactUnknownCard(card: SerializedCard, knownCards: KnownCards) {
    if (card.oid in knownCards) {
        return
    }

    if (card.isCrypt) {
        card.minionAttrs = UNKNOWN_MINION_ATTRS
        card.vampireAttrs = UNKNOWN_VAMPIRE_ATTRS
    } else {
        delete card.minionAttrs
        delete card.vampireAttrs
    }
}

/**
 * Redact a mutation before broadcasting it to one user.
 *
 * Mutations normally reference cards by oid, but the shuffle mutation embeds them by
 * value ( see handleShuffleCardRegion ), so its params leak the attrs of every shuffled
 * card, in the new order, to everyone. They must be redacted per recipient.
 */
function redactPackedMutation(
    gameMutation: PackedGameMutation,
    knownCards: KnownCards,
): PackedGameMutation {
    if (!Array.isArray(gameMutation.p.shuffledCards)) {
        return gameMutation
    }

    // Deep copy : every recipient gets their own redaction of the same source cards
    const redacted = JSON.parse(JSON.stringify(gameMutation)) as PackedGameMutation
    for (const card of redacted.p.shuffledCards as unknown as SerializedCard[]) {
        redactUnknownCard(card, knownCards)
    }

    return redacted
}

/**
 * Get a serialized game for launch or resync
 */
export function getSerializedGame(
    gameState: GameState,
    room: Room,
    permId: PermanentId,
): SerializedMultiplayerGame {
    const knownCards = getKnownCards(gameState, permId, room.seats)
    const userGameState = { ...gameState, knownCards } as GameState
    const serializedGameState = serializeGameState(userGameState)

    // Hide the attrs of hidden cards.
    // When setting up the game, each users know only its own crypt and starting hand.
    // When resyncing, he will know more.
    // staleCards matters as much as cards : shuffling keeps the same card object in both,
    // so a stale entry carries the *new* oid of a shuffled card.
    for (const card of Object.values(serializedGameState.cards)) {
        redactUnknownCard(card, knownCards)
    }
    for (const card of Object.values(serializedGameState.staleCards)) {
        redactUnknownCard(card, knownCards)
    }

    const objectClocks = Object.fromEntries(
        Object.entries(room.objectClocks).map(([versioningId, clock]) => [
            versioningId,
            clock.version,
        ]),
    )

    return {
        version: GAME_STATE_VERSION,
        gameState: serializedGameState,
        history: serializeHistory(room.history, true),
        globalVersion: room.globalClock.advance(SERVER_PERM_ID),
        objectClocks,
        // We don't need those in SCS mode
        mutationVersions: {},
    }
}

/**
 * Validate before applying in-game messages ( mutations, shuffle, resync )
 */
function validateBeforeGameMessage(connection: ConnectionInfo): StartedRoom {
    // Check the user is identified
    if (!connection.permId) {
        throw new UserNotIdentified('User is not identified')
    }

    // Check rate limit
    if (!checkRateLimit(connection.permId)) {
        logger.warn(`Rate limit exceeded for user ${connection.permId}`)
        throw new Error('Rate limit exceeded')
    }

    // Get room and its game state
    const room = ensureRoom(connection.roomId)

    if (!room.gameId || !room.gameState) {
        logger.warn(`Game not launched for user ${connection.permId} in room ${room.id}`)
        throw new Error('Game not launched')
    }

    return room as StartedRoom
}

/**
 * Handle game mutation from client
 */
export async function handleGameMutation(
    connection: ConnectionInfo,
    message: ScsGameMutationMessage,
) {
    try {
        let room = validateBeforeGameMessage(connection)

        const mutation = unpackGameMutation(message.gameMutation)
        // Verify mutation author matches sender
        if (mutation.author.permId !== connection.permId) {
            logger.warn(
                `Mutation author mismatch: ${mutation.author.permId} !== ${connection.permId}`,
            )
            throw new Error('Mutation author mismatch')
        }

        // Validate mutation
        const validity = mutation.canApply()
        if (!validity.isValid) {
            logger.warn(`Invalid mutation: ${validity.reason}`)
            throw new Error(`Invalid mutation: ${validity.reason}`)
        }

        room.globalClock.update(message.globalVersion)

        if (mutation.syncMode == MutationSyncMode.Ordered) {
            if (!message.version) {
                throw new Error(`Missing version for Ordered mutation`)
            }

            room.objectClocks[mutation.versioningId] ??= new VectorClock()
            const clock = room.objectClocks[mutation.versioningId]

            if (clock.compare(message.version) == ClockCompare.Concurrent) {
                logger.info(
                    `Conflict detected for mutation ${mutation.name} (${message.gameMutationId}) in room ${room.id}, rejecting`,
                )
                const rejectionMessage: ScsMutationRejectedMessage = {
                    type: MultiplayerMessageType.MutationRejected,
                    gameMutationId: message.gameMutationId,
                }
                send(connection.webSocket, rejectionMessage)
                return
            }

            clock.merge(message.version)
        }

        // Apply mutation
        mutation.apply()

        // Store in history
        room.history.addGameMutation(mutation)

        logger.debug(`Applied mutation ${mutation.name} to room ${room.id}`)

        // Persist updated game state, history, and room clocks
        persistence.saveRoom(room)

        // Broadcast mutation to all players in the room
        broadcastTailored(room.id, permId => {
            const knownCards = getKnownCards(room.gameState, permId, room.seats)
            return {
                ...message,
                gameMutation: redactPackedMutation(message.gameMutation, knownCards),
                knownCards,
            }
        })
    } catch (error) {
        logger.error(`Error applying mutation: ${error}`)
        captureException(error)
        sendError(connection.webSocket, `${error}`)
    }
}

/**
 * Handle shuffle request from client
 */
export async function handleShuffleCardRegion(
    connection: ConnectionInfo,
    message: ScsShuffleCardRegionMessage,
) {
    try {
        const room = validateBeforeGameMessage(connection)
        const gameState = room.gameState

        const cardRegion = gameState.cardRegions[message.cardRegionOid]
        const player = getPlayer(gameState, connection.permId)

        if (!cardRegion) {
            throw new Error('Card region not found')
        }
        if (!player) {
            throw new Error('Player not found')
        }

        // Prevent multiple shuffle
        const lastMutation = room.history.getLastMutationForPlayer(player.oid)
        if (lastMutation && lastMutation.serializedMutation.name == 'shuffle') {
            sendError(connection.webSocket, `This stack is already shuffled.`)
            return
        }

        logger.debug(`Shuffling ${cardRegion.name} for room ${room.id}`)

        // Generate new OIDs for all cards in the region,
        // so users can't track the new positions
        const newOidArray: CardOid[] = []
        for (const oldOid of cardRegion.cardsOid) {
            const newOid = generateCardOid()
            newOidArray.push(newOid)
            const card = gameState.cards[oldOid]
            if (card) {
                // Store a snapshot for history deserialization, under the old oid.
                // It has to be a separate object holding the old oid : the live card is
                // about to get the new one, and staleCards is keyed by card.oid on
                // rehydration. Keeping the live card here would both alias the history
                // to a mutating object, and land under the new oid on the clients.
                // This mirrors what the shuffle mutation does client-side.
                rehydrateCard(
                    gameState,
                    JSON.parse(JSON.stringify(card)) as SerializedCard,
                    'staleCards',
                )
                // Update the card's oid
                card.oid = newOid
                // Move the card to the new key
                gameState.cards[newOid] = card
                // Delete the old key
                delete gameState.cards[oldOid]

                if (gameState.knownCards[oldOid]) {
                    gameState.knownCards[newOid] = gameState.knownCards[oldOid]
                    delete gameState.knownCards[oldOid]
                }

                if (oldOid in gameState.revelations) {
                    gameState.revelations[newOid] = gameState.revelations[oldOid]
                    delete gameState.revelations[oldOid]
                }
            }
        }

        // Generate shuffled order with new OIDs
        const shuffledOrder = shuffleArray(newOidArray)

        logger.debug(`Shuffled ${cardRegion.name}: ${shuffledOrder.length} cards`)

        // Serialize the shuffled cards
        const serializedShuffledCards = shuffledOrder.map(newOid =>
            JSON.parse(JSON.stringify(gameState.cards[newOid])),
        )

        const shuffleMutation = gameMutations.shuffle.createMutation(player, {
            cardRegion,
            previousCardsOrder: [...cardRegion.cardsOid],
            cardsOrder: shuffledOrder,
            shuffledCards: serializedShuffledCards,
        })

        const packedShuffleMutation = packGameMutation(shuffleMutation)
        // Packing will transform cards into their oid, we need to override this behaviour
        packedShuffleMutation.p.shuffledCards = serializedShuffledCards

        const mutationMessage: ScsGameMutationMessage = {
            type: MultiplayerMessageType.GameMutation,
            gameMutation: packedShuffleMutation,
            gameMutationId: shuffleMutation.id,
            globalVersion: message.globalVersion,
            version: message.version,
        }

        // Apply mutation through the normal pipeline (validates, applies, persists, broadcasts)
        await handleGameMutation(connection, mutationMessage)
    } catch (error) {
        logger.error(`Error shuffling card region: ${error}`)
        captureException(error)
        sendError(connection.webSocket, `${error}`)
    }
}

/**
 * Handle random result request from client (coin flip or d6 roll)
 */
export async function handleRandomResultRequest(
    connection: ConnectionInfo,
    message: ScsRandomResultRequestMessage,
) {
    try {
        const room = validateBeforeGameMessage(connection)
        const gameState = room.gameState

        const player = getPlayer(gameState, connection.permId)
        if (!player) {
            throw new Error('Player not found')
        }

        const max = message.randomType === 'coin' ? 2 : 6
        const result = Math.floor(Math.random() * max) + 1

        logger.debug(`Random result for ${message.randomType}: ${result} in room ${room.id}`)

        const randomResultMutation = gameMutations.randomResult.createMutation(player, {
            randomType: message.randomType,
            result,
        })

        const packedMutation = packGameMutation(randomResultMutation)

        const mutationMessage: ScsGameMutationMessage = {
            type: MultiplayerMessageType.GameMutation,
            gameMutation: packedMutation,
            gameMutationId: randomResultMutation.id,
            globalVersion: message.globalVersion,
        }

        await handleGameMutation(connection, mutationMessage)
    } catch (error) {
        logger.error(`Error handling random result request: ${error}`)
        captureException(error)
        sendError(connection.webSocket, `${error}`)
    }
}

/**
 * Handle game state resync request from client
 * Used when a client reconnects or needs to recover from disconnection.
 */
export function handleRequestResync(connection: ConnectionInfo): void {
    try {
        const room = validateBeforeGameMessage(connection)

        const mutationMessage: ScsGameStateMessage = {
            type: MultiplayerMessageType.GameState,
            serializedGame: getSerializedGame(room.gameState, room, connection.permId),
            hash: hashObject(room.gameState),
        }

        send(connection.webSocket, mutationMessage)

        logger.debug(`Resync sent for room ${room.id}, player ${connection.permId}`)
    } catch (error) {
        logger.error(`Resync failed: ${error}`)
        captureException(error)
        sendError(connection.webSocket, `Resync failed: ${error}`)
    }
}
