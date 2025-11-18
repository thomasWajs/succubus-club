import { useMultiplayerStore } from '@/store/multiplayer.ts'
import {
    deserializeGameMutation,
    deserializeObject,
    loadGame,
    SerializedChatMessage,
    SerializedGame,
    serializeGameMutation,
    serializeMultiplayerGame,
} from '@/gateway/serialization.ts'
import { AnyGameMutation, applyMutationLocally, GameMutationId } from '@/state/gameMutations.ts'
import { Mutex } from '@/utils.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { useBusStore, useGameBusStore } from '@/store/bus.ts'
import * as logging from '@/logging.ts'
import {
    GameMutationMessage,
    GameStateSyncMessage,
    MutationSyncMode,
    PermanentId,
    VectorClockVersion,
    VersioningId,
} from '@/multiplayer/types.ts'
import { ClockCompare, LamportClock, VectorClock } from '@/multiplayer/clock.ts'
import { ChatMessage, useHistoryStore } from '@/store/history.ts'
import { useCoreStore } from '@/store/core.ts'
import { fetchGameState, storeGameState } from '@/gateway/gameState.ts'
import { resetState } from '@/game/setup.ts'

const DESYNC_MESSAGE_MINIMUM_TIME_VISIBLE = 2000 // 2 seconds in milliseconds

// This Mutex ensure we're sending/receiving mutations & resync one by one.
// It's used around every section that access the clocks and update the gameState.
const stateMutex = new Mutex()

/**
 * Game Mutations
 */

type ReceivedMutation = {
    gameMutation: AnyGameMutation
    version: VectorClockVersion
}
let receivedMutations: Set<GameMutationId> = new Set()
// This is for messages that arrives out of order during a game
let pendingOrderedMutations: ReceivedMutation[] = []
// This is for messages received before joining or during a resync
let pendingSyncMessage: (GameMutationMessage | SerializedChatMessage)[] = []

export function resetSync() {
    receivedMutations = new Set()
    pendingOrderedMutations = []
    // Don't reset pendingSyncMessage here !!

    const multiplayer = useMultiplayerStore()
    multiplayer.globalClock = new LamportClock(useCoreStore().userProfile.permanentId)
    multiplayer.objectClocks = {}
    multiplayer.mutationVersions = {}
}

// Separate from the global resetSync function because
// we needs this array precisely when the state is being reset/started/resynced
export function resetPendingSyncMessage() {
    pendingSyncMessage = []
}

function ensureClock(versioningId: VersioningId): VectorClock {
    const multiplayer = useMultiplayerStore()
    multiplayer.objectClocks[versioningId] ??= new VectorClock()
    return multiplayer.objectClocks[versioningId]
}

// Game messages can be received when the game is ready and we're not resyncing.
// If the message cannot be received, it will be buffered to be applyed later.
// This apply to game mutations and chat messages
function isReadyToReceive(message: GameMutationMessage | SerializedChatMessage) {
    const isReady = useCoreStore().gameStateIsReady && !useBusStore().isResyncing
    if (!isReady) {
        pendingSyncMessage.push(message)
    }
    return isReady
}

function flushPendingMessages() {
    const history = useHistoryStore()

    for (const message of pendingSyncMessage) {
        // GameMutationMessage
        if (Object.hasOwn(message, 'gameMutation')) {
            const gameMutationMessage = message as GameMutationMessage

            // Don't apply mutations that are already in the history
            if (gameMutationMessage.gameMutationId in history.gameMutationsMap) {
                continue
            }

            // We call the unsafe function because we're already in a lock
            _unsafeReceiveMutationMessage(gameMutationMessage)
        }
        // Chat Message
        else if (Object.hasOwn(message, 'text')) {
            // We call the unsafe function because we're already in a lock
            _unsafeReceiveChatMessage(message as SerializedChatMessage)
        }
    }
    resetPendingSyncMessage()
}

/**
 * Chat message
 */

