import { Player } from '@/shared/model/Player.ts'
import { Card } from '@/shared/model/Card.ts'
import { AMOUNT_LOG_PLACEHOLDER, CARD_LOG_PLACEHOLDER } from '@/shared/const/game.ts'
import {
    Invalid,
    ReferendumState,
    VALID,
    Validity,
    VoteCount,
    VoteSide,
} from '@/shared/types/state.ts'
import { MutationSyncMode } from '@/shared/types/multiplayer.ts'
import { endAction } from '@/shared/state/gameplay/actionState.ts'
import {
    createReferendumState,
    createVoteCount,
    getCastBallot,
    getCastVote,
    getPlayerVotes,
    interruptLastCall,
    isBallotVampire,
    tallyVotes,
} from '@/shared/state/gameplay/referendumState.ts'
import * as actions from '@/shared/state/gameplay/minionActions.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { LogGroup } from '@/shared/types/history.ts'
import { EmptyParams, GameMutation, GameMutationParams } from '@/shared/state/mutations/base.ts'

/**
 * Referendum
 *
 * The referendum interface only tallies what players announce : it never
 * decides anything by itself. Every change goes through one of these mutations
 * so that all clients see the same tally.
 *
 * None of them takes part in the cancel stack ( isIgnoredForCancel ) : a wrong
 * vote is fixed by voting again, and the referendum is transient enough that
 * having it block the cancel of a real game action would be a nuisance.
 */

abstract class ReferendumMutation<
    ParamsType extends GameMutationParams,
> extends GameMutation<ParamsType> {
    _isUserCancellable = false
    isIgnoredForCancel = true
    readonly syncMode = MutationSyncMode.Merge

    protected getValidity(gameState: GameState) {
        return gameState.referendum ? VALID : Invalid('Must be applied during a referendum')
    }

    // Guarded accessor, so subclasses don't repeat the null check
    protected getReferendum(gameState: GameState) {
        const referendum = gameState.referendum
        if (!referendum) {
            throw new Error('gameState.referendum is null')
        }
        return referendum
    }
}

/**
 * Referendum : Call a referendum
 */

interface CallReferendumParams extends GameMutationParams {
    // What puts the referendum to the table, when something does : the game
    // menu calls one with no card behind it.
    card?: Card
}

export class CallReferendum extends ReferendumMutation<CallReferendumParams> {
    get card() {
        return this.params.card ?? null
    }

    protected getValidity(gameState: GameState) {
        return gameState.referendum ? Invalid('A referendum is already in progress') : VALID
    }

    protected updateGameState(gameState: GameState) {
        gameState.referendum = createReferendumState()
    }

    formatForLog() {
        return this.params.card ?
                `Call a referendum from ${CARD_LOG_PLACEHOLDER}`
            :   `Call a referendum`
    }
}

/**
 * Referendum : Close the referendum
 */

export class CloseReferendum extends ReferendumMutation<EmptyParams> {
    declare public previousState: { tally: VoteCount; actionName: string | null }

    protected updateGameState(gameState: GameState) {
        // Store for use in formatForLog()
        this.previousState.tally =
            gameState.referendum ? tallyVotes(gameState.referendum) : createVoteCount()
        this.previousState.actionName =
            gameState.action ? actions.getName(gameState.action.minionAction) : null

        gameState.referendum = null

        // A political action stays in progress for the whole referendum, and
        // ends with it. A referendum called on its own has no action to end.
        endAction(gameState)
    }

    formatForLog() {
        const ending =
            this.previousState.actionName ? ` and end ${this.previousState.actionName}` : ''
        return `Close the referendum${ending}`
    }

    formatLogDetails() {
        const tally = this.previousState.tally
        return [
            { label: 'for', value: `${tally[VoteSide.InFavour]}` },
            { label: 'against', value: `${tally[VoteSide.Against]}` },
        ]
    }
}

/**
 * Referendum : the votes of a single vampire
 *
 * A vampire votes for its own controller, so only that player announces its
 * vote. The interface enforces it for everyone ; strict games make it a rule.
 */

interface VampireVoteParams extends GameMutationParams {
    vampire: Card
}

abstract class VampireVoteMutation<
    ParamsType extends VampireVoteParams,
> extends ReferendumMutation<ParamsType> {
    get card() {
        return this.params.vampire
    }

    protected getStrictValidity(): Validity {
        return this.params.vampire.controllerOid == this.author.oid ?
                VALID
            :   Invalid(`Players can only vote with their own vampires`)
    }

    // A priscus casts into the subreferendum ( ballots ), everyone else into the
    // main referendum ( votes ). Both stores hold the same CastVote shape.
    protected get castsBallots() {
        return isBallotVampire(this.params.vampire)
    }

    protected getVoteStore(referendum: ReferendumState) {
        return this.castsBallots ? referendum.ballots : referendum.votes
    }

    protected getCurrentCast(referendum: ReferendumState) {
        return this.castsBallots ?
                getCastBallot(referendum, this.params.vampire)
            :   getCastVote(referendum, this.params.vampire)
    }
}

/**
 * Referendum : Cast a vote
 *
 * Clicking the side a vampire already voted for retracts its vote, so a
 * mis-click is fixed with a second click.
 */

interface CastVoteParams extends VampireVoteParams {
    side: VoteSide
}

