import { LEAVE_TORPOR_COST } from '@/shared/const/model.ts'
import { CardOid } from '@/shared/types/model.ts'
import { MinionActionType } from '@/shared/types/state.ts'
import { BotOptionOf } from '@/shared/bot/types.ts'
import {
    Assessment,
    bleedOnPrey,
    combatEdge,
    outcomeOfTurn,
    TurnOutcome,
} from '@/shared/bot/utility/assessment.ts'
import { bloodChange } from '@/shared/bot/utility/bloat.ts'
import { BleedGain, costOfLunge, gainOfBleeds, LungeCost } from '@/shared/bot/utility/equity.ts'
import { MinionProfile } from '@/shared/bot/utility/minionProfile.ts'
import { returnWorth } from '@/shared/bot/utility/rescue.ts'
import { unlockedMinions } from '@/shared/bot/utility/snapshot.ts'
import { summarizeCard } from '@/shared/bot/utility/summaries.ts'

/**
 * The turn plan ( .claude/docs/bot-ai-phase3.md, step 3.3 ): at the start of the minion phase, and again
 * after each action that resolves, who stays unlocked to defend, who acts and with what. The unit of power
 * is the minion-turn: an unlocked minion at the end of my turn is a block ( or a bounce ) during the turn
 * of my predator, a locked one is not, unless a wake card brings it back. So every candidate reserve is
 * played out, my turn then the lunge of my predator, in the one currency of equity.ts, and the best is
 * kept. A pure function of the assessment and of the options the referee offers: the same view makes the
 * same plan, nothing is remembered between two decisions.
 */

export type ActionKind = 'bleed' | 'hunt' | 'rescue' | 'leaveTorpor' | 'other'

// An action the referee offers, seen by the plan
export type Candidate = {
    kind: ActionKind
    option: BotOptionOf<'declareAction'>
    // The acting minion
    actor: CardOid
    // The torpid vampire of a rescue
    target?: CardOid
    // The blood the acting minion pays for a rescue
    paid: number
}

export function candidateOf(option: BotOptionOf<'declareAction'>): Candidate {
    const { action } = option
    const actor = action.actingMinion.oid
    switch (action.type) {
        case MinionActionType.Bleed:
            return { kind: 'bleed', option, actor, paid: 0 }
        case MinionActionType.Hunt:
            return { kind: 'hunt', option, actor, paid: 0 }
        case MinionActionType.LeaveTorpor:
            return { kind: 'leaveTorpor', option, actor, paid: 0 }
        case MinionActionType.RescueFromTorpor:
            return {
                kind: 'rescue',
                option,
                actor,
                target: action.target.oid,
                paid: action.bloodPaidByActingMinion ?? 0,
            }
        default:
            // The cards of the hand, entering combat, diablerie...: valued when step 3.5 reads the cards
            return { kind: 'other', option, actor, paid: 0 }
    }
}

export type PlanInput = {
    assessment: Assessment
    candidates: Candidate[]
    // The referee offers no way to end the phase: a vampire without blood must hunt first
    mandatory: boolean
    // The cards of my hand that unlock a minion after it acted ( exact, my hand is known )
    unlockCards: number
}

export type PlannedAction = {
    kind: ActionKind
    actor: MinionProfile
    // What it adds to the turn, in pool
    value: number
    option: BotOptionOf<'declareAction'>
}

// One way to keep the turn: these minions stay unlocked, the others act
export type ReserveCase = {
    kept: MinionProfile[]
    // Of the minions that bleed, the ones that stay unlocked thanks to an unlock card
    unlocked: MinionProfile[]
    bleeders: MinionProfile[]
    // What each bleeder adds, in pool, when it joins the ones before it ( the biggest bleed first )
    marginals: Map<CardOid, number>
    bleeds: BleedGain
    // The blocks of my prey that my bleeders may run into: their fights, a coarse risk until step 3.4
    combat: number
    // What the minions that do something else than bleed bring
    idle: number
    // What the kept minions are worth against the actions that are not bleeds
    guard: number
    lunge: LungeCost
    // The wake and unlock cards the plan spends
    cards: number
    chanceToOust: number
    chanceOfBeingOusted: number
    equity: number
}

