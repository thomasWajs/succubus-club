import { Player } from '@/shared/model/Player.ts'
import { CardOid } from '@/shared/types/model.ts'
import { LEAVE_TORPOR_COST } from '@/shared/const/model.ts'
import { getExtraPlayCost } from '@/shared/cardImpl/catalog/attached.ts'
import { countHostages } from '@/shared/state/standingCards.ts'
import { resolveCost } from '@/shared/state/cardCosts.ts'
import { getMasterCardOptions } from '@/shared/bot/cardOptions.ts'
import { findOption } from '@/shared/bot/helpers.ts'
import { BotOption, BotOptionOf, DecisionPoint, optionsOfType } from '@/shared/bot/types.ts'
import { Assessment, chanceOfOust } from '@/shared/bot/utility/assessment.ts'
import { bloodChange } from '@/shared/bot/utility/bloat.ts'
import { PlayValues } from '@/shared/bot/utility/cardActions.ts'
import { ExplainCandidate } from '@/shared/bot/utility/explain.ts'
import { MinionProfile, profileMatches } from '@/shared/bot/utility/minionProfile.ts'
import { keepOf } from '@/shared/bot/utility/reserve.ts'
import { readyMinions, unlockedMinions } from '@/shared/bot/utility/snapshot.ts'
import {
    AbilitySummary,
    Effect,
    PlaySummary,
    summarizeCard,
} from '@/shared/bot/utility/summaries.ts'

/**
 * The master phase and the blood. Every master card of the hand is a play with a worth in pool, read from its
 * summary: the blood it puts on a vampire or takes to the pool, the hand size it gives, what it does while
 * it stays on a vampire or in play ( the blood a Doll carries over, a hunting ground, a charge of stealth or
 * intercept ), less the card and the pool it costs. The same worth prices the moves of blood of the cards
 * already in play and the use of the unlock effects. A trifle goes first: it gives back the master phase
 * action it uses. Nothing is kept from one decision to the next: what was played is gone from the options.
 */

/**
 * What the cards that last are worth per turn, read from the hand: the charge of a card that throws cards away,
 * and what one use of an intercept against a bleed is worth with the bleeds of my predator to expect in a turn, and
 * what one draw from the crypt adds to my uncontrolled region.
 */
export type Standing = { cycle: number; defence: number; bleeds: number; draw: number }

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

function othersMinions(assessment: Assessment): MinionProfile[] {
    return assessment.table.others.flatMap(other => other.minions)
}

// The chance that a minion goes to torpor over the stay of a card in play: the emptier it is, the likelier
function torporChance(assessment: Assessment, minion: MinionProfile): number {
    const emptiness = 1 - minion.blood / Math.max(1, minion.capacity)
    return Math.min(1, assessment.profile.master.torpor * (1 + 2 * emptiness))
}

// What the permission to start a fight with these minions is worth over the stay: the fights my minions start and win,
// times what the loser loses ( the share of its worth ). `reach` is how hard the permission is to stop
function fightWorth(assessment: Assessment, targets: MinionProfile[], reach: number): number {
    if (targets.length == 0) {
        return 0
    }
    const { master, combat } = assessment.profile
    const fights = Math.min(1, master.fight * reach * readyMinions(assessment.table.me).length)
    const loss = targets.reduce((total, minion) => total + minion.worth, 0) / targets.length
    return fights * loss * combat.torporShare
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
    return amount * Math.max(0, plan.poolValue - plan.bloodValue)
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
function chargeWorth(
    assessment: Assessment,
    values: PlayValues,
    ability: AbilitySummary,
    standing: Standing,
): number {
    const { master } = assessment.profile
    if (ability.effects.some(effect => effect.type == 'discardFromHand')) {
        return standing.cycle * master.stay
    }
    if (ability.effects.some(effect => effect.type == 'drawCrypt')) {
        return standing.draw * master.draws
    }
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
        // One use a turn, worth what an intercept card of the hand is
        const held = intercept.length > 0 ? Math.min(1, standing.bleeds) * standing.defence : 0
        return Math.max(
            0,
            ...fits.map(minion =>
                Math.max(
                    held * master.stay,
                    values.attachedWorth(intercept, minion, master.stay) ?? 0,
                ),
            ),
        )
    }
    return 0
}

