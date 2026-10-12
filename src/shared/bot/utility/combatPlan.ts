import {
    applyMove,
    CombatSim,
    legalMoves,
    Move,
    Side,
    SimCard,
} from '@/shared/bot/utility/combatModel.ts'
import { lossSoFar } from '@/shared/bot/utility/combatValue.ts'
import { chooseMove, PolicyWeights } from '@/shared/bot/utility/combatPolicy.ts'
import { policyWeightsOf } from '@/shared/bot/utility/combatPosition.ts'
import {
    BelievedHand,
    beliefKey,
    believedHands,
    hashOf,
} from '@/shared/bot/utility/combatBelief.ts'
import { MinionProfile } from '@/shared/bot/utility/minionProfile.ts'
import { BotProfile } from '@/shared/bot/utility/profile.ts'

/**
 * The plan of a combat: the move to make now, chosen by
 * playing out what follows. This is the rollout algorithm over the default policy of combatPolicy.ts: each
 * move the rules allow is tried, the combat goes on with both sides playing the policy, and the move with
 * the best result is the one made. It is never worse than the policy it improves ( on the hands it was
 * played against ), and unlike it, it sees past the round: a card kept for the round where it counts, a
 * strength raised before the range, a maneuver that only pays at the next strike. The hand of the other side
 * is a few hands drawn from what is believed ( combatBelief.ts ), the same for every move so that they are
 * compared on the same cards; the best move is the one with the best mix of the average and the worst of
 * them ( `caution` ). No state is kept: the plan is asked again at every decision, so a side that deviates
 * from what was expected is met with a new plan.
 */

export type CombatPlanWeights = {
    policy: PolicyWeights
    // The share of what the other side loses that counts for me
    credit: number
    caution: number
    // How many of its own moves the plan itself plans, after the first, in the rollouts ( 0: the policy plays them )
    depth: number
}

export function planWeightsOf(profile: BotProfile): CombatPlanWeights {
    return {
        policy: policyWeightsOf(profile),
        credit: profile.combat.credit,
        caution: profile.combat.caution,
        depth: profile.combat.planDepth,
    }
}

// A move that is not better than the policy's by more than this is not worth leaving it for
const MARGIN = 0.05

export type PlanOption = {
    move: Move
    // The mix of the average and the worst of the hands: what the move is judged by
    value: number
    mean: number
    worst: number
}

export type CombatPlan = {
    move: Move
    // The moves weighed, the best first: none when the rules allow only one
    options: PlanOption[]
}

const opposite = (side: Side): Side => (side == 'acting' ? 'defending' : 'acting')

// The move as the sim would read it with the card named instead of its place: two cards of the same name
// make the same move
function keyOf(sim: CombatSim, move: Move): string {
    const card =
        move.card === undefined ? undefined : sim[sim.impulsePlayer].cards[move.card]?.cardId
    return JSON.stringify({ ...move, card })
}

function distinctMoves(sim: CombatSim): Move[] {
    const seen = new Set<string>()
    const moves: Move[] = []
    for (const move of legalMoves(sim)) {
        const key = keyOf(sim, move)
        if (!seen.has(key)) {
            seen.add(key)
            moves.push(move)
        }
    }
    return moves
}

function withCards(sim: CombatSim, side: Side, cards: SimCard[]): CombatSim {
    return { ...sim, [side]: { ...sim[side], cards } }
}

// What the combat cost the side since `start`, in pool: what it lost, the pool it paid for cards, and the
// cards themselves
export function costSince(
    weights: CombatPlanWeights,
    start: CombatSim,
    end: CombatSim,
    side: Side,
): number {
    const { loss, card } = weights.policy
    return (
        lossSoFar(loss, end, end[side]) +
        (start[side].pool - end[side].pool) +
        card * (end[side].spent - start[side].spent)
    )
}

// What the end of a combat is worth to a side: what it cost the other, less what it cost itself
function worthSince(
    weights: CombatPlanWeights,
    start: CombatSim,
    end: CombatSim,
    side: Side,
): number {
    return (
        weights.credit * costSince(weights, start, end, opposite(side)) -
        costSince(weights, start, end, side)
    )
}

// A combat that does not end ( it cannot, with the rules ) is cut after this many moves
const MOVES_LIMIT = 300

// The combat played to its end: the policy plays the other side, and `side` too, except that while `depth` is
// above zero it plans its own moves ( the plan of a world it knows the hand of )
function rollout(
    weights: CombatPlanWeights,
    start: CombatSim,
    side: Side,
    depth: number,
): CombatSim {
    let sim = start
    for (let moves = 0; !sim.closed && moves < MOVES_LIMIT; moves++) {
        const move =
            depth > 0 && sim.impulsePlayer == side ?
                decide(weights, sim, [sim], depth - 1).move
            :   chooseMove(weights.policy, sim)
        sim = applyMove(sim, move).sim
    }
    return sim
}

