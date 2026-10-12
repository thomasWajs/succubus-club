import { CombatRange, CombatStep } from '@/shared/types/state.ts'
import { isStrikeEffective } from '@/shared/state/combatRules.ts'
import {
    applyMove,
    CombatSim,
    cloneSim,
    legalMoves,
    Move,
    Side,
    SimCombatant,
    SimStrike,
    settled,
} from '@/shared/bot/utility/combatModel.ts'
import { LossWeights, lossOf, lossSoFar } from '@/shared/bot/utility/combatValue.ts'

/**
 * How a side plays a combat when nothing better is known:
 * the default policy of the playouts, for both sides. It is zero-sum ( what one side's opponent loses is
 * what it gains ) and looks one move ahead on a potential: what has been lost so far, the damage pending
 * counted, plus what the strikes of the round are worth at the range there is, each side answering the
 * other's strike with its best one ( the acting minion strikes first and the other sees it, as in the
 * engine ). Nothing here is a rule of the game: the playout runs the rules of combatRules.ts, this only
 * chooses among the moves they allow. Short-sighted on purpose: it plays a card when it pays for itself in
 * the round, and does not plan a sequence of them ( combatPlan.ts does ).
 */

export type PolicyWeights = {
    loss: LossWeights
    // What a card played costs: it is not played for nothing
    card: number
}

type StrikeMove = Extract<Move, { type: 'strike' }>

// A move that makes the potential rise by less than this is not worth its trouble
const EPSILON = 0.01

const opposite = (side: Side): Side => (side == 'acting' ? 'defending' : 'acting')

// What a card costs when the move plays one
const costOf = (weights: PolicyWeights, move: Move | null): number =>
    move && move.card !== undefined ? weights.card : 0

/**
 * The strikes of a round
 */

// The strikes a side could choose at the strike step, at the range given ( the next round: at close range, with
// the cards of the hand as they are )
function strikeMoves(sim: CombatSim, side: Side, fresh: boolean): StrikeMove[] {
    const probe = cloneSim(sim)
    probe.step = CombatStep.Strike
    probe.impulsePlayer = side
    probe[side].strike = null
    probe[side].strikesInPair = true
    if (fresh) {
        probe.range = CombatRange.Close
        probe.handStrikesOnly = false
        probe.playedThisRound = {}
        probe[side].limitedAdditionalGained = false
    }
    return legalMoves(probe).filter((move): move is StrikeMove => move.type == 'strike')
}

// The strike a combatant has chosen, as the model names it ( a retainer by its place )
function chosenStrike(combatant: SimCombatant): StrikeMove | null {
    if (!combatant.strike) {
        return null
    }
    const { retainer, ...strike } = combatant.strike
    return {
        type: 'strike',
        strike: typeof retainer == 'number' ? { ...strike, retainer } : strike,
    }
}

// What a side may strike with in the pair: the strike already chosen, none when it sits the pair out
function strikeOptions(sim: CombatSim, side: Side, fresh: boolean): (StrikeMove | null)[] {
    const own = sim[side]
    const chosen = fresh ? null : chosenStrike(own)
    if (chosen) {
        return [chosen]
    }
    if (!fresh && sim.step == CombatStep.Strike && !own.strikesInPair) {
        return [null]
    }
    return strikeMoves(sim, side, fresh)
}

type Duel = {
    sim: CombatSim
    weights: PolicyWeights
    range: CombatRange
    // What each side has lost already
    base: Record<Side, number>
    // The damage each side takes in the round that is not a strike
    environment: Record<Side, number>
}

function environmentOf(victim: SimCombatant, striker: SimCombatant): number {
    return (
        victim.environmentalDamage +
        striker.attached.reduce(
            (total, card) => total + (!card.retainer || card.life > 0 ? card.environmental : 0),
            0,
        )
    )
}

function duelOf(sim: CombatSim, weights: PolicyWeights, fresh: boolean): Duel {
    const environment = (side: Side) =>
        sim.environmentalApplied && !fresh ? 0 : environmentOf(sim[side], sim[opposite(side)])
    return {
        sim,
        weights,
        range: fresh ? CombatRange.Close : sim.range,
        base: {
            acting: lossSoFar(weights.loss, sim, sim.acting),
            defending: lossSoFar(weights.loss, sim, sim.defending),
        },
        environment: { acting: environment('acting'), defending: environment('defending') },
    }
}

function lands(strike: SimStrike, range: CombatRange, answer: SimStrike | null): boolean {
    return (
        !strike.dodge && isStrikeEffective(strike, range) && !(answer?.dodge && !strike.undodgeable)
    )
}

// What a strike ( none: only the damage that is not a strike ) costs the victim, against the strike it answers with
function hit(
    duel: Duel,
    strike: SimStrike | null,
    victimSide: Side,
    answer: SimStrike | null,
): number {
    const { sim, weights } = duel
    const victim = sim[victimSide]
    let regular = duel.environment[victimSide]
    let aggravated = 0
    let extra = 0
    if (strike && lands(strike, duel.range, answer)) {
        if (strike.retainer !== undefined) {
            const card = victim.attached[strike.retainer]
            const lost = Math.min(strike.damage, card?.life ?? 0)
            extra +=
                lost * weights.loss.blood + (card && lost >= card.life ? weights.loss.retainer : 0)
        } else {
            extra += strike.stealBlood * weights.loss.blood * 2
            if (strike.aggravated) {
                aggravated += strike.damage
            } else {
                regular += strike.damage
            }
        }
    }
    const after = settled(sim, victim, { regular, aggravated })
    return lossOf(weights.loss, after) - duel.base[victimSide] + extra
}