// What one use of a card in play that reacts to an action is worth: the blood it gives, the action an unlock gives back
function triggerWorth(assessment: Assessment, effects: Effect[]): number {
    const { plan } = assessment.profile
    return effects.reduce(
        (total, effect) =>
            total +
            (effect.type == 'gainBlood' ? effect.amount * plan.bloodValue
            : effect.type == 'unlockActor' ? plan.cardAction
            : effect.type == 'trigger' ? triggerWorth(assessment, effect.effects)
            : 0),
        0,
    )
}

// What one use of a card in play that is locked for an effect is worth: the cards the hand size draws, the pool, the
// blood put on a vampire that is still uncontrolled ( a transfer saved )
function lockUseWorth(assessment: Assessment, ability: AbilitySummary, blood = 0): number {
    const { master } = assessment.profile
    const { plan } = assessment.profile
    return ability.effects.reduce(
        (total, effect) =>
            total +
            (effect.type == 'handSizeThisTurn' ? effect.amount * master.handSize
            : effect.type == 'gainPool' || effect.type == 'bloodToUncontrolled' ?
                effect.amount * plan.poolValue
            : effect.type == 'bloodPerHostage' ? blood * plan.bloodValue
            : 0),
        0,
    )
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

function mastersOf(options: BotOptionOf<'playMaster'>[]): number {
    return new Set(options.map(option => option.card.oid)).size
}

function playValue(
    assessment: Assessment,
    values: PlayValues,
    option: BotOptionOf<'playMaster'>,
    standing: Standing,
    masters: number,
): Judged | null {
    const play = summaryOfPlay(option)
    if (!play) {
        return null
    }
    const { profile } = assessment
    const { master, plan } = profile
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
                if (!target || target.blood - taken < keepOf(assessment, target)) {
                    return null
                }
                parts.pool = (parts.pool ?? 0) + conversionOf(assessment, taken)
                break
            }
            case 'handSize':
                parts.hand = (parts.hand ?? 0) + effect.amount * master.handSize * master.stay
                break
            case 'poolToCounters':
                parts.counters = (parts.counters ?? 0) - effect.amount * master.stay * plan.caution
                break
            case 'othersBurnPerCounter':
                // One more counter each turn: the others burn 1, then 2... over the stay
                parts.drain =
                    (parts.drain ?? 0) +
                    assessment.table.others.length *
                        ((master.stay * (master.stay + 1)) / 2) *
                        plan.caution *
                        master.drain
                break
            case 'bearerCanBeFought': {
                // Every minion of mine can start a fight with the vampire it is on, which gets harder to stop
                const bearer = othersMinions(assessment).find(
                    minion => minion.oid == option.target?.oid,
                )
                parts.fight =
                    (parts.fight ?? 0) +
                    fightWorth(assessment, bearer ? [bearer] : [], 1 + effect.stealth)
                break
            }
            case 'combatWithPrey': {
                const prey = assessment.table.prey ? readyMinions(assessment.table.prey) : []
                parts.fight = (parts.fight ?? 0) + fightWorth(assessment, prey, 1)
                break
            }
            case 'poolWhenPreyLosesMinion': {
                const prey = assessment.table.prey ? readyMinions(assessment.table.prey) : []
                parts.preyLoss =
                    (parts.preyLoss ?? 0) +
                    prey.reduce((total, minion) => total + torporChance(assessment, minion), 0) *
                        effect.amount *
                        assessment.profile.plan.poolValue
                break
            }
            case 'influenceBurnsSelfAndPoolPerPreyMinion':
                // The card is burned in the influence phase of this turn, and I pay a pool for each ready minion of my prey
                parts.upkeep =
                    (parts.upkeep ?? 0) -
                    (assessment.table.prey ? readyMinions(assessment.table.prey).length : 0) *
                        plan.poolValue *
                        plan.caution
                break
            case 'hostageOnTorpor': {
                // The way back from torpor is lost for the vampires that fit, mine included
                const worth = (minions: MinionProfile[]) =>
                    minions
                        .filter(minion => minion.isVampire && minion.capacity <= effect.maxCapacity)
                        .reduce((total, minion) => total + torporChance(assessment, minion), 0) *
                    plan.torporReturn
                parts.hostage =
                    (parts.hostage ?? 0) +
                    worth(othersMinions(assessment)) -
                    worth(readyMinions(assessment.table.me))
                break
            }
            case 'trigger':
                parts.trigger =
                    (parts.trigger ?? 0) +
                    triggerWorth(assessment, effect.effects) * master.charge * master.stay
                break
            case 'bearerTorporBurnsPool': {
                const host = othersMinions(assessment).find(
                    minion => minion.oid == option.target?.oid,
                )
                parts.torpor =
                    (parts.torpor ?? 0) +
                    (host ? torporChance(assessment, host) : master.torpor) *
                        effect.amount *
                        plan.poolValue
                break
            }
            default:
                break
        }
    }
    const lockUses = play.abilities
        .filter(ability => ability.activate == 'lockUse')
        .map(ability => lockUseWorth(assessment, ability) * (ability.needsEdge ? master.edge : 1))
    if (lockUses.length > 0) {
        // Every use is the best of the abilities, until the card is burned
        parts.uses = Math.max(...lockUses) * (play.burnsAtLocks ?? master.stay)
    }
    if (target) {
        const carried = play.attached
            .flatMap(effect => (effect.type == 'moveBlood' ? [effect.amount] : []))
            .reduce((total, amount) => total + amount, 0)
        if (carried > 0) {
            // What the carriers on it already move is spoken for
            const stock = Math.max(
                0,
                target.blood +
                    master.regain * profile.cards.stay -
                    keepOf(assessment, target) -
                    target.bloodMove * profile.cards.stay,
            )
            parts.carry = conversionOf(assessment, Math.min(carried * profile.cards.stay, stock))
            if (poolCost <= 0 && masters <= 1) {
                parts.slot = master.freeSlot
            }
        }
        // An intercept that stays serves each bleed against me, and the bearer is one of the vampires that can block
        const held =
            (standing.defence * standing.bleeds) /
            Math.max(1, readyMinions(assessment.table.me).length)
        const attached = values.attachedWorth(play.attached, target, undefined, held)
        if (attached !== null) {
            parts.attached = attached
        }
    }
    const lasting = play.abilities.reduce(
        (total, ability) =>
            total +
            (ability.activate == 'lockUse' || ability.activate == 'freeHostage' ? 0
            : ability.windows.includes('unlockPhase') ?
                groundWorth(assessment, ability) * master.stay
            :   chargeWorth(assessment, values, ability, standing)),
        0,
    )
    if (lasting > 0) {
        parts.standing = lasting
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

// Pool put back on a vampire by a card on it: the blood, and the hunt that a vampire with none is spared, against
// the pool it costs, which may not leave my predator a better chance to oust me
function backValue(
    assessment: Assessment,
    option: BotOptionOf<'moveBlood'>,
    vampire: MinionProfile,
): Judged | null {
    const blood = gainOf(assessment, vampire, option.amount)
    const pool = -option.amount * assessment.profile.plan.caution
    if (blood + pool <= 0 || !holdsAfter(assessment, option.amount)) {
        return null
    }
    return {
        option,
        value: blood + pool,
        trifle: false,
        fill: vampire.blood / Math.max(1, vampire.capacity),
        parts: { blood, pool },
    }
}

// Blood of a vampire moved to the pool by a card on it: only what the vampire does not need for itself
function moveValue(assessment: Assessment, option: BotOptionOf<'moveBlood'>): Judged | null {
    const vampire = profileOf(assessment, option.vampire)
    if (!vampire) {
        return null
    }
    if (!option.toPool) {
        return backValue(assessment, option, vampire)
    }
    if (vampire.blood - option.amount < keepOf(assessment, vampire)) {
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
    const freeing = (summarizeCard(option.card)?.plays ?? [])
        .flatMap(play => play.abilities)
        .flatMap(ability => ability.effects)
        .find(effect => effect.type == 'freeHostage')
    if (freeing) {
        // A vampire freed is worth the way back from torpor, if it holds the blood to leave it
        if (!vampire || vampire.blood < LEAVE_TORPOR_COST) {
            return null
        }
        const { plan } = assessment.profile
        const value = plan.torporReturn - freeing.cost * plan.bloodValue
        return { option, value, trifle: false, fill: 0, parts: { freed: value } }
    }
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
 * What each master card of the hand would be worth if it were played now, by card: the best of its plays. A card
 * with no play that pays ( or none at all ) is not in the map.
 */
export function masterWorths(
    assessment: Assessment,
    player: Player,
    standing: Standing,
): Map<CardOid, number> {
    const values = new PlayValues(assessment)
    const worths = new Map<CardOid, number>()
    const options = getMasterCardOptions(player)
    const masters = mastersOf(options)
    for (const option of options) {
        const judged = playValue(assessment, values, option, standing, masters)
        if (judged) {
            worths.set(option.card.oid, Math.max(worths.get(option.card.oid) ?? 0, judged.value))
        }
    }
    return worths
}

/**
 * The master phase: the card of the hand or the move of blood that pays most, and the end of the phase when
 * none pays enough.
 */
export function judgeMaster(
    decision: DecisionPoint,
    assessment: Assessment,
    standing: Standing,
): MasterJudgement {
    const values = new PlayValues(assessment)
    const playable = optionsOfType(decision.options, 'playMaster')
    const masters = mastersOf(playable)
    const plays = playable.flatMap(
        option => playValue(assessment, values, option, standing, masters) ?? [],
    )
    const moves = optionsOfType(decision.options, 'moveBlood').flatMap(
        option => moveValue(assessment, option) ?? [],
    )
    return choose(assessment, findOption(decision.options, 'endPhase'), [
        plays,
        moves,
        lockUses(assessment, decision),
    ])
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
    return choose(assessment, findOption(decision.options, 'endPhase'), [
        effects,
        moves,
        lockUses(assessment, decision),
    ])
}

function lockUseValue(assessment: Assessment, option: BotOptionOf<'lockUse'>): Judged | null {
    const ability = summarizeCard(option.card)?.plays.find(play => play.kind == 'master')
        ?.abilities[option.ability]
    if (!ability) {
        return null
    }
    const target = profileOf(assessment, option.target)
    const room = target ? target.capacity - target.blood : 0
    const value = lockUseWorth(
        assessment,
        ability,
        Math.min(countHostages(option.card.gameState), room),
    )
    return { option, value, trifle: false, fill: 0, parts: { use: value } }
}

function lockUses(assessment: Assessment, decision: DecisionPoint): Judged[] {
    return optionsOfType(decision.options, 'lockUse').flatMap(
        option => lockUseValue(assessment, option) ?? [],
    )
}

/**
 * The discard phase: a card in play that is locked for an effect of its own, when it pays. Null when none does.
 */
export function judgeLockUse(
    decision: DecisionPoint,
    assessment: Assessment,
): MasterJudgement | null {
    const uses = lockUses(assessment, decision)
    const best = uses
        .filter(judged => judged.value >= assessment.profile.master.margin)
        .toSorted(byOrder)[0]
    return best ?
            {
                option: best.option,
                candidates: uses.map(judged => ({
                    option: judged.option,
                    score: judged.value,
                    parts: judged.parts,
                })),
                note: `worth ${best.value.toFixed(2)}`,
            }
        :   null
}
