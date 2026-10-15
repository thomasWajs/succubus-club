import { LibraryCard } from '@/shared/model/Card.ts'
import { TurnPhase, TurnSequence } from '@/shared/const/model.ts'
import { MinionActionType } from '@/shared/types/state.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { DecisionKind, DecisionPoint, optionsOfType } from '@/shared/bot/types.ts'
import { Standing } from '@/shared/bot/utility/masterPhase.ts'
import { Assessment } from '@/shared/bot/utility/assessment.ts'
import {
    discards,
    guards,
    HandEvaluator,
    HandJudgement,
    NeedKind,
    standingFor,
} from '@/shared/bot/utility/hand.ts'

/**
 * A card in play that throws a card of the hand away ( The Barrens ) has one charge per cycle, from one unlock
 * phase of mine to the next, and it can be used at any time: the cycle can wait for the best moment. Each moment
 * the charge may still be used at is a window with a chance that it comes and a gain if the charge is used
 * there: the draw that the window asks for, less the weakest card of the hand that goes, less a small margin.
 * Solved backwards: the value of waiting at a window is the chance that it comes times the better of using the
 * charge there and the value of what follows, plus the chance that it does not times the value of what follows.
 * The charge is used now when it is worth more than waiting, so a tie waits, and the last window of the cycle
 * ( the end of the turn of my predator, just before the unlock phase ) uses it for any gain.
 */

type Window = {
    chance: number
    // What the window asks of the card that is drawn: null when it asks nothing in particular
    kinds: NeedKind[] | null
}

const BLEED_KINDS: NeedKind[] = ['bounce', 'defence']
const COMBAT_KINDS: NeedKind[] = ['combat']
const MINION = TurnSequence.indexOf(TurnPhase.Minion)

// A bleed against me is going on: a bounce or a block is what a draw can bring
function bleedsMe(decision: DecisionPoint): boolean {
    const action = decision.player.gameState.action
    return (
        decision.kind == DecisionKind.ReactionImpulse &&
        action?.minionAction.type == MinionActionType.Bleed &&
        action.minionAction.target == decision.player
    )
}

// What the window of this decision asks of a draw
function kindsOf(decision: DecisionPoint): NeedKind[] | null {
    if (bleedsMe(decision)) {
        return BLEED_KINDS
    }
    return decision.kind == DecisionKind.Combat ? COMBAT_KINDS : null
}

// The windows of the cycle that come after this decision, in order
function windowsAfter(
    decision: DecisionPoint,
    evaluator: HandEvaluator,
    assessment: Assessment,
): Window[] {
    const me = decision.player
    const gameState = me.gameState
    const players = gameState.competingPlayers
    const active = gameState.activePlayer
    const mine = players.indexOf(me)
    const count = players.length
    const { bleedOdds } = assessment.profile.hand
    const plain: Window = { chance: 1, kinds: null }
    const bleed: Window = {
        chance: 1 - (1 - bleedOdds) ** evaluator.bleeds,
        kinds: BLEED_KINDS,
    }
    const fight: Window = { chance: Math.min(1, evaluator.fights), kinds: COMBAT_KINDS }
    const fighting = decision.kind != DecisionKind.Combat
    const phase = gameState.turnPhaseIndex
    const windows: Window[] = []

    // The rest of my own turn
    if (active == me) {
        if (phase == MINION && fighting) {
            windows.push(fight)
        }
        for (let next = phase + 1; next < TurnSequence.length; next++) {
            windows.push(plain)
            if (next == MINION && fighting) {
                windows.push(fight)
            }
        }
    }

    // The turns of the others, from the one that plays after me to my predator
    const done = active == me || !active ? 0 : (players.indexOf(active) - mine + count) % count
    for (let step = 1; step < count; step++) {
        if (step < done) {
            continue
        }
        const owner = players[(mine + step) % count]
        const playing = owner == active
        const ended = playing && decision.kind == DecisionKind.TurnEnd
        const bleeding = step == count - 1 && !(playing && bleedsMe(decision)) && !ended
        if (bleeding) {
            windows.push(bleed)
        }
        // Only a bot that ends its turn opens the window of the end of the turn
        if (owner.isBot && !owner.isOusted && !ended) {
            windows.push(plain)
        }
    }
    return windows
}