export type Posture = 'forced' | 'lunge' | 'defend' | 'balanced'

export type TurnPlan = {
    posture: Posture
    // The minions that could have acted and stay unlocked
    reserved: MinionProfile[]
    // In the order they should be declared
    actions: PlannedAction[]
    // Every reserve that was played out ( none when the phase is forced ), and the one that was kept
    cases: ReserveCase[]
    chosen: number
    // The chance that my prey bounces a bleed of mine: above `baitAbove` the small bleeds go first
    bounceRisk: number
}

/**
 * Valuing what a minion does
 */

// A rescue is worth what the return of the vampire changes for me, and only the part that no helper
// would bring about anyway, less the blood the rescuer pays. The rescuer chooses the split of the cost:
// what the vampire pays itself is blood it will not have once back ( with none it must hunt first )
function rescueValue(assessment: Assessment, candidate: Candidate): number {
    const { table, rescues, profile } = assessment
    const opening = rescues.find(rescue => rescue.vampire.oid == candidate.target)
    const rescuer = table.me.minions.find(minion => minion.oid == candidate.actor)
    if (!opening || !rescuer) {
        return 0
    }
    const mine = opening.owner == table.me.oid
    const bloodAfter = opening.vampire.blood - (LEAVE_TORPOR_COST - candidate.paid)
    const worth = returnWorth(opening, bloodAfter, profile) + (mine ? profile.plan.torporReturn : 0)
    return worth * (1 - opening.chance) + bloodChange(profile, rescuer, -candidate.paid)
}

// What an action of a card of the hand is worth: the placeholder of the profile, raised by the best
// role of the card ( step 3.5 values the cards themselves )
function cardActionValue(assessment: Assessment, candidate: Candidate): number {
    const { plan } = assessment.profile
    const { action } = candidate.option
    const summary =
        action.type == MinionActionType.ActionCardFromHand ? summarizeCard(action.card) : undefined
    const roles = summary?.plays.flatMap(play => play.roles) ?? []
    return Math.max(plan.cardAction, ...roles.map(role => plan.cardActionByRole[role] ?? 0))
}

// What a minion does when it does not bleed: hunt, rescue, or the card the base rules would play
type Idle = { kind: ActionKind; value: number; candidate: Candidate }

function idleOf(assessment: Assessment, minion: MinionProfile, own: Candidate[]): Idle | null {
    const options = own.flatMap((candidate): Idle[] => {
        switch (candidate.kind) {
            case 'hunt': {
                // The blood a Blood Doll carries over to the pool is pool: it counts in full
                const room = Math.max(0, Math.min(minion.hunt, minion.capacity - minion.blood))
                const value = bloodChange(assessment.profile, minion, room)
                return [{ kind: 'hunt', value, candidate }]
            }
            case 'rescue':
                return [{ kind: 'rescue', value: rescueValue(assessment, candidate), candidate }]
            case 'other':
                return [{ kind: 'other', value: cardActionValue(assessment, candidate), candidate }]
            default:
                return []
        }
    })
    return options.reduce<Idle | null>(
        (best, idle) => (best && best.value >= idle.value ? best : idle),
        null,
    )
}

// What leaving torpor is worth: the vampire is back ( no helper would have done it ), at the price of
// its own blood. It takes no minion-turn of the others.
function leaveTorporValue(assessment: Assessment, candidate: Candidate): number {
    const { table, rescues, profile } = assessment
    const vampire = table.me.minions.find(minion => minion.oid == candidate.actor)
    if (!vampire) {
        return 0
    }
    const opening = rescues.find(
        rescue => rescue.owner == table.me.oid && rescue.vampire.oid == candidate.actor,
    )
    const bloodAfter = vampire.blood - LEAVE_TORPOR_COST
    const worth =
        (opening ? returnWorth(opening, bloodAfter, profile) : 0) + profile.plan.torporReturn
    return worth * (1 - (opening?.chance ?? 0)) + bloodChange(profile, vampire, -LEAVE_TORPOR_COST)
}

