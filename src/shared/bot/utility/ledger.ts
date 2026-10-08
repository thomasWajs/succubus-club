import { Card } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { AnyGameMutation, GameMutationParams } from '@/shared/state/mutationBase.ts'
import { HistoryStore } from '@/shared/state/history.ts'
import { deserializeGameMutation } from '@/shared/serialization.ts'
import { isBleed } from '@/shared/state/minionActions.ts'
import { MinionAction, NO_BLOCK, NO_REACTION } from '@/shared/types/state.ts'
import { GameId, PlayerOid } from '@/shared/types/model.ts'

/**
 * What the table did, in numbers: a compact ledger folded from the mutations, so that an agent
 * never reads the heavy mutation history. Only public observations are kept, by player oid, so
 * the same ledger is valid next to the live state and next to a player's view of it.
 *
 * The ledger is a pure fold: building it live (foldMutation after each applied mutation) and
 * rebuilding it from the history (rebuildLedger) give the same result. A cancelled mutation is not
 * undone ( bots never cancel ).
 */

export type PlayerLedger = {
    actionsDeclared: number
    bleedsDeclared: number
    // The pool each of its bleeds that no block stopped took from the target
    bleedAmounts: number[]
    // The pool it lost to the bleeds of the others
    poolLostToBleeds: number
    blocksAttempted: number
    blocksSucceeded: number
    blocksFailed: number
    // Attempts it gave up before they were resolved
    blocksWithdrawn: number
    // The actions it let go by without a block attempt, while it could attempt one
    blocksDeclined: number
    // Its actions that a block stopped
    actionsBlocked: number
    bouncesPlayed: number
}

// 'tried': the attempt is over ( failed or given up ), the player already played its chance against this action
type BlockDecision = 'declined' | 'attempted' | 'tried'

// The last action declared, until the next one is. It outlives its resolution: a mutation applied
// inside another one is logged before it, so the pass that let the action go by is logged after the
// resolution it triggered.
type PendingAction = {
    // The action went through or was stopped: nothing it does counts anymore
    resolved: boolean
    actor: PlayerOid
    target: PlayerOid | null
    isBleed: boolean
    drained: number
    decisions: Record<PlayerOid, BlockDecision>
    blocker: PlayerOid | null
}

export type TableLedger = {
    players: Record<PlayerOid, PlayerLedger>
    pending: PendingAction | null
}

export function createLedger(): TableLedger {
    return { players: {}, pending: null }
}

function createPlayerLedger(): PlayerLedger {
    return {
        actionsDeclared: 0,
        bleedsDeclared: 0,
        bleedAmounts: [],
        poolLostToBleeds: 0,
        blocksAttempted: 0,
        blocksSucceeded: 0,
        blocksFailed: 0,
        blocksWithdrawn: 0,
        blocksDeclined: 0,
        actionsBlocked: 0,
        bouncesPlayed: 0,
    }
}

export function getPlayerLedger(ledger: TableLedger, oid: PlayerOid): PlayerLedger {
    ledger.players[oid] ??= createPlayerLedger()
    return ledger.players[oid]
}

function getMinionAction(params: GameMutationParams): MinionAction | null {
    const value = params.minionAction
    return typeof value == 'object' && value !== null && 'actingMinion' in value ?
            (value as MinionAction)
        :   null
}

function foldDeclareAction(ledger: TableLedger, params: GameMutationParams): void {
    const minionAction = getMinionAction(params)
    if (!minionAction) {
        return
    }
    const actor = minionAction.actingMinion.controller.oid
    const bleed = isBleed(minionAction)
    const target = minionAction.target instanceof Player ? minionAction.target.oid : null
    ledger.pending = {
        resolved: false,
        actor,
        target,
        isBleed: bleed,
        drained: 0,
        decisions: {},
        blocker: null,
    }
    const actorLedger = getPlayerLedger(ledger, actor)
    actorLedger.actionsDeclared++
    if (bleed) {
        actorLedger.bleedsDeclared++
    }
}

