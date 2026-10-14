import { CardOid } from '@/shared/types/model.ts'
import { getExtraPlayCost } from '@/shared/cardImpl/catalog/attached.ts'
import { resolveCost } from '@/shared/state/cardCosts.ts'
import { findOption } from '@/shared/bot/helpers.ts'
import { BotOption, BotOptionOf, DecisionPoint, optionsOfType } from '@/shared/bot/types.ts'
import { Assessment, chanceOfOust } from '@/shared/bot/utility/assessment.ts'
import { bloodChange } from '@/shared/bot/utility/bloat.ts'
import { PlayValues } from '@/shared/bot/utility/cardActions.ts'
import { ExplainCandidate } from '@/shared/bot/utility/explain.ts'
import { MinionProfile, profileMatches } from '@/shared/bot/utility/minionProfile.ts'
import { readyMinions, unlockedMinions } from '@/shared/bot/utility/snapshot.ts'
import { AbilitySummary, PlaySummary, summarizeCard } from '@/shared/bot/utility/summaries.ts'

/**
 * The master phase and the blood. Every master card of the hand is a play with a worth in pool, read from its
 * summary: the blood it puts on a vampire or takes to the pool, the hand size it gives, what it does while
 * it stays on a vampire or in play ( the blood a Doll carries over, a hunting ground, a charge of stealth or
 * intercept ), less the card and the pool it costs. The same worth prices the moves of blood of the cards
 * already in play and the use of the unlock effects. A trifle goes first: it gives back the master phase
 * action it uses. Nothing is kept from one decision to the next: what was played is gone from the options.
 */

export type MasterJudgement = {
    option: BotOption
    candidates: ExplainCandidate[]
    note: string
}

type Judged = {
    option: BotOption
    value: number
    trifle: boolean
    // How full the vampire it aims at is: of two equal choices the emptier one goes first
    fill: number
    parts: Record<string, number>
}

function profileOf(assessment: Assessment, minion: { oid: CardOid } | undefined) {
    return assessment.table.me.minions.find(candidate => candidate.oid == minion?.oid)
}

// What `amount` blood put on a vampire is worth, in pool: the blood, and the action that a vampire with none is spared
function gainOf(assessment: Assessment, vampire: MinionProfile, amount: number): number {
    const { table, profile, bloat } = assessment
    const given = Math.min(amount, Math.max(0, vampire.capacity - vampire.blood))
    if (given <= 0) {
        return 0
    }
    const hungry = vampire.blood == 0 && vampire.state != 'torpor' ? profile.plan.cardAction : 0
    return bloodChange(profile, vampire, given, bloat[table.me.oid]) + hungry
}

// What `amount` blood that becomes pool is worth over the blood kept: a point of pool counts more than a point of blood
function conversionOf(assessment: Assessment, amount: number): number {
    const { plan } = assessment.profile
    return amount * Math.max(0, plan.caution - plan.bloodValue)
}

function bloodOfAbility(ability: AbilitySummary): number {
    return ability.effects.reduce(
        (total, effect) => total + (effect.type == 'gainBlood' ? effect.amount : 0),
        0,
    )
}

// The hunting grounds in play: a vampire gains blood from one of them each turn, so the next ground serves another vampire
function groundsInPlay(assessment: Assessment): number {
    return assessment.table.me.permanents.reduce(
        (total, permanent) =>
            total +
            permanent.abilities.filter(
                ability => ability.windows.includes('unlockPhase') && bloodOfAbility(ability) > 0,
            ).length,
        0,
    )
}

// A hunting ground, per turn: the blood it gives to the vampire with the most to gain that no ground serves
function groundWorth(assessment: Assessment, ability: AbilitySummary): number {
    const amount = bloodOfAbility(ability)
    const gains = readyMinions(assessment.table.me)
        .filter(
            minion =>
                minion.isVampire && (!ability.minion || profileMatches(minion, ability.minion)),
        )
        .map(minion => gainOf(assessment, minion, amount))
        .toSorted((a, b) => b - a)
    return gains[groundsInPlay(assessment)] ?? 0
}