export async function receiveChatMessage(serializedMessage: SerializedChatMessage) {
    await stateMutex.withLock(() => _unsafeReceiveChatMessage(serializedMessage))
}

export function _unsafeReceiveChatMessage(serializedMessage: SerializedChatMessage) {
    // Chat message received during init or a resync, buffer them for later
    if (!isReadyToReceive(serializedMessage)) {
        return
    }
    const chatMessage = deserializeObject<ChatMessage>(serializedMessage)
    useHistoryStore().addChatMessage(chatMessage)
}

/**
 * Game mutations
 */

function canApplyOrderedMutation(receivedMutation: ReceivedMutation) {
    const clock = ensureClock(receivedMutation.gameMutation.versioningId)
    return clock.isNextMutation(
        receivedMutation.version,
        receivedMutation.gameMutation.author.permId,
    )
}

function findPlayerWinningConflict(
    localConflictingMutations: AnyGameMutation[],
    remoteMutation: AnyGameMutation,
): PermanentId {
    const gameState = useGameStateStore()
    const conflictingAuthors = new Set(localConflictingMutations.map(m => m.author.permId))
    conflictingAuthors.add(remoteMutation.author.permId)

    const numPlayers = gameState.orderedPlayers.length
    for (let i = 0; i < numPlayers; i++) {
        const playerIndex = (gameState.activePlayerIndex + i) % numPlayers
        const player = gameState.orderedPlayers[playerIndex]
        if (conflictingAuthors.has(player.permId)) {
            return player.permId
        }
    }

    // This case should not be reached if there's a conflict.
    logging.captureMessage(
        `Could not determine a winning player in a conflict. Defaulting to arbitrary player.`,
        'error',
    )
    return gameState.activePlayer ?
            gameState.activePlayer.permId
        :   gameState.orderedPlayers[0].permId
}

function getConflictingMutations(
    remoteVersion: VectorClockVersion,
    versioningId: VersioningId,
): AnyGameMutation[] {
    const historyStore = useHistoryStore()
    const multiplayerStore = useMultiplayerStore()

    // Find all local mutations that the remote peer has not seen.
    // TODO : rework the data structure so we don't have to go through all history
    return historyStore.gameMutations.filter(m => {
        // Must be an ordered mutation for the same object.
        if (
            m.syncMode !== MutationSyncMode.Ordered ||
            m.versioningId !== versioningId ||
            m.cancelToResolveConflict
        ) {
            return false
        }

        // Retrieve the version for this mutation from the store.
        const mutationVersion = multiplayerStore.mutationVersions[m.id]
        if (!mutationVersion) {
            return false
        }

        // A mutation is conflicting if its vector clock is concurrent with the remote one.
        const mutationClock = new VectorClock(mutationVersion)
        return mutationClock.compare(remoteVersion) === ClockCompare.Concurrent
    }) as AnyGameMutation[]
}