function foldDeclareBlock(
    ledger: TableLedger,
    params: GameMutationParams,
    author: PlayerOid,
): void {
    const pending = ledger.pending
    if (!pending || pending.resolved) {
        return
    }
    const block = params.block
    if (block instanceof Card) {
        const blocker = block.controller.oid
        if (pending.decisions[blocker] == 'declined') {
            // The player changed its mind: it did not let the action go by after all
            getPlayerLedger(ledger, blocker).blocksDeclined--
        }
        pending.decisions[blocker] = 'attempted'
        pending.blocker = blocker
        getPlayerLedger(ledger, blocker).blocksAttempted++
    } else if (block === NO_BLOCK) {
        if (pending.decisions[author] == 'tried') {
            return
        }
        // Giving up an attempt that would fail ( the stealth went up ) is not a refusal to block
        if (pending.decisions[author] == 'attempted') {
            getPlayerLedger(ledger, author).blocksWithdrawn++
            if (pending.blocker == author) {
                pending.blocker = null
            }
            pending.decisions[author] = 'tried'
        } else if (!pending.decisions[author]) {
            pending.decisions[author] = 'declined'
            getPlayerLedger(ledger, author).blocksDeclined++
        }
    } else if (block === null) {
        if (pending.decisions[author] == 'declined') {
            getPlayerLedger(ledger, author).blocksDeclined--
        }
        delete pending.decisions[author]
        if (pending.blocker == author) {
            pending.blocker = null
        }
    }
}

// Passing the impulse while the window is open, with no block attempt standing, lets the action go by
// as much as saying "no block" does
function foldDeclareReaction(
    ledger: TableLedger,
    params: GameMutationParams,
    author: PlayerOid,
): void {
    const pending = ledger.pending
    if (
        params.reaction === NO_REACTION &&
        pending &&
        !pending.blocker &&
        author != pending.actor &&
        !pending.decisions[author]
    ) {
        pending.decisions[author] = 'declined'
        getPlayerLedger(ledger, author).blocksDeclined++
    }
}

function foldResolveBlock(ledger: TableLedger, mutation: AnyGameMutation): void {
    const pending = ledger.pending
    if (!pending?.blocker) {
        return
    }
    const blocker = getPlayerLedger(ledger, pending.blocker)
    if (mutation.previousState.isBlockSuccessful === true) {
        blocker.blocksSucceeded++
        getPlayerLedger(ledger, pending.actor).actionsBlocked++
        pending.resolved = true
    } else {
        blocker.blocksFailed++
        pending.decisions[pending.blocker] = 'tried'
        pending.blocker = null
    }
}

function foldChangePool(ledger: TableLedger, params: GameMutationParams, author: PlayerOid): void {
    const pending = ledger.pending
    const { player, amount } = params
    if (
        pending?.isBleed &&
        !pending.resolved &&
        author == pending.actor &&
        player instanceof Player &&
        player.oid == pending.target &&
        typeof amount == 'number' &&
        amount < 0
    ) {
        pending.drained -= amount
    }
}

function foldResolveAction(ledger: TableLedger): void {
    const pending = ledger.pending
    if (!pending || pending.resolved) {
        return
    }
    if (pending.isBleed) {
        getPlayerLedger(ledger, pending.actor).bleedAmounts.push(pending.drained)
        if (pending.target) {
            getPlayerLedger(ledger, pending.target).poolLostToBleeds += pending.drained
        }
    }
    pending.resolved = true
}

// To call once the mutation is applied. Mutations nested in another one ( a bleed that takes the
// pool away is applied inside the resolution of the action ) come first, as they are applied.
export function foldMutation(ledger: TableLedger, mutation: AnyGameMutation): void {
    const { params } = mutation
    switch (mutation.name) {
        case 'ACTION_declareAction':
            foldDeclareAction(ledger, params)
            break
        case 'ACTION_declareBlock':
            foldDeclareBlock(ledger, params, mutation.author.oid)
            break
        case 'ACTION_declareReaction':
            foldDeclareReaction(ledger, params, mutation.author.oid)
            break
        case 'ACTION_resolveBlock':
            foldResolveBlock(ledger, mutation)
            break
        case 'ACTION_changeTarget':
            if (ledger.pending && params.target instanceof Player) {
                ledger.pending.target = params.target.oid
                getPlayerLedger(ledger, mutation.author.oid).bouncesPlayed++
            }
            break
        case 'changePool':
            foldChangePool(ledger, params, mutation.author.oid)
            break
        case 'ACTION_resolveAction':
            foldResolveAction(ledger)
            break
        case 'ACTION_endAction':
            if (ledger.pending) {
                ledger.pending.resolved = true
            }
            break
    }
}

// The ledger of a game from its history: the archived mutations, then the recent ones
export function rebuildLedger(history: HistoryStore, gameId: GameId): TableLedger {
    const ledger = createLedger()
    const entries = [...history.getArchivedHistory(gameId).gameMutations, ...history.gameMutations]
    for (const entry of entries) {
        foldMutation(ledger, deserializeGameMutation(entry.serializedMutation))
    }
    return ledger
}
