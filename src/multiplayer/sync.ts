import { useMultiplayerStore } from '@/store/multiplayer.ts'
import {
    deserializeGameMutation,
    loadGame,
    serializeGame,
    serializeGameMutation,
} from '@/gateway/serialization.ts'
import { AnyGameMutation, applyMutationLocally } from '@/state/gameMutations.ts'
import { Mutex } from '@/utils.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { useBusStore } from '@/store/bus.ts'
import * as logging from '@/logging.ts'
import {
    ClockVersion,
    GameMutationMessage,
    VersionningId,
    PermanentId,
    MutationSyncMode,
    GameStateSyncMessage,
} from '@/multiplayer/common.ts'
import { useCoreStore } from '@/store/core.ts'

const DESYNC_MESSAGE_MINIMUM_TIME_VISIBLE = 2000 // 2 seconds in milliseconds

// This Mutex ensure we're sending/receiving mutations & resync one by one.
// It's used around every section that access the clocks and update the gameState.
const stateMutex = new Mutex()

/**
 * Lamport Clock
 */

export class LamportClock implements ClockVersion {
    constructor(
        public permId: PermanentId,
        public tick: number = 0, // Increment when we advance the clock
    ) {}

    // Advance when we send local mutations
    advance(): ClockVersion {
        // Increment tick
        this.tick++
        // We made the mutation, set our permid
        this.permId = useCoreStore().userProfile.permanentId
        return this
    }

    // Update when we receive remote mutations
    update(remote: ClockVersion): ClockVersion {
        // Update the tick
        this.tick = Math.max(this.tick, remote.tick) + 1
        // Set remote permId
        this.permId = remote.permId
        return this
    }

    compare(remote: ClockVersion): number {
        // Baseline case : ordered mutations
        if (this.tick !== remote.tick) {
            return this.tick - remote.tick
        }
        // Concurrent case : arbitrary consistent tie-breaker with permId
        return this.permId.localeCompare(remote.permId)
    }
}

/**
 * Game Mutations
 */

function ensureClock(versionningId: VersionningId) {
    const multiplayer = useMultiplayerStore()

    multiplayer.objectVersions[versionningId] ??= new LamportClock(
        useCoreStore().userProfile.permanentId,
    )
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
        // Advance our global clock when we send a local mutation
        globalVersion: multiplayer.globalClock.advance(),
    }

    // Add version to LWW mutations
    if (gameMutation.syncMode == MutationSyncMode.LWW) {
        ensureClock(gameMutation.versioningId)
        const clock = multiplayer.objectVersions[gameMutation.versioningId]
        message.version = clock.advance()
    }

    return message
}

// Wraps mutation dispatching around a Mutex to avoid concurrent updates
export async function applyPeerMutation(gameMutationMessage: GameMutationMessage) {
    // Protected call to _unsafeApplyPeerMutation
    return await stateMutex.withLock(() => _unsafeApplyPeerMutation(gameMutationMessage))
}

function _unsafeApplyPeerMutation(gameMutationMessage: GameMutationMessage) {
    const multiplayer = useMultiplayerStore()

    try {
        // Update our global clock when we receive a remote mutation
        multiplayer.globalClock.update(gameMutationMessage.globalVersion)

        const gameMutation = deserializeGameMutation(gameMutationMessage.gameMutation)
        const remoteVersion = gameMutationMessage.version

        let lwwDiscard = false // Should we ignore this mutation because of LWW ?
        if (gameMutation.syncMode == MutationSyncMode.LWW) {
            if (!remoteVersion) {
                logging.captureMessage(`Missing version for LWW mutation`, 'error')
                return
            }

            ensureClock(gameMutation.versioningId)
            const clock = multiplayer.objectVersions[gameMutation.versioningId]
            // Apply LWW here with Lamport clock comparison
            lwwDiscard = clock.compare(remoteVersion) > 0
        }

        if (lwwDiscard) {
            return
        }

        const validity = gameMutation.canApply()
        if (!validity.isValid) {
            logging.captureMessage(
                `Received an invalid game mutation : ${validity.reason} | ${JSON.stringify(gameMutationMessage.gameMutation)}`,
                'warning',
            )
            return
        }

        applyMutationLocally(gameMutation)

        // We know we have a remoteVersion, but typescript can't understand it, so we add a useless check
        if (gameMutation.syncMode == MutationSyncMode.LWW && remoteVersion) {
            multiplayer.objectVersions[gameMutation.versioningId].update(remoteVersion)
        }
    } catch (e) {
        logging.captureException(e)
        // TODO : Should we resync on error ?
        // requestResyncGameState()
        return
    }
}

/**
 * State Resync
 */

let desyncDate: Date | null = null

export function startGameResync(isUserRequest: boolean) {
    const bus = useBusStore()

    bus.isResyncing = true

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

export async function makeResyncGameStateMessage() {
    return stateMutex.withLock(() => {
        // TODO : synchronize History Log as well ==> need to handle card visibility
        const multiplayer = useMultiplayerStore()
        return {
            serializedGame: serializeGame(),
            globalVersion: multiplayer.globalClock.advance(),
            objectVersions: multiplayer.objectVersions,
            hash: useGameStateStore().hash(),
        }
    })
}

export async function applyGameResync(syncMessage: GameStateSyncMessage) {
    const multiplayer = useMultiplayerStore()
    const bus = useBusStore()

    // Protect access to global clock
    await stateMutex.withLock(() => {
        // Actually load game only if remote state is newer than ours,
        // and only if hashes are different
        if (
            multiplayer.globalClock.compare(syncMessage.globalVersion) <= 0 &&
            syncMessage.hash != useGameStateStore().hash()
        ) {
            loadGame(syncMessage.serializedGame)

            // Update the global clock
            multiplayer.globalClock.update(syncMessage.globalVersion)

            // Sync the object clocks
            for (const [versionningId, clockVersion] of Object.entries(
                syncMessage.objectVersions,
            )) {
                multiplayer.objectVersions[versionningId] = new LamportClock(
                    clockVersion.permId,
                    clockVersion.tick,
                )
            }
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
    })
}