// What the pair of strikes is worth to the acting side: the loss of the other, less its own. A first strike
// and a combat ends strike are valued as normal strikes: no card or weapon gives them yet
function exchange(duel: Duel, a: StrikeMove | null, b: StrikeMove | null): number {
    const striking = a?.strike ?? null
    const answering = b?.strike ?? null
    return (
        hit(duel, striking, 'defending', answering) -
        hit(duel, answering, 'acting', striking) +
        costOf(duel.weights, b) -
        costOf(duel.weights, a)
    )
}

// The acting side chooses its strike, the other sees it and answers with the one that suits it best
function duelValue(duel: Duel, fresh: boolean): number {
    const actings = strikeOptions(duel.sim, 'acting', fresh)
    const defendings = strikeOptions(duel.sim, 'defending', fresh)
    return actings.reduce(
        (best, a) => Math.max(best, Math.min(...defendings.map(b => exchange(duel, a, b)))),
        -Infinity,
    )
}

// What an additional strike is worth: a pair where only its owner strikes, with its best strike
function additionalGain(duel: Duel, side: Side): number {
    return strikeMoves(duel.sim, side, false).reduce(
        (top, move) =>
            Math.max(
                top,
                hit(duel, move.strike, opposite(side), null) - costOf(duel.weights, move),
            ),
        0,
    )
}

// The additional strikes gained and not used
function additionalValue(duel: Duel, side: Side): number {
    const count = duel.sim[side].additionalStrikes
    return count == 0 ? 0 : count * additionalGain(duel, side)
}

/**
 * The potential of a combat, from the acting side
 */

function potential(weights: PolicyWeights, sim: CombatSim): number {
    const realized =
        lossSoFar(weights.loss, sim, sim.defending) - lossSoFar(weights.loss, sim, sim.acting)
    const live =
        !sim.closed && !sim.isOver && sim.acting.state == 'ready' && sim.defending.state == 'ready'
    if (!live) {
        return realized
    }
    const duel = duelOf(sim, weights, false)
    const strikesToCome =
        sim.step == CombatStep.BeforeRange ||
        sim.step == CombatStep.DetermineRange ||
        sim.step == CombatStep.BeforeStrikes ||
        sim.step == CombatStep.Strike
    let future = strikesToCome ? duelValue(duel, false) : 0
    future += additionalValue(duel, 'acting') - additionalValue(duel, 'defending')
    // A press is standing: the combat goes on, with a round like this one
    if (sim.pressed && (sim.step == CombatStep.Press || sim.step == CombatStep.EndOfRound)) {
        future += duelValue(duelOf(sim, weights, true), true)
    }
    return realized + future
}

const signed = (side: Side, value: number): number => (side == 'acting' ? value : -value)

/**
 * The choice
 */

// What the move is worth to the side that makes it. A maneuver is a contest: the other side may answer it
// with one of its own, so the value is what is left after its best answer
function valueOfMove(weights: PolicyWeights, sim: CombatSim, move: Move, side: Side): number {
    const next = applyMove(sim, move).sim
    const own = signed(side, potential(weights, next)) - costOf(weights, move)
    if (
        sim.step != CombatStep.DetermineRange ||
        next.closed ||
        next.step != CombatStep.DetermineRange
    ) {
        return own
    }
    if (next.impulsePlayer == side) {
        return own
    }
    return legalMoves(next).reduce(
        (worst, reply) =>
            Math.min(
                worst,
                signed(side, potential(weights, applyMove(next, reply).sim)) -
                    costOf(weights, move) +
                    costOf(weights, reply),
            ),
        Infinity,
    )
}

function chooseStrike(weights: PolicyWeights, sim: CombatSim, moves: Move[], side: Side): Move {
    const duel = duelOf(sim, weights, false)
    const strikes = moves.filter((move): move is StrikeMove => move.type == 'strike')
    const score = (move: StrikeMove): number => {
        const bonus = move.additional ? additionalGain(duel, side) : 0
        if (side == 'acting') {
            const answers = strikeOptions(sim, 'defending', false)
            return Math.min(...answers.map(b => exchange(duel, move, b))) + bonus
        }
        const striking = strikeOptions(sim, 'acting', false)[0]
        return -exchange(duel, striking, move) + bonus
    }
    return strikes.reduce((best, move) => (score(move) > score(best) + EPSILON ? move : best))
}

// The move of the side that holds the impulse. The combat must be open
export function chooseMove(weights: PolicyWeights, sim: CombatSim): Move {
    const moves = legalMoves(sim)
    const side = sim.impulsePlayer
    if (moves.length == 1) {
        return moves[0]
    }
    if (sim.step == CombatStep.Strike) {
        return chooseStrike(weights, sim, moves, side)
    }
    let best = moves.find(move => move.type == 'pass') ?? moves[0]
    let bestValue = valueOfMove(weights, sim, best, side)
    for (const move of moves) {
        if (move == best) {
            continue
        }
        const value = valueOfMove(weights, sim, move, side)
        if (value > bestValue + EPSILON) {
            best = move
            bestValue = value
        }
    }
    return best
}

export type Playout = { sim: CombatSim; moves: number }

// The combat played to its end, both sides by the same policy. A combat that does not end ( it cannot, with
// the rules ) is cut after `limit` moves.
export function playOut(weights: PolicyWeights, start: CombatSim, limit = 300): Playout {
    let sim = start
    let moves = 0
    while (!sim.closed && moves < limit) {
        sim = applyMove(sim, chooseMove(weights, sim)).sim
        moves++
    }
    return { sim, moves }
}
