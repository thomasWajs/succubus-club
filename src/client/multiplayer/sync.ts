import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { loadGame, serializeMultiplayerGame } from '@/client/gateway/serialization.ts'
import { AnyGameMutation, GameMutationId } from '@/shared/state/gameMutations.ts'
import { Mutex } from '@/shared/utils.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { useBusStore, useGameBusStore } from '@/client/store/bus.ts'
import * as logging from '@/client/logging.ts'
import {
    GameMutationMessage,
    GameStateMessage,
    MutationSyncMode,
    PermanentId,
    SerializedChatMessage,
    SerializedGame,
    VectorClockVersion,
    VersioningId,
} from '@/shared/types/multiplayer.ts'
import { ClockCompare, LamportClock, VectorClock } from '@/shared/multiplayer/clock.ts'
import { useHistoryStore } from '@/client/store/history.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { fetchGameState, storeGameState } from '@/client/gateway/gameState.ts'
import { resetState } from '@/client/state/setup.ts'
import { ChatMessage, MutationHistoryEntry } from '@/shared/types/history.ts'
import { applyMutationLocally } from '@/client/state/gameMutations.ts'
import {
    deserializeGameMutation,
    deserializeObject,
    hashObject,
    packGameMutation,
    unpackGameMutation,
} from '@/shared/serialization.ts'

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
// Mutations already seen : sent by us, or already received
let seenMutations: Set<GameMutationId> = new Set()
// This is for messages that arrives out of order during a game
let pendingOrderedMutations: ReceivedMutation[] = []
// This is for messages received before joining or during a resync
let pendingSyncMessage: (GameMutationMessage | SerializedChatMessage)[] = []

export function resetSync() {
    seenMutations = new Set()
    pendingOrderedMutations = []
    // Don't reset pendingSyncMessage here !!

    const multiplayer = useMultiplayerStore()
    multiplayer.globalClock = new LamportClock(useCoreStore().userProfile.permanentId)
    multiplayer.objectClocks = {}
    multiplayer.mutationVersions = {}
    multiplayer.conflictWindows = {}
}

// Separate from the global resetSync function because
// we needs this array precisely when the state is being reset/started/resynced
export function resetPendingSyncMessage() {
    pendingSyncMessage = []
}

export function ensureClock(versioningId: VersioningId): VectorClock {
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
    const chatMessage = deserializeObject<ChatMessage>(
        serializedMessage,
        useGameStateStore().gameId,
    )
    useHistoryStore().addChatMessage(chatMessage)
}

/**
 * Conflict windows for detecting conflicting game mutation
 */

function getConflictWindow(versioningId: VersioningId) {
    const multiplayer = useMultiplayerStore()
    if (!multiplayer.conflictWindows[versioningId]) {
        multiplayer.conflictWindows[versioningId] = []
    }
    return multiplayer.conflictWindows[versioningId]
}

function addToConflictWindow(mutationEntry: MutationHistoryEntry, versioningId: VersioningId) {
    // Don't add mutations that are conflict resolvers
    if (mutationEntry.serializedMutation.cancelsMutationId) {
        return
    }
    getConflictWindow(versioningId).push(mutationEntry)
}

function getFilteredConflictWindow(
    versioningId: VersioningId,
    version: VectorClockVersion,
    predicate: (clockCompare: ClockCompare) => boolean,
) {
    const multiplayer = useMultiplayerStore()
    const history = useHistoryStore()
    const window = getConflictWindow(versioningId)

    return window.filter(mutationEntry => {
        const compareToVersion = multiplayer.mutationVersions[mutationEntry.id]
        // Don't cancel twice a mutation
        if (
            !compareToVersion ||
            history.cancelledMutations.has(mutationEntry.id) ||
            mutationEntry.serializedMutation.cancelsMutationId
        ) {
            return false
        }
        return predicate(new VectorClock(compareToVersion).compare(version))
    })
}

// Remove resolved mutations from the conflict window.
// Called after successfully applying a mutation without conflicts
function pruneConflictWindow(versioningId: VersioningId, appliedVersion: VectorClockVersion) {
    const multiplayer = useMultiplayerStore()

    // Remove mutations that are now causally before the applied version
    multiplayer.conflictWindows[versioningId] = getFilteredConflictWindow(
        versioningId,
        appliedVersion,
        clockCompare => clockCompare !== ClockCompare.LowerThan,
    )
}

function getConflictingMutations(
    versioningId: VersioningId,
    remoteVersion: VectorClockVersion,
): MutationHistoryEntry[] {
    return getFilteredConflictWindow(
        versioningId,
        remoteVersion,
        clockCompare => clockCompare === ClockCompare.Concurrent,
    )
}