function applyPeerMutation(gameMutation: AnyGameMutation, remoteVersion?: VectorClockVersion) {
    const multiplayer = useMultiplayerStore()

    // remoteVersion should always be defined, we checked in _unsafeReceiveMutationMessage
    if (gameMutation.syncMode == MutationSyncMode.Ordered && remoteVersion) {
        const clock = multiplayer.objectClocks[gameMutation.versioningId]

        // There's a conflict to resolve
        if (clock.compare(remoteVersion) == ClockCompare.Concurrent) {
            multiplayer.stats.conflicts++

            const localConflictingMutations = getConflictingMutations(
                remoteVersion,
                gameMutation.versioningId,
            )

            const winningPermId = findPlayerWinningConflict(localConflictingMutations, gameMutation)

            // Handle mutations from losing players, in reverse order
            for (const localMutation of localConflictingMutations.toReversed()) {
                if (localMutation.author.permId !== winningPermId && localMutation.isCancellable) {
                    // Cancel mutations that were already applied, but only locally.
                    // Broadcasting is not needed as other peers will run the same conflict resolution.
                    const cancelMutation = localMutation.getCancelMutation()
                    // display in the logs there was a conflict to decrease user surprise
                    cancelMutation.cancelToResolveConflict = true
                    applyMutationLocally(cancelMutation)
                }
            }

            // If the incoming mutation is from a losing player, discard it and stop.
            if (gameMutation.author.permId !== winningPermId) {
                // Merge the clock to acknowledge the loser's version and prevent repeated conflicts
                clock.merge(remoteVersion)
                return // Stop processing this mutation
            }
        }
    }

    const validity = gameMutation.canApply()
    if (!validity.isValid) {
        logging.captureMessage(
            `Received an invalid game mutation : ${validity.reason} | ${JSON.stringify(gameMutation)}`,
            'warning',
        )

        // TODO: this can happen when screwing up the game state due to concurrency/conflict. Force a state resync ?
        // In the meantime, update the clock state to prevent further conflicts
        if (gameMutation.syncMode == MutationSyncMode.Ordered && remoteVersion) {
            multiplayer.objectClocks[gameMutation.versioningId].merge(remoteVersion)
        }

        return
    }

    applyMutationLocally(gameMutation)

    // remoteVersion should always be defined, we checked in _unsafeReceiveMutationMessage
    if (gameMutation.syncMode == MutationSyncMode.Ordered && remoteVersion) {
        multiplayer.objectClocks[gameMutation.versioningId].merge(remoteVersion)
    }
}

function flushPendingMutations() {
    let changed = true
    while (changed) {
        changed = false
        const stillPending: ReceivedMutation[] = []
        for (const mutation of pendingOrderedMutations) {
            if (canApplyOrderedMutation(mutation)) {
                applyPeerMutation(mutation.gameMutation, mutation.version)
                changed = true
            } else {
                stillPending.push(mutation)
            }
        }
        pendingOrderedMutations = stillPending
    }
}

// Wraps mutation making around a Mutex to avoid concurrent updates
export async function makeMutationMessage(
    gameMutation: AnyGameMutation,
): Promise<GameMutationMessage> {
    // Protected call to _unsafeMakeMutationMessage
    return await stateMutex.withLock(() => _unsafeMakeMutationMessage(gameMutation))
}

function _unsafeMakeMutationMessage(gameMutation: AnyGameMutation): GameMutationMessage {
    const multiplayer = useMultiplayerStore()

    const message: GameMutationMessage = {
        gameMutation: serializeGameMutation(gameMutation),
        gameMutationId: gameMutation.id,
        // Advance our global clock when we send a local mutation
        globalVersion: multiplayer.globalClock.advance(),
    }

    // Add version to Ordered mutations
    if (gameMutation.syncMode == MutationSyncMode.Ordered) {
        const clock = ensureClock(gameMutation.versioningId)
        message.version = clock.advance()
        multiplayer.mutationVersions[gameMutation.id] = message.version
    }

    return message
}

// Wraps mutation receiving around a Mutex to avoid concurrent updates
export async function receiveMutationMessage(gameMutationMessage: GameMutationMessage) {
    // Protected call to _unsafeReceiveMutationMessage
    await stateMutex.withLock(() => _unsafeReceiveMutationMessage(gameMutationMessage))
}