export class CastReferendumVote extends VampireVoteMutation<CastVoteParams> {
    protected updateGameState(gameState: GameState) {
        const referendum = this.getReferendum(gameState)
        const store = this.getVoteStore(referendum)
        const castVote = this.getCurrentCast(referendum)

        store[this.params.vampire.oid] = {
            ...castVote,
            side: castVote.side == this.params.side ? null : this.params.side,
        }
    }

    formatForLog() {
        const isBallot = this.castsBallots
        const referendum = this.gameState.referendum
        const store = referendum ? this.getVoteStore(referendum) : {}
        const castVote = store[this.params.vampire.oid]
        if (!castVote?.side) {
            return isBallot ?
                    `Retract the ballot of ${CARD_LOG_PLACEHOLDER}`
                :   `Retract the vote of ${CARD_LOG_PLACEHOLDER}`
        }
        const side = castVote.side == VoteSide.InFavour ? 'in favour' : 'against'
        return isBallot ?
                `${CARD_LOG_PLACEHOLDER} casts ${castVote.amount} ballot(s) ${side} in the subreferendum`
            :   `${CARD_LOG_PLACEHOLDER} votes ${castVote.amount} ${side}`
    }
}

/**
 * Referendum : Change the number of votes a vampire casts
 */

interface ChangeVotesParams extends VampireVoteParams {
    amount: number
}

export class ChangeReferendumVotes extends VampireVoteMutation<ChangeVotesParams> {
    declare public previousState: { amount: number }

    protected updateGameState(gameState: GameState) {
        const referendum = this.getReferendum(gameState)
        const store = this.getVoteStore(referendum)
        const castVote = this.getCurrentCast(referendum)
        this.previousState.amount = castVote.amount

        store[this.params.vampire.oid] = {
            ...castVote,
            // A vampire can bring no vote at all, but never a negative one
            amount: Math.max(0, castVote.amount + this.params.amount),
        }
    }

    formatForLog() {
        const unit = this.castsBallots ? 'ballot' : 'vote'
        return `${AMOUNT_LOG_PLACEHOLDER} ${unit} on ${CARD_LOG_PLACEHOLDER}`
    }

    // The votes the vampire casts. Never below 0 : from the stored value, not the amount
    formatLogDetails() {
        const referendum = this.gameState.referendum
        const store = referendum ? this.getVoteStore(referendum) : {}
        const amount = store[this.params.vampire.oid]?.amount ?? 0
        return [
            {
                label: this.castsBallots ? 'ballots' : 'votes',
                from: `${this.previousState.amount ?? 0}`,
                value: `${amount}`,
            },
        ]
    }

    get logGroup(): LogGroup {
        return { key: `${this.name}-${this.params.vampire.oid}`, amount: this.params.amount }
    }
}

/**
 * Referendum : Change the extra votes a player casts
 *
 * These are the votes that don't come from a vampire : burning the edge,
 * discarding a political card, activating a card in play... The player performs
 * the cost with the usual game mutations, then announces the votes here.
 */

interface ChangePlayerVotesParams extends GameMutationParams {
    player: Player
    side: VoteSide
    amount: number
}

export class ChangePlayerVotes extends ReferendumMutation<ChangePlayerVotesParams> {
    declare public previousState: { votes: number }

    protected getStrictValidity(): Validity {
        return this.params.player.oid == this.author.oid ?
                VALID
            :   Invalid(`Players can only cast their own votes`)
    }

    protected updateGameState(gameState: GameState) {
        const referendum = this.getReferendum(gameState)
        const playerVotes = getPlayerVotes(referendum, this.params.player)
        this.previousState.votes = playerVotes[this.params.side]

        referendum.playerVotes[this.params.player.oid] = {
            ...playerVotes,
            // A player can bring no extra vote at all, but never a negative one
            [this.params.side]: Math.max(0, playerVotes[this.params.side] + this.params.amount),
        }
    }

    private get sideName(): string {
        return this.params.side == VoteSide.InFavour ? 'in favour' : 'against'
    }

    // The player is the author ( see getStrictValidity )
    formatForLog() {
        return `${AMOUNT_LOG_PLACEHOLDER} extra vote ${this.sideName}`
    }

    // The extra votes of the player on that side. Never below 0 : from the stored value
    formatLogDetails() {
        const votes =
            this.gameState.referendum?.playerVotes[this.params.player.oid]?.[this.params.side] ?? 0
        return [
            {
                label: `extra ${this.sideName}`,
                from: `${this.previousState.votes ?? 0}`,
                value: `${votes}`,
            },
        ]
    }

    get logGroup(): LogGroup {
        return {
            key: `${this.name}-${this.params.player.oid}-${this.params.side}`,
            amount: this.params.amount,
        }
    }
}

/**
 * Referendum : Last call
 *
 * The countdown is shared as the timestamp it started at, so every client
 * settles the outcome on its own without further broadcasting.
 */

interface LastCallParams extends GameMutationParams {
    date: Date
}

export class StartReferendumLastCall extends ReferendumMutation<LastCallParams> {
    protected updateGameState(gameState: GameState) {
        this.getReferendum(gameState).lastCallStartTime = this.params.date.getTime()
    }

    formatForLog() {
        return `Last call for the referendum`
    }
}

export class InterruptReferendumLastCall extends ReferendumMutation<EmptyParams> {
    protected updateGameState(gameState: GameState) {
        interruptLastCall(gameState)
    }

    formatForLog() {
        return `Interrupt the last call`
    }
}