function findPlayerWinningConflict(
    localConflictingMutationEntries: MutationHistoryEntry[],
    remoteMutation: AnyGameMutation,
): PermanentId {
    const gameState = useGameStateStore()
    const conflictingAuthors = new Set(
        localConflictingMutationEntries.map(
            m => gameState.players[m.serializedMutation.authorOid].permId,
        ),
    )
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

function applyPeerMutation(gameMutation: AnyGameMutation, remoteVersion?: VectorClockVersion) {
    const multiplayer = useMultiplayerStore()

    // remoteVersion should always be defined, we checked in _unsafeReceiveMutationMessage
    if (gameMutation.syncMode == MutationSyncMode.Ordered && remoteVersion) {
        const clock = multiplayer.objectClocks[gameMutation.versioningId]

        // There's a conflict to resolve
        if (clock.compare(remoteVersion) == ClockCompare.Concurrent) {
            multiplayer.stats.conflicts++

            const localConflictingMutationEntries = getConflictingMutations(
                gameMutation.versioningId,
                remoteVersion,
            )

            const winningPermId = findPlayerWinningConflict(
                localConflictingMutationEntries,
                gameMutation,
            )

            // Handle mutations from losing players, in reverse order
            for (const localMutationEntry of localConflictingMutationEntries.toReversed()) {
                const localMutation = deserializeGameMutation(localMutationEntry.serializedMutation)

                if (localMutation.author.permId !== winningPermId) {
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
                // Prune conflict window since we've resolved this version
                pruneConflictWindow(gameMutation.versioningId, remoteVersion)
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
            pruneConflictWindow(gameMutation.versioningId, remoteVersion)
        }

        return
    }

    // Apply the mutation
    applyMutationLocally(gameMutation)

    // remoteVersion should always be defined, we checked in _unsafeReceiveMutationMessage
    if (gameMutation.syncMode == MutationSyncMode.Ordered && remoteVersion) {
        multiplayer.objectClocks[gameMutation.versioningId].merge(remoteVersion)

        // Track the applied remote mutation for future conflict detection
        const mutationEntry = useHistoryStore().gameMutationsMap[gameMutation.id]
        if (mutationEntry) {
            addToConflictWindow(mutationEntry, gameMutation.versioningId)
        }

        // Prune the conflict window after successful application
        pruneConflictWindow(gameMutation.versioningId, remoteVersion)
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
    const history = useHistoryStore()
    const core = useCoreStore()

    const message: GameMutationMessage = {
        gameMutation: packGameMutation(gameMutation),
        gameMutationId: gameMutation.id,
        // Advance our global clock when we send a local mutation
        globalVersion: multiplayer.globalClock.advance(core.userProfile.permanentId),
    }

    if (gameMutation.syncMode == MutationSyncMode.Ordered) {
        // Add version to Ordered mutations
        const clock = ensureClock(gameMutation.versioningId)
        message.version = clock.advance(core.userProfile.permanentId)
        multiplayer.mutationVersions[gameMutation.id] = message.version

        // Add to conflict window for future conflict detection
        const mutationEntry = history.gameMutationsMap[gameMutation.id]
        if (mutationEntry) {
            addToConflictWindow(mutationEntry, gameMutation.versioningId)
        }
    }

    seenMutations.add(gameMutation.id)

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
    const gameState = useGameStateStore()

    try {
        // Always update known cards, even if we reject the mutation
        gameState.updateKnownCards(gameMutationMessage.knownCards)

        // Don't process twice the same mutation
        if (seenMutations.has(gameMutationMessage.gameMutationId)) {
            return
        }
        seenMutations.add(gameMutationMessage.gameMutationId)

        // Update our global clock when we receive a non-applied remote mutation,
        // whatever the result ( pending, applied, invalid )
        multiplayer.globalClock.update(gameMutationMessage.globalVersion)

        const gameMutation = unpackGameMutation(gameMutationMessage.gameMutation)
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

export async function makeResyncGameStateMessage(): Promise<GameStateMessage> {
    return stateMutex.withLock(async () => {
        const multiplayer = useMultiplayerStore()
        const core = useCoreStore()

        return {
            gameStateId: await storeGameState(serializeMultiplayerGame()),
            globalVersion: multiplayer.globalClock.advance(core.userProfile.permanentId),
            hash: hashObject(useGameStateStore().$state),
        }
    })
}

export async function applyGameResync(syncMessage: GameStateMessage) {
    const multiplayer = useMultiplayerStore()
    const bus = useBusStore()

    // Protect access to global clock
    await stateMutex.withLock(async () => {
        // Actually load game only if remote state is newer than ours,
        // and only if hashes are different
        if (
            multiplayer.globalClock.compare(syncMessage.globalVersion) <= 0 &&
            syncMessage.hash != hashObject(useGameStateStore().$state)
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