function _unsafeReceiveMutationMessage(gameMutationMessage: GameMutationMessage) {
    // Mutation received during init or a resync, buffer them for later
    if (!isReadyToReceive(gameMutationMessage)) {
        return
    }

    const multiplayer = useMultiplayerStore()

    try {
        // Don't process twice the same mutation
        if (receivedMutations.has(gameMutationMessage.gameMutationId)) {
            return
        }
        receivedMutations.add(gameMutationMessage.gameMutationId)

        // Update our global clock when we receive a non-applied remote mutation,
        // whatever the result ( pending, applied, invalid )
        multiplayer.globalClock.update(gameMutationMessage.globalVersion)

        const gameMutation = deserializeGameMutation(gameMutationMessage.gameMutation)
        const remoteVersion = gameMutationMessage.version

        if (gameMutation.syncMode == MutationSyncMode.Ordered) {
            if (!remoteVersion) {
                logging.captureMessage(`Missing version for Ordered mutation`, 'error')
                return
            }

            // Store the version from the message in the multiplayer store
            multiplayer.mutationVersions[gameMutation.id] = remoteVersion

            ensureClock(gameMutation.versioningId)

            const receivedMutation: ReceivedMutation = {
                gameMutation,
                version: remoteVersion,
            }

            // Buffer out-of-order mutations
            if (!canApplyOrderedMutation(receivedMutation)) {
                pendingOrderedMutations.push(receivedMutation)
                multiplayer.stats.pendingMutations++
                return
            }
        }

        applyPeerMutation(gameMutation, remoteVersion)
        // Check if applying this mutation allows to release pending mutations
        flushPendingMutations()
    } catch (e) {
        logging.captureException(e)
        // TODO : Should we resync on error ?
        // requestResyncGameState()
        return
    }
}

/**
 * State Init
 */

export async function applyInitialGameState(serializedGame: SerializedGame) {
    return stateMutex.withLock(async () => {
        resetState()
        loadGame(serializedGame)
        flushPendingMessages()
    })
}

/**
 * State Resync
 */

let desyncDate: Date | null = null

export function startGameResync(isUserRequest: boolean) {
    const bus = useBusStore()

    bus.isResyncing = true

    useGameStateStore().$reset()
    useHistoryStore().$reset()
    useGameBusStore().$reset()
    resetSync()

    if (isUserRequest) {
        bus.alertWarning('Resyncing... Please wait.', {
            dismissible: false,
            blockInteraction: true,
        })
    } else {
        bus.alertError('Your game is out of sync with other players. Resyncing... Please wait.', {
            dismissible: false,
            blockInteraction: true,
        })
    }
    desyncDate = new Date()
}

export async function makeResyncGameStateMessage(): Promise<GameStateSyncMessage> {
    return stateMutex.withLock(async () => {
        const multiplayer = useMultiplayerStore()

        return {
            gameStateId: await storeGameState(serializeMultiplayerGame()),
            globalVersion: multiplayer.globalClock.advance(),
            hash: useGameStateStore().hash(),
        }
    })
}

export async function applyGameResync(syncMessage: GameStateSyncMessage) {
    const multiplayer = useMultiplayerStore()
    const bus = useBusStore()

    // Protect access to global clock
    await stateMutex.withLock(async () => {
        // Actually load game only if remote state is newer than ours,
        // and only if hashes are different
        if (
            multiplayer.globalClock.compare(syncMessage.globalVersion) <= 0 &&
            syncMessage.hash != useGameStateStore().hash()
        ) {
            const serializedGame = await fetchGameState(syncMessage.gameStateId)

            if (!serializedGame) {
                throw new Error(`Failed to fetch game state from ${syncMessage.gameStateId}`)
            }

            loadGame(serializedGame)

            // Update the global clock
            multiplayer.globalClock.update(syncMessage.globalVersion)

            // Sync the object clocks
            for (const [versioningId, clockVersion] of Object.entries(
                serializedGame.objectClocks,
            )) {
                multiplayer.objectClocks[versioningId] = new VectorClock(clockVersion)
            }

            // Sync the mutation versions
            multiplayer.mutationVersions = serializedGame.mutationVersions
        }

        // Let the message visible at least 2 seconds
        if (bus.isResyncing) {
            const timeout =
                DESYNC_MESSAGE_MINIMUM_TIME_VISIBLE -
                (new Date().getTime() - (desyncDate?.getTime() ?? 0))
            setTimeout(() => {
                bus.alertSuccess('Game successfully resynced with other players.')
            }, timeout)
        }
        bus.isResyncing = false

        // Flush mutations that we may have received during the sync
        flushPendingMessages()
    })
}