// The fight a block of my prey would run my minion into, in pool: coarse, until the combat model of 3.4
function combatRisk(assessment: Assessment, minion: MinionProfile): number {
    const { prey } = assessment.table
    const blockers = prey ? unlockedMinions(prey) : []
    return (
        assessment.profile.combatPool *
        Math.max(0, ...blockers.map(blocker => combatEdge(blocker, minion)))
    )
}

function wakeCardsOf(assessment: Assessment): number {
    return assessment.table.me.hand.filter(({ summary }) =>
        summary.plays.some(play => play.roles.includes('wake')),
    ).length
}

/**
 * The plan
 */

export function planTurn(input: PlanInput): TurnPlan {
    const { assessment, candidates } = input
    const { table, profile } = assessment
    const { plan: weights } = profile
    const me = table.me
    const profileOf = (oid: CardOid) => me.minions.find(minion => minion.oid == oid)

    const byActor = new Map<CardOid, Candidate[]>()
    for (const candidate of candidates) {
        byActor.set(candidate.actor, [...(byActor.get(candidate.actor) ?? []), candidate])
    }
    const planned = (candidate: Candidate, value: number): PlannedAction[] => {
        const actor = profileOf(candidate.actor)
        return actor ? [{ kind: candidate.kind, actor, value, option: candidate.option }] : []
    }

    if (input.mandatory) {
        // Who acts is not a choice: the hunts of the empty vampires first, then what is left
        const actions = candidates
            .flatMap(candidate => planned(candidate, 0))
            .toSorted(
                (a, b) =>
                    Number(b.kind == 'hunt') - Number(a.kind == 'hunt') ||
                    a.actor.blood - b.actor.blood ||
                    b.actor.bleed - a.actor.bleed,
            )
        return { posture: 'forced', reserved: [], actions, cases: [], chosen: -1, bounceRisk: 0 }
    }

    const unlocked = unlockedMinions(me)
    const acting = unlocked.filter(minion => byActor.has(minion.oid))
    // A minion with nothing to do is home whatever the plan says
    const stuck = unlocked.filter(minion => !byActor.has(minion.oid))
    const idles = new Map(
        acting.map(minion => [
            minion.oid,
            idleOf(assessment, minion, byActor.get(minion.oid) ?? []),
        ]),
    )
    const idleValue = (minion: MinionProfile) => Math.max(0, idles.get(minion.oid)?.value ?? 0)
    const bleedCandidate = (minion: MinionProfile) =>
        byActor.get(minion.oid)?.find(candidate => candidate.kind == 'bleed')
    const canBleed = (minion: MinionProfile) =>
        !!bleedCandidate(minion) && minion.bleed > 0 && minion.blood > 0

    const prey = table.prey
    const bounceRisk = prey ? (assessment.opportunity[prey.oid]?.chanceOfBounce ?? 0) : 0
    // The best blockers are kept first ( intercept against bleeds, then strength for the fight that
    // follows ), the cheapest to idle before the others
    const blocker = (a: MinionProfile, b: MinionProfile) =>
        b.intercept.againstBleeds - a.intercept.againstBleeds || b.strength - a.strength
    const standalone = new Map(
        acting.map(minion => [
            minion.oid,
            Math.max(
                idleValue(minion),
                canBleed(minion) ?
                    gainOfBleeds(assessment, bleedOnPrey(assessment, [minion])).total
                :   0,
            ),
        ]),
    )
    const order = acting.toSorted(
        (a, b) =>
            blocker(a, b) ||
            (standalone.get(a.oid) ?? 0) - (standalone.get(b.oid) ?? 0) ||
            b.blood - a.blood,
    )

    const wakeCards = wakeCardsOf(assessment)
    const evaluate = (kept: MinionProfile[], unlockCards: number): ReserveCase => {
        const actors = order.filter(minion => !kept.includes(minion))

        // The bleeders, biggest first: each one goes while it adds more than what it would do instead
        const bleeders: MinionProfile[] = []
        const marginals = new Map<CardOid, number>()
        let bleeds = gainOfBleeds(assessment, null)
        let blocks = 0
        let combat = 0
        for (const minion of actors
            .filter(canBleed)
            .toSorted((a, b) => b.bleed - a.bleed || b.blood - a.blood)) {
            const result = bleedOnPrey(assessment, [...bleeders, minion])
            const next = gainOfBleeds(assessment, result)
            const nextBlocks = result ? result.blockedShare * result.attackers : 0
            const fight = Math.max(0, nextBlocks - blocks) * combatRisk(assessment, minion)
            const marginal = next.total - bleeds.total - fight
            if (marginal > idleValue(minion) + 1e-9) {
                bleeders.push(minion)
                marginals.set(minion.oid, marginal)
                bleeds = next
                blocks = nextBlocks
                combat += fight
            }
        }

        // The others do their idle action when it is worth something, else they stay home
        const doers = actors.filter(minion => !bleeders.includes(minion) && idleValue(minion) > 0)
        const idle = doers.reduce((total, minion) => total + idleValue(minion), 0)
        const home = actors.filter(minion => !bleeders.includes(minion) && !doers.includes(minion))
        const stay = bleeders.toSorted(blocker).slice(0, unlockCards)
        const defence = [...stuck, ...kept, ...home, ...stay]
        const outcome: TurnOutcome = outcomeOfTurn(assessment, {
            actors: bleeders,
            reserved: defence,
        })

        // A wake card is spent for each block that the unlocked minions cannot make, if a minion is asleep
        const asleep = actors.length - home.length - stay.length
        const woken = Math.min(wakeCards, asleep, Math.max(0, outcome.blocks - defence.length))
        const cards = (woken + stay.length) * weights.spentCard
        const lunge = costOfLunge(assessment, outcome)
        const guard = weights.guard * kept.length
        return {
            kept,
            unlocked: stay,
            bleeders,
            marginals,
            bleeds,
            combat,
            idle,
            guard,
            lunge,
            cards,
            chanceToOust: outcome.chanceToOust,
            chanceOfBeingOusted: outcome.chanceOfBeingOusted,
            equity: bleeds.total - combat + idle + guard - lunge.total - cards,
        }
    }

    // Each reserve, from the whole set of blockers down to none: with an unlock card a minion that bleeds
    // can stay a blocker, so both ways are played out
    const cases: ReserveCase[] = []
    for (let k = order.length; k >= 0; k--) {
        const kept = order.slice(0, k)
        const variants = [evaluate(kept, 0)]
        if (input.unlockCards > 0) {
            variants.push(evaluate(kept, input.unlockCards))
        }
        cases.push(variants.reduce((best, one) => (one.equity > best.equity + 1e-9 ? one : best)))
    }
    // On a tie the larger reserve wins: it comes first
    const chosen = cases.reduce(
        (best, one, index) => (one.equity > cases[best].equity + 1e-9 ? index : best),
        0,
    )
    const best = cases[chosen]

    // The order of the bleeds: when my prey may bounce one, small first so it spends its bounce on a
    // small one ( bait ); else the biggest first, which burns its blockers
    const bait = bounceRisk >= weights.baitAbove
    const actions: PlannedAction[] = [
        ...candidates
            .filter(candidate => candidate.kind == 'leaveTorpor')
            .flatMap(candidate => planned(candidate, leaveTorporValue(assessment, candidate)))
            .filter(action => action.value > 0),
        ...best.bleeders
            .toSorted((a, b) => (bait ? a.bleed - b.bleed : b.bleed - a.bleed) || b.blood - a.blood)
            .flatMap(minion => {
                const candidate = bleedCandidate(minion)
                return candidate ? planned(candidate, best.marginals.get(minion.oid) ?? 0) : []
            }),
        ...order
            .filter(minion => !best.kept.includes(minion) && !best.bleeders.includes(minion))
            .flatMap(minion => {
                const idle = idles.get(minion.oid)
                return idle && idle.value > 0 ? planned(idle.candidate, idle.value) : []
            })
            .toSorted((a, b) => b.value - a.value),
    ]
    const threshold = weights.postureAt
    const posture: Posture =
        best.bleeders.length > 0 && best.chanceToOust >= threshold ? 'lunge'
        : best.chanceOfBeingOusted >= threshold ? 'defend'
        : 'balanced'
    return {
        posture,
        reserved: [...best.kept],
        actions,
        cases,
        chosen,
        bounceRisk,
    }
}