// A card in play that a minion of mine locks to give a bonus to an action or a block attempt, over `stay` turns
function chargeWorth(assessment: Assessment, values: PlayValues, ability: AbilitySummary): number {
    const { master } = assessment.profile
    const fits = readyMinions(assessment.table.me).filter(
        minion => !ability.minion || profileMatches(minion, ability.minion),
    )
    if (ability.activate == 'lockForAction') {
        const stealth = ability.effects.reduce(
            (total, effect) => total + (effect.type == 'stealth' ? effect.amount : 0),
            0,
        )
        return fits.length > 0 ? stealth * master.charge * master.stay : 0
    }
    if (ability.activate == 'lockForReaction') {
        const intercept = ability.effects.flatMap(effect =>
            effect.type == 'intercept' ? [effect] : [],
        )
        return Math.max(
            0,
            ...fits.map(minion => values.attachedWorth(intercept, minion, master.stay) ?? 0),
        )
    }
    return 0
}

// What the pool left would face: the chance that my predator ousts me on its next turn, with my minions home
function riskOf(assessment: Assessment, pool: number): number {
    return chanceOfOust(assessment, {
        pool,
        reserved: unlockedMinions(assessment.table.me),
    })
}

// A play that costs pool may not leave my predator a better chance to oust me than it has, or than `tolerance`
function holdsAfter(assessment: Assessment, cost: number): boolean {
    if (cost <= 0) {
        return true
    }
    const { pool } = assessment.table.me
    return (
        pool > cost &&
        riskOf(assessment, pool - cost) <=
            Math.max(assessment.profile.influence.tolerance, riskOf(assessment, pool))
    )
}

function summaryOfPlay(option: BotOptionOf<'playMaster'>): PlaySummary | undefined {
    return summarizeCard(option.card)?.plays.find(play => play.kind == 'master')
}

function playValue(
    assessment: Assessment,
    values: PlayValues,
    option: BotOptionOf<'playMaster'>,
): Judged | null {
    const play = summaryOfPlay(option)
    if (!play) {
        return null
    }
    const { profile } = assessment
    const { master, plan, bloat } = profile
    const target = profileOf(assessment, option.target)
    const poolCost =
        resolveCost(option.card.poolCost) +
        (option.target && option.card.krcgId ?
            getExtraPlayCost(option.target, option.card.krcgId)
        :   0)
    const parts: Record<string, number> = {
        cost: -(plan.spentCard + poolCost * plan.caution),
    }
    for (const effect of play.effects) {
        switch (effect.type) {
            case 'gainBlood':
                parts.blood =
                    (parts.blood ?? 0) + (target ? gainOf(assessment, target, effect.amount) : 0)
                break
            case 'bloodToPool': {
                const taken = option.amount ?? 0
                // A vampire keeps what it needs for itself
                if (!target || target.blood - taken < bloat.keep) {
                    return null
                }
                parts.pool = (parts.pool ?? 0) + conversionOf(assessment, taken)
                break
            }
            case 'handSize':
                parts.hand = (parts.hand ?? 0) + effect.amount * master.handSize * master.stay
                break
            default:
                break
        }
    }
    if (target) {
        const carried = play.attached
            .flatMap(effect => (effect.type == 'moveBlood' ? [effect.amount] : []))
            .reduce((total, amount) => total + amount, 0)
        if (carried > 0) {
            // What the carriers on it already move is spoken for
            const stock = Math.max(
                0,
                target.blood - bloat.keep - target.bloodMove * profile.cards.stay,
            )
            parts.carry = conversionOf(assessment, Math.min(carried * profile.cards.stay, stock))
        }
        const attached = values.attachedWorth(play.attached, target)
        if (attached !== null) {
            parts.attached = attached
        }
    }
    const standing = play.abilities.reduce(
        (total, ability) =>
            total +
            (ability.windows.includes('unlockPhase') ?
                groundWorth(assessment, ability) * master.stay
            :   chargeWorth(assessment, values, ability)),
        0,
    )
    if (standing > 0) {
        parts.standing = standing
    }
    const value = Object.values(parts).reduce((total, part) => total + part, 0)
    if (value >= master.margin && !holdsAfter(assessment, poolCost)) {
        return {
            option,
            value: 0,
            trifle: option.card.isTrifle,
            fill: 0,
            parts: { ...parts, risk: 1 },
        }
    }
    return {
        option,
        value,
        trifle: option.card.isTrifle,
        fill: target ? target.blood / Math.max(1, target.capacity) : 0,
        parts,
    }
}