// The side that holds the impulse plays the move, then the combat is played out
function valueOfMove(
    weights: CombatPlanWeights,
    world: CombatSim,
    move: Move,
    depth: number,
): number {
    const side = world.impulsePlayer
    const end = rollout(weights, applyMove(world, move).sim, side, depth)
    return worthSince(weights, world, end, side)
}

// The move that the policy makes in most of the worlds
function policyFavourite(weights: CombatPlanWeights, sim: CombatSim, worlds: CombatSim[]): string {
    const votes = new Map<string, number>()
    let favourite = ''
    let top = 0
    for (const world of worlds) {
        const key = keyOf(sim, chooseMove(weights.policy, world))
        const count = (votes.get(key) ?? 0) + 1
        votes.set(key, count)
        if (count > top) {
            top = count
            favourite = key
        }
    }
    return favourite
}

// The moves weighed over the worlds, and the one to play: the policy's, unless another is clearly better
function decide(
    weights: CombatPlanWeights,
    sim: CombatSim,
    worlds: CombatSim[],
    depth: number,
): CombatPlan {
    const moves = distinctMoves(sim)
    if (moves.length == 1) {
        return { move: moves[0], options: [] }
    }
    const options: PlanOption[] = []
    for (const move of moves) {
        let total = 0
        let worst = Infinity
        for (const world of worlds) {
            const value = valueOfMove(weights, world, move, depth)
            total += value
            worst = Math.min(worst, value)
        }
        const mean = total / worlds.length
        options.push({ move, mean, worst, value: mean + weights.caution * (worst - mean) })
    }
    options.sort((a, b) => b.value - a.value)
    const favourite = policyFavourite(weights, sim, worlds)
    const held = options.find(option => keyOf(sim, option.move) == favourite)
    const chosen = held && held.value >= options[0].value - MARGIN ? held : options[0]
    return { move: chosen.move, options }
}

/**
 * The plan: the move of the side that holds the impulse in `sim`, against `hands`, the hands the other side
 * may hold ( its cards in `sim` are not read; none: they are as they are in `sim` ). The combat must be open.
 */
export function planMove(
    weights: CombatPlanWeights,
    sim: CombatSim,
    hands: SimCard[][],
): CombatPlan {
    const other = opposite(sim.impulsePlayer)
    const worlds = hands.length > 0 ? hands.map(hand => withCards(sim, other, hand)) : [sim]
    return decide(weights, sim, worlds, weights.depth)
}

// The plan against the hands believed of the other side's minion: `belief` none, its cards are as they are in
// `sim`. The hands are drawn from a seed made of the combat, so it is judged the same way every time.
export function planCombat(
    profile: BotProfile,
    sim: CombatSim,
    belief?: { minion: MinionProfile; hand: BelievedHand },
): CombatPlan {
    if (!belief) {
        return planMove(planWeightsOf(profile), sim, [])
    }
    const { minion, hand } = belief
    const seed = hashOf(
        JSON.stringify([
            sim.round,
            sim.step,
            sim.range,
            sim.acting.blood,
            sim.defending.blood,
            beliefKey(minion, hand),
        ]),
    )
    const hands = believedHands(minion, hand, profile.combat, profile.combat.samples, seed)
    return planMove(planWeightsOf(profile), sim, hands)
}

/**
 * Printing a plan
 */

function detailOf(move: Move): string {
    switch (move.type) {
        case 'strike':
            return ` ${move.strike.name}`
        case 'gainBlood':
        case 'strength':
        case 'environmentalDamage':
        case 'prevent':
            return ` ${move.amount}`
        default:
            return ''
    }
}

export function describeMove(sim: CombatSim, move: Move): string {
    const card = move.card === undefined ? undefined : sim[sim.impulsePlayer].cards[move.card]
    return `${move.type}${detailOf(move)}${card ? ` (${card.name})` : ''}`
}

// What follows the move if both sides go on with the policy, against one hand of the other side: the moves
// that are not a pass, each with the side that makes it
export function planLine(
    weights: CombatPlanWeights,
    sim: CombatSim,
    move: Move,
    hand?: SimCard[],
): string[] {
    const side = sim.impulsePlayer
    let world = hand ? withCards(sim, opposite(side), hand) : sim
    const line: string[] = []
    let next: Move | null = move
    for (let steps = 0; next && !world.closed && steps < 300; steps++) {
        if (next.type != 'pass') {
            line.push(`${world.impulsePlayer}: ${describeMove(world, next)}`)
        }
        world = applyMove(world, next).sim
        next = world.closed ? null : chooseMove(weights.policy, world)
    }
    return line
}
