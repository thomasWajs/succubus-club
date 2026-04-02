import { send, sendError } from './wsServer.ts'
import { captureException } from './logging.ts'
import logger from './logger.ts'
import { broadcastTailored, ensureRoom, getRoom } from './rooms.ts'
import {
    EMPTY_SEATING,
    MultiplayerMessageType,
    MutationSyncMode,
    PermanentId,
    RoomId,
    ScsGameMutationMessage,
    ScsGameStateMessage,
    ScsMutationRejectedMessage,
    ScsShuffleCardRegionMessage,
    SerializedMultiplayerGame,
} from '@/shared/types/multiplayer.ts'
import { ConnectionInfo, RateLimitInfo, Room, SERVER_PERM_ID } from './types.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { setupMultiplayerGameState } from '@/shared/state/setup.ts'
import { getUser } from './users.ts'
import { getGameState } from '@/shared/registries.ts'
import { KnownCards } from '@/shared/types/state.ts'
import { anyoneCanSee, canSeeOrPeek } from '@/shared/state/cardVisibility.ts'
import {
    hashObject,
    packGameMutation,
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
    const seatedUsers = room.seating.map(permId => getUser(permId))
    setupMultiplayerGameState(gameState, seatedUsers, room.userDecks)
    persistence.saveGameState(gameState)

    room.gameId = gameState.gameId
    persistence.saveRoom(room)

    return gameState
}

/**
 * Get game state for a room (returns undefined if not found)
 */
export function getRoomGameState(roomId: RoomId): GameState | undefined {
    const room = getRoom(roomId)
    if (room && room.gameId) {
        return getGameState(room.gameId)
    }
}

export function getPlayer(gameState: GameState, permId: PermanentId) {
    const playerOid = gameState.usersToPlayer[permId]
    return playerOid ? gameState.players[playerOid] : undefined
}

/**
 * In a game state, get cards that are known by a given user
 */
export function getKnownCards(gameState: GameState, permId: PermanentId): KnownCards {
    const userKnownCards: KnownCards = {}
    const player = getPlayer(gameState, permId)
    for (const card of Object.values(gameState.cards)) {
        if (card.krcgId && (anyoneCanSee(card) || (player && canSeeOrPeek(player, card)))) {
            userKnownCards[card.oid] = card.krcgId
        }
    }
    return userKnownCards
}

/**
 * Get a serialized game for launch or resync
 */
export function getSerializedGame(
    gameState: GameState,
    room: Room,
    permId: PermanentId,
): SerializedMultiplayerGame {
    const knownCards = getKnownCards(gameState, permId)
    const userGameState = { ...gameState, knownCards } as GameState
    const serializedGameState = serializeGameState(userGameState)
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
        objectClocks,
        // We don't need those in SCS mode
        mutationVersions: {},
    }
}

/**
 * Validate before applying in-game messages ( mutations, shuffle, resync )
 */
function validateBeforeGameMessage(connection: ConnectionInfo) {
    // Check rate limit
    if (!checkRateLimit(connection.permId)) {
        logger.warn(`Rate limit exceeded for user ${connection.permId}`)
        throw new Error('Rate limit exceeded')
    }

    // Get room and its game state
    const room = ensureRoom(connection.roomId)

    if (!room.gameId) {
        logger.warn(`Game not launched for user ${connection.permId} in room ${room.id}`)
        throw new Error('Game not launched')
    }

    const gameState = getGameState(room.gameId)
    return { room, gameState }
}

/**
 * Handle game mutation from client
 */
export async function handleGameMutation(
    connection: ConnectionInfo,
    message: ScsGameMutationMessage,
) {
    try {
        let { room, gameState } = validateBeforeGameMessage(connection)

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

        // Persist updated game state and room clocks
        persistence.saveGameState(gameState)
        persistence.saveRoom(room)

        // Broadcast mutation to all players in the room
        broadcastTailored(room.id, permId => {
            const knownCards = getKnownCards(gameState, permId)
            return { ...message, knownCards }
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
        const { room, gameState } = validateBeforeGameMessage(connection)

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
                // Store for history deserialization
                gameState.staleCards[oldOid] = card
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
 * Handle game state resync request from client
 * Used when a client reconnects or needs to recover from disconnection.
 */
export function handleRequestResync(connection: ConnectionInfo): void {
    try {
        const { room, gameState } = validateBeforeGameMessage(connection)

        const mutationMessage: ScsGameStateMessage = {
            type: MultiplayerMessageType.GameState,
            serializedGame: getSerializedGame(gameState, room, connection.permId),
            globalVersion: room.globalClock.advance(SERVER_PERM_ID),
            hash: hashObject(gameState),
        }

        send(connection.webSocket, mutationMessage)

        logger.debug(`Resync sent for room ${room.id}, player ${connection.permId}`)
    } catch (error) {
        logger.error(`Resync failed: ${error}`)
        captureException(error)
        sendError(connection.webSocket, `Resync failed: ${error}`)
    }
}
