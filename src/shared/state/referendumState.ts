import { Card, UNKNOWN_VAMPIRE_ATTRS } from '@/shared/model/Card.ts'
import { CardRegion } from '@/shared/model/CardRegion.ts'
import { Player } from '@/shared/model/Player.ts'
import type { AnyGameMutation } from '@/shared/state/gameMutations.ts'
import { DEFAULT_CARD_ATTRS } from '@/shared/const/model.ts'
import { CastVote, ReferendumState, VOTE_SIDES, VoteCount, VoteSide } from '@/shared/types/state.ts'
import { GameState } from '@/shared/state/gameState.ts'

// How long the last call countdown runs before the outcome is settled.
export const LAST_CALL_DURATION = 5000

// Votes the priscii subreferendum grants to its winning side ( none on a tie ).
export const SUBREFERENDUM_VOTE_GRANT = 3

export function createVoteCount(): VoteCount {
    return {
        [VoteSide.InFavour]: 0,
        [VoteSide.Against]: 0,
    }
}

export function createReferendumState(): ReferendumState {
    return {
        votes: {},
        ballots: {},
        playerVotes: {},
        lastCallStartTime: null,
    }
}

/**
 * A vampire casts ballots ( in the priscii subreferendum ) rather than votes
 * once its title gives it at least one ballot : a priscus.
 */
export function isBallotVampire(card: Card): boolean {
    const vampireAttrs = card.vampireAttrs
    return !!vampireAttrs && vampireAttrs != UNKNOWN_VAMPIRE_ATTRS && vampireAttrs.ballot > 0
}

/**
 * The number of votes a vampire brings by default, from its title.
 */
export function getDefaultVoteAmount(card: Card): number {
    const vampireAttrs = card.vampireAttrs
    if (!vampireAttrs || vampireAttrs == UNKNOWN_VAMPIRE_ATTRS) {
        return DEFAULT_CARD_ATTRS.Vote
    }
    return vampireAttrs.vote
}

/**
 * The number of ballots a vampire brings by default, from its title.
 */
export function getDefaultBallotAmount(card: Card): number {
    const vampireAttrs = card.vampireAttrs
    if (!vampireAttrs || vampireAttrs == UNKNOWN_VAMPIRE_ATTRS) {
        return DEFAULT_CARD_ATTRS.Ballot
    }
    return vampireAttrs.ballot
}

/**
 * The vote of a vampire, as it currently stands.
 * Vampires that never interacted with the referendum have no stored vote yet,
 * so we fall back on their title votes with no side picked.
 */
export function getCastVote(referendum: ReferendumState, card: Card): CastVote {
    return referendum.votes[card.oid] ?? { side: null, amount: getDefaultVoteAmount(card) }
}

/**
 * The ballots a priscus casts in the subreferendum, as they currently stand.
 * Vampires that never interacted with it fall back on their title ballots with
 * no side picked.
 */
export function getCastBallot(referendum: ReferendumState, card: Card): CastVote {
    return referendum.ballots[card.oid] ?? { side: null, amount: getDefaultBallotAmount(card) }
}

/**
 * The extra votes of a player, as they currently stand.
 * Players that brought none yet have no stored counters.
 */
export function getPlayerVotes(referendum: ReferendumState, player: Player): VoteCount {
    return referendum.playerVotes[player.oid] ?? createVoteCount()
}

/**
 * The priscii subreferendum, tallied on its own : one count per side, summing
 * the ballots priscii have cast. Ballots with no side picked are not tallied.
 */
export function tallySubReferendum(referendum: ReferendumState): VoteCount {
    const tally = createVoteCount()

    for (const castBallot of Object.values(referendum.ballots)) {
        if (castBallot.side) {
            tally[castBallot.side] += castBallot.amount
        }
    }

    return tally
}

/**
 * The side the subreferendum grants its votes to, or null when nothing is
 * granted : no ballot cast, or a tie between the two sides.
 */
export function getSubReferendumWinner(referendum: ReferendumState): VoteSide | null {
    const tally = tallySubReferendum(referendum)
    if (tally[VoteSide.InFavour] == tally[VoteSide.Against]) {
        return null
    }
    return tally[VoteSide.InFavour] > tally[VoteSide.Against] ? VoteSide.InFavour : VoteSide.Against
}

export function tallyVotes(referendum: ReferendumState): VoteCount {
    const tally = createVoteCount()

    for (const castVote of Object.values(referendum.votes)) {
        // Vampires that have not picked a side yet are not tallied
        if (castVote.side) {
            tally[castVote.side] += castVote.amount
        }
    }

    for (const playerVotes of Object.values(referendum.playerVotes)) {
        for (const side of VOTE_SIDES) {
            tally[side] += playerVotes[side]
        }
    }

    // The priscii subreferendum grants a fixed number of votes to its winner.
    const subWinner = getSubReferendumWinner(referendum)
    if (subWinner) {
        tally[subWinner] += SUBREFERENDUM_VOTE_GRANT
    }

    return tally
}

// Ties are resolved as "against" : a referendum needs a strict majority to pass.
export function getWinningSide(referendum: ReferendumState): VoteSide {
    const tally = tallyVotes(referendum)
    return tally[VoteSide.InFavour] > tally[VoteSide.Against] ? VoteSide.InFavour : VoteSide.Against
}

/**
 * Has the last call countdown run its course ?
 * `time` is a Date.now() value, so the caller decides how often this is re-evaluated.
 */
export function isLastCallOver(referendum: ReferendumState, time: number): boolean {
    return (
        referendum.lastCallStartTime !== null &&
        time - referendum.lastCallStartTime >= LAST_CALL_DURATION
    )
}

// Milliseconds left before the outcome is settled ( 0 once it is ).
export function getLastCallRemainingTime(referendum: ReferendumState, time: number): number {
    if (referendum.lastCallStartTime === null) {
        return 0
    }
    return Math.max(0, LAST_CALL_DURATION - (time - referendum.lastCallStartTime))
}

/**
 * Does this mutation cut a pending last call short ?
 *
 * A last call gives the other players their last chance to react, so anything
 * they could be reacting to restarts it : announcing votes, and playing cards.
 * Every other mutation lets the countdown run.
 *
 * This is deliberately a lookup on the mutation rather than something each
 * mutation class declares : the list is short, it is about the referendum
 * rather than about those mutations, and it belongs where the last call lives.
 */
export function interruptsReferendumLastCall(mutation: AnyGameMutation) {
    let interrupt = false

    switch (mutation.name) {
        case 'REFERENDUM_castVote':
        case 'REFERENDUM_changeVotes':
        case 'REFERENDUM_changePlayerVotes':
        case 'playFaceDown':
            interrupt = true
            break

        case 'moveCardToRegion': {
            const { fromCardRegion, toCardRegion } = mutation.params
            interrupt =
                fromCardRegion instanceof CardRegion &&
                toCardRegion instanceof CardRegion &&
                fromCardRegion.is.hand &&
                toCardRegion.is.play
        }
    }

    if (interrupt) {
        interruptLastCall(mutation.gameState)
    }
}

/**
 * Drop a pending last call, whether it was interrupted on purpose or by a
 * mutation that changes what players are voting on.
 */
export function interruptLastCall(gameState: GameState): void {
    if (gameState.referendum) {
        gameState.referendum.lastCallStartTime = null
    }
}