// The value of a charge that can be used at these windows, the first one that comes being the first of the list
function valueOf(windows: Window[], gain: (kinds: NeedKind[] | null) => number): number {
    let value = 0
    for (let index = windows.length - 1; index >= 0; index--) {
        const { chance, kinds } = windows[index]
        value = chance * Math.max(gain(kinds), value) + (1 - chance) * value
    }
    return value
}

type Cycle = {
    evaluator: HandEvaluator
    // The card that goes: the weakest of the hand, other than a card that throws cards away itself
    weakest: { card: LibraryCard; keep: number }
    gain: (kinds: NeedKind[] | null) => number
    windows: Window[]
}

function cycleOf(
    decision: DecisionPoint,
    assessment: Assessment,
    deck: DeckList,
    cards: LibraryCard[],
): Cycle | null {
    const evaluator = new HandEvaluator(assessment, deck, decision.player)
    const weakest = evaluator.weakest(cards.filter(card => !discards(card)))
    if (!weakest) {
        return null
    }
    const margin = assessment.profile.hand.chargeMargin
    const gain = (kinds: NeedKind[] | null) =>
        (kinds ? evaluator.drawFor(weakest.card.oid, kinds) : evaluator.draw(weakest.card.oid)) -
        weakest.keep -
        margin
    return { evaluator, weakest, gain, windows: windowsAfter(decision, evaluator, assessment) }
}

/**
 * Use the charge of a card in play that throws a card away now? Yes when the gain of this window is worth more
 * than the best of the windows to come, and is a gain. Null when the charge waits.
 */
export function judgeCycle(
    decision: DecisionPoint,
    assessment: Assessment,
    deck: DeckList,
): HandJudgement | null {
    const routes = optionsOfType(decision.options, 'lockEffect').filter(option =>
        discards(option.card),
    )
    const cycle = cycleOf(
        decision,
        assessment,
        deck,
        routes.map(option => option.discard),
    )
    if (!cycle) {
        return null
    }
    const now = cycle.gain(kindsOf(decision))
    const later = valueOf(cycle.windows, cycle.gain)
    const option = routes.find(route => route.discard == cycle.weakest.card)
    if (!option || now <= later) {
        return null
    }
    return {
        option,
        candidates: [{ option, score: now, parts: { now, later } }],
        note: `${cycle.weakest.card.name} is worth ${cycle.weakest.keep.toFixed(2)}, this window ${now.toFixed(2)} against ${later.toFixed(2)} to come`,
    }
}

// The windows to come, by what each asks of a draw ( plain, bleed, fight ), with the chance that it comes
export function windowsOf(
    decision: DecisionPoint,
    assessment: Assessment,
    deck: DeckList,
): { chance: number; kind: 'plain' | 'bleed' | 'fight' }[] {
    const evaluator = new HandEvaluator(assessment, deck, decision.player)
    return windowsAfter(decision, evaluator, assessment).map(window => ({
        chance: window.chance,
        kind:
            window.kinds == BLEED_KINDS ? 'bleed'
            : window.kinds == COMBAT_KINDS ? 'fight'
            : 'plain',
    }))
}

/**
 * What a card that throws cards away is worth per cycle, played now: the value of its charge at the windows that
 * are left, with the hand as it is. Nothing when the hand has no card to throw.
 */
export function cycleWorthOf(
    decision: DecisionPoint,
    assessment: Assessment,
    deck: DeckList,
): number {
    const cycle = cycleOf(
        decision,
        assessment,
        deck,
        decision.player.hand.cards.filter(card => card instanceof LibraryCard),
    )
    return cycle ? valueOf(cycle.windows, cycle.gain) : 0
}

/**
 * What the cards of the master phase that last are worth per turn: the charge of those that throw cards away and the
 * intercept of those that give it, priced only when a card of the decision does one of them.
 */
export function standingOf(
    decision: DecisionPoint,
    assessment: Assessment,
    deck: DeckList,
): Standing {
    const cards = optionsOfType(decision.options, 'playMaster').map(option => option.card)
    const cycle = cards.some(discards) ? cycleWorthOf(decision, assessment, deck) : 0
    return cards.some(guards) ? standingFor(assessment, cycle) : { cycle, defence: 0, bleeds: 0 }
}