// Blood of a vampire moved to the pool by a card on it: only what the vampire does not need for itself
function moveValue(assessment: Assessment, option: BotOptionOf<'moveBlood'>): Judged | null {
    const vampire = profileOf(assessment, option.vampire)
    if (
        !option.toPool ||
        !vampire ||
        vampire.blood - option.amount < assessment.profile.bloat.keep
    ) {
        return null
    }
    return {
        option,
        value: conversionOf(assessment, option.amount),
        trifle: false,
        fill: vampire.blood / Math.max(1, vampire.capacity),
        parts: { pool: conversionOf(assessment, option.amount) },
    }
}

// The blood a card in play gives a vampire in the unlock phase
function unlockValue(assessment: Assessment, option: BotOptionOf<'unlockEffect'>): Judged | null {
    const vampire = profileOf(assessment, option.vampire)
    const amount = (summarizeCard(option.card)?.plays ?? [])
        .flatMap(play => play.abilities)
        .filter(ability => ability.windows.includes('unlockPhase'))
        .reduce((total, ability) => Math.max(total, bloodOfAbility(ability)), 0)
    if (!vampire || amount <= 0) {
        return null
    }
    const value = gainOf(assessment, vampire, amount)
    return {
        option,
        value,
        trifle: false,
        fill: vampire.blood / Math.max(1, vampire.capacity),
        parts: { blood: value },
    }
}

const byOrder = (a: Judged, b: Judged) =>
    Number(b.trifle) - Number(a.trifle) || b.value - a.value || a.fill - b.fill

// The first group that holds something worth making, best first within it: a trifle, then the best worth
function choose(assessment: Assessment, endPhase: BotOption, groups: Judged[][]): MasterJudgement {
    const { margin } = assessment.profile.master
    const candidates = groups
        .flat()
        .toSorted((a, b) => b.value - a.value)
        .slice(0, 6)
        .map(judged => ({ option: judged.option, score: judged.value, parts: judged.parts }))
    for (const group of groups) {
        const best = group.filter(judged => judged.value >= margin).toSorted(byOrder)[0]
        if (best) {
            return { option: best.option, candidates, note: `worth ${best.value.toFixed(2)}` }
        }
    }
    return { option: endPhase, candidates, note: 'nothing worth making' }
}

/**
 * The master phase: the card of the hand or the move of blood that pays most, and the end of the phase when
 * none pays enough.
 */
export function judgeMaster(decision: DecisionPoint, assessment: Assessment): MasterJudgement {
    const values = new PlayValues(assessment)
    const plays = optionsOfType(decision.options, 'playMaster').flatMap(
        option => playValue(assessment, values, option) ?? [],
    )
    const moves = optionsOfType(decision.options, 'moveBlood').flatMap(
        option => moveValue(assessment, option) ?? [],
    )
    return choose(assessment, findOption(decision.options, 'endPhase'), [plays, moves])
}

/**
 * The unlock phase, once the cards are unlocked: the effects of the cards in play that give blood, and the
 * moves of blood to the pool.
 */
export function judgeUnlock(decision: DecisionPoint, assessment: Assessment): MasterJudgement {
    const effects = optionsOfType(decision.options, 'unlockEffect').flatMap(
        option => unlockValue(assessment, option) ?? [],
    )
    const moves = optionsOfType(decision.options, 'moveBlood').flatMap(
        option => moveValue(assessment, option) ?? [],
    )
    return choose(assessment, findOption(decision.options, 'endPhase'), [effects, moves])
}
