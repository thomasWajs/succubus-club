import { getMinionIntercept } from '@/shared/cardImpl/catalog/attached.ts'
import { LibraryCard, Minion } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { resolveCost } from '@/shared/state/cardCosts.ts'
import {
    getBlockedStrengthBonus,
    isBleed,
    isHunt,
    isPoliticalAction,
} from '@/shared/state/minionActions.ts'
import { ActionState, MinionAction, MinionActionType } from '@/shared/types/state.ts'
import { BotOptionOf, DecisionPoint, optionsOfType } from '@/shared/bot/types.ts'
import { Assessment, outcomeOfTurn } from '@/shared/bot/utility/assessment.ts'
import {
    AttackResult,
    chanceOfLossAtLeast,
    DefenceSide,
    exact,
    resolveAttack,
} from '@/shared/bot/utility/attack.ts'
import { lastingLoss, takenBack } from '@/shared/bot/utility/bloat.ts'
import {
    forecastFight,
    myFighter,
    netLoss,
    theirFighter,
} from '@/shared/bot/utility/combatPosition.ts'
import { attackersOf, attackKitOf, defenceOf, toAttackers } from '@/shared/bot/utility/defence.ts'
import { costOfLunge } from '@/shared/bot/utility/equity.ts'
import { ExplainCandidate } from '@/shared/bot/utility/explain.ts'
import { MinionProfile, profileMatches } from '@/shared/bot/utility/minionProfile.ts'
import { BotProfile } from '@/shared/bot/utility/profile.ts'
import { MethuselahSnapshot, unlockedMinions } from '@/shared/bot/utility/snapshot.ts'
import { Effect, waysUsableBy } from '@/shared/bot/utility/summaries.ts'

/**
 * The block of an action of another Methuselah, as a utility: what the block saves me, less the fight
 * it runs my blocker into and what the lock of the blocker costs me for the attacks to come. A block
 * is worth attempting when that is above the margin of the profile. The attempt only counts when it
 * can stand: the stealth cards of the acting side are believed from its hand, and flip it with the
 * chance they give. An attempt that is below the stealth counts when the intercept cards I hold reach it.
 */

export type BlockJudgement = {
    // The block to attempt, none when the best of them is not worth it
    block: BotOptionOf<'block'> | null
    candidates: ExplainCandidate[]
    note: string
}

const NOBODY_DEFENDS: DefenceSide = {
    reactors: [],
    wakers: [],
    wakeCards: exact(0),
    bounceCards: exact(0),
    bouncers: 0,
    standingIntercept: 0,
}

// What a bleed that lands, or the attacks to come, cost me: the pool that lasts, at caution, and the ouster
function costOfResult(assessment: Assessment, result: AttackResult): number {
    const { table, profile, bloat } = assessment
    const { me } = table
    const pool = lastingLoss(result, me.pool, takenBack(bloat[me.oid]), profile.bloat.recapture)
    return (
        pool * profile.plan.caution + chanceOfLossAtLeast(result, me.pool) * profile.plan.oustedCost
    )
}

// What stopping an action that is not a bleed aimed at me is worth: the guard, by the kind of action
function guardOf(assessment: Assessment, minionAction: MinionAction): number {
    const { guard, guardKinds } = assessment.profile.plan
    if (isHunt(minionAction)) {
        return guard * guardKinds.hunt
    }
    return guard * (isPoliticalAction(minionAction) ? guardKinds.political : guardKinds.other)
}

// What the action costs me when nobody blocks it: the bleed aimed at me, the cards of the acting side
// that raise it counted. The other actions are only worth the guard against them.
function denialOf(
    assessment: Assessment,
    owner: MethuselahSnapshot,
    actor: MinionProfile,
    minionAction: MinionAction,
    bleed: number | null,
): number {
    if (bleed === null) {
        return guardOf(assessment, minionAction)
    }
    const kit = attackKitOf(owner, [actor], assessment.densities[owner.oid], assessment.profile)
    const result = resolveAttack([{ bleed, stealth: 0 }], NOBODY_DEFENDS, {
        stealth: exact(0),
        bonus: kit.bonus,
        standingStealth: 0,
    })
    return costOfResult(assessment, result)
}

// The chance that the acting side raises its stealth above the intercept of the blocker: the attempt fails
function flipChance(
    assessment: Assessment,
    owner: MethuselahSnapshot,
    actor: MinionProfile,
    margin: number,
): number {
    const kit = attackKitOf(owner, [actor], assessment.densities[owner.oid], assessment.profile)
    return kit.stealth
        .filter(points => points.value + kit.standingStealth > margin)
        .reduce((total, points) => total + points.p, 0)
}

// What the attacks to come cost me when only `unlocked` of my minions are there to stop them: my predator
// still has its other minions to send this turn, any other Methuselah leaves them through the whole lunge
// of my predator that comes next
function exposureOf(
    assessment: Assessment,
    owner: MethuselahSnapshot,
    actor: MinionProfile,
    unlocked: MinionProfile[],
): number {
    const { table, densities, profile, held } = assessment
    const { me } = table
    if (owner.isPredator) {
        const attackers = attackersOf(owner, 'now').filter(
            minion => minion.oid != actor.oid && !(held[owner.oid] ?? []).includes(minion.oid),
        )
        if (attackers.length == 0) {
            return 0
        }
        return costOfResult(
            assessment,
            resolveAttack(
                toAttackers(attackers),
                defenceOf(table, me, 'bleed', densities[me.oid], unlocked),
                attackKitOf(owner, attackers, densities[owner.oid], profile),
            ),
        )
    }
    return costOfLunge(assessment, outcomeOfTurn(assessment, { actors: [], reserved: unlocked }))
        .total
}

// What it costs me that the blocker is locked
export function lockCostOf(
    assessment: Assessment,
    owner: MethuselahSnapshot,
    actor: MinionProfile,
    blocker: MinionProfile,
): number {
    const now = unlockedMinions(assessment.table.me)
    const kept = now.filter(minion => minion.oid != blocker.oid)
    return Math.max(
        0,
        exposureOf(assessment, owner, actor, kept) - exposureOf(assessment, owner, actor, now),
    )
}

// What it saves me that the minion is unlocked by the card, which is then gone from my hand ( it could not wake
// the minion later ): a locked one is no defender
export function unlockGainOf(
    assessment: Assessment,
    owner: MethuselahSnapshot,
    actor: MinionProfile,
    minion: MinionProfile,
    played: LibraryCard,
): number {
    const { table } = assessment
    const spent: Assessment = {
        ...assessment,
        table: {
            ...table,
            me: { ...table.me, hand: table.me.hand.filter(held => held.card != played) },
        },
    }
    const now = unlockedMinions(table.me)
    const all = now.some(candidate => candidate.oid == minion.oid) ? now : [...now, minion]
    return Math.max(0, exposureOf(spent, owner, actor, now) - exposureOf(spent, owner, actor, all))
}

/**
 * What an action of another Methuselah is to me: who acts, what it costs me when nobody stops it, the
 * strength the block meets. Everything a block, a bounce or an intercept card is weighed against.
 */
export type BlockContext = {
    assessment: Assessment
    action: ActionState
    owner: MethuselahSnapshot
    actor: MinionProfile
    // The bleed aimed at me, null for any other action
    bleed: number | null
    denial: number
    strengthBonus: number
}

// Null when the action is not another Methuselah's to judge
export function blockContextOf(player: Player, assessment: Assessment): BlockContext | null {
    const action = player.gameState.action
    if (!action) {
        return null
    }
    const { minionAction } = action
    const everybody = [...assessment.table.others, assessment.table.me]
    const actor = everybody
        .flatMap(methuselah => methuselah.minions)
        .find(minion => minion.oid == minionAction.actingMinion.oid)
    const owner = everybody.find(methuselah => methuselah.oid == actor?.controller)
    if (!actor || !owner || owner.isMe) {
        return null
    }
    const bleed =
        isBleed(minionAction) && minionAction.target?.oid == player.oid ? action.bleed : null
    return {
        assessment,
        action,
        owner,
        actor,
        bleed,
        denial: denialOf(assessment, owner, actor, minionAction, bleed),
        strengthBonus: getBlockedStrengthBonus(minionAction),
    }
}

// What the action costs me when it lands as it stands: the cards of the acting side are played already. `reduced` is
// what a card or an ally takes off the bleed
export function landedCost(context: BlockContext, reduced = 0): number {
    const { assessment, bleed } = context
    if (bleed === null) {
        return guardOf(assessment, context.action.minionAction)
    }
    return costOfResult(
        assessment,
        resolveAttack([{ bleed: Math.max(0, bleed - reduced), stealth: 0 }], NOBODY_DEFENDS, {
            stealth: exact(0),
            bonus: exact(0),
            standingStealth: 0,
        }),
    )
}

export type BlockValue = {
    score: number
    parts: { stands: number; denial: number; fight: number; lock: number; cost: number }
}

// What a block by the minion is worth to me at this intercept, once `cost` is paid for the cards that gave
// it: the action it stops, less the fight and the lock. It only counts when it can stand.
export function valueOfBlock(
    context: BlockContext,
    blocker: MinionProfile,
    intercept: number,
    cost = 0,
): BlockValue {
    const { assessment, action, owner, actor, denial, strengthBonus } = context
    const { table, profile } = assessment
    const margin = intercept - action.stealth
    const stands = margin >= 0 ? 1 - flipChance(assessment, owner, actor, margin) : 0
    const fight =
        stands > 0 ?
            netLoss(
                forecastFight(
                    {
                        ...theirFighter(owner, assessment.densities[owner.oid], actor),
                        strengthBonus,
                    },
                    myFighter(table, blocker),
                    profile,
                ),
                'defending',
                profile,
            )
        :   0
    const lock = stands > 0 ? lockCostOf(assessment, owner, actor, blocker) : 0
    return {
        score: stands > 0 ? stands * (denial - fight - lock) - cost : 0,
        parts: { stands, denial, fight, lock, cost },
    }
}

// The block that a minion woken or unlocked by a card then attempts
export function valueOfBlockBy(
    context: BlockContext,
    minion: Minion,
    intercept: number,
    cost: number,
): BlockValue | null {
    const blocker = context.assessment.table.me.minions.find(profile => profile.oid == minion.oid)
    return blocker ? valueOfBlock(context, blocker, intercept, cost) : null
}

// What a card or an ability that gives intercept comes with
export type InterceptSource<T> = { key: string; amount: number; cost: number; option: T }

// What playing a card from the hand costs: the card, its blood and its pool
export function costOfCard(profile: BotProfile, card: LibraryCard, x?: number): number {
    return (
        profile.plan.spentCard +
        resolveCost(card.bloodCost, x) * profile.plan.bloodValue +
        resolveCost(card.poolCost, x) * profile.plan.caution
    )
}

// The sets of sources that give `needed` intercept with none to spare, one play of each card. With nothing
// needed, the empty set.
export function interceptSets<T>(
    sources: InterceptSource<T>[],
    needed: number,
): InterceptSource<T>[][] {
    if (needed <= 0) {
        return [[]]
    }
    const groups = new Map<string, InterceptSource<T>[]>()
    for (const source of sources) {
        groups.set(source.key, [...(groups.get(source.key) ?? []), source])
    }
    const keys = [...groups.keys()]
    const sets: InterceptSource<T>[][] = []
    const walk = (index: number, chosen: InterceptSource<T>[], points: number) => {
        if (points >= needed) {
            if (!chosen.some(source => points - source.amount >= needed)) {
                sets.push(chosen)
            }
            return
        }
        if (index >= keys.length) {
            return
        }
        walk(index + 1, chosen, points)
        for (const source of groups.get(keys[index]) ?? []) {
            walk(index + 1, [...chosen, source], points + source.amount)
        }
    }
    walk(0, [], 0)
    return sets
}

const sumOf = <T>(set: InterceptSource<T>[], pick: (source: InterceptSource<T>) => number) =>
    set.reduce((total, source) => total + pick(source), 0)

// The intercept my cards could still add to a block attempt of this minion, read from the hand and the cards
// in play ( the conditions of a card are checked once the attempt stands, when the referee offers it )
function reachOf(assessment: Assessment, blocker: MinionProfile): InterceptSource<null>[] {
    const { me } = assessment.table
    const { profile } = assessment
    const interceptOf = (effects: Effect[]) =>
        effects.reduce(
            (total, effect) => total + (effect.type == 'intercept' ? effect.amount : 0),
            0,
        )
    const cards = me.hand.flatMap(({ card, summary }): InterceptSource<null>[] => {
        const amount = Math.max(
            0,
            ...summary.plays
                .filter(
                    play =>
                        play.kind == 'reaction' &&
                        waysUsableBy(play.ways, blocker.disciplines).length > 0,
                )
                .map(play => interceptOf(play.effects)),
        )
        return amount > 0 ?
                [
                    {
                        key: card.krcgId ?? card.name,
                        amount,
                        cost: costOfCard(profile, card),
                        option: null,
                    },
                ]
            :   []
    })
    const abilities = me.permanents
        .filter(permanent => permanent.available)
        .flatMap((permanent): InterceptSource<null>[] =>
            permanent.abilities
                .filter(
                    ability =>
                        ability.activate == 'lockForReaction' &&
                        (!ability.minion || profileMatches(blocker, ability.minion)),
                )
                .map(ability => ({
                    key: `${permanent.oid}`,
                    amount: interceptOf(ability.effects),
                    cost: profile.modifier.abilityUse,
                    option: null,
                })),
        )
    return [...cards, ...abilities]
}

// The best way to make this block stand: with what the minion has, else with the intercept cards that reach it
function bestBlockValue(
    context: BlockContext,
    blocker: MinionProfile,
    own: number,
    sources: InterceptSource<null>[],
): BlockValue {
    const values = interceptSets(sources, context.action.stealth - own).map(set =>
        valueOfBlock(
            context,
            blocker,
            own + sumOf(set, source => source.amount),
            sumOf(set, source => source.cost),
        ),
    )
    return values.toSorted((a, b) => b.score - a.score)[0] ?? valueOfBlock(context, blocker, own)
}

export function judgeBlock(decision: DecisionPoint, assessment: Assessment): BlockJudgement | null {
    const blocks = optionsOfType(decision.options, 'block')
    const { player } = decision
    const action = player.gameState.action
    if (blocks.length == 0 || !action) {
        return null
    }
    const { minionAction } = action
    // The rescue of one of my own vampires helps me, and nobody else may block it
    if (
        minionAction.type == MinionActionType.RescueFromTorpor &&
        minionAction.target.controller == player
    ) {
        return { block: null, candidates: [], note: 'a rescue of mine' }
    }
    const context = blockContextOf(player, assessment)
    if (!context) {
        return null
    }

    const { table, profile } = assessment
    const candidates = blocks.flatMap(
        (option): (ExplainCandidate & { option: typeof option })[] => {
            const blocker = table.me.minions.find(minion => minion.oid == option.minion.oid)
            if (!blocker) {
                return []
            }
            const { score, parts } = bestBlockValue(
                context,
                blocker,
                getMinionIntercept(option.minion),
                reachOf(assessment, blocker),
            )
            return [{ option, score, parts }]
        },
    )
    const ranked = candidates.toSorted((a, b) => b.score - a.score)
    const best = ranked[0]
    const worth = best && best.score > profile.block.margin
    return {
        block: worth ? best.option : null,
        candidates: ranked,
        note:
            (worth ? `block with ${best.option.minion.name}` : 'no block is worth it') +
            actingSideRead(context),
    }
}

// The read of the Methuselah that acts, as the trace of a decision shows it
export function actingSideRead(context: BlockContext): string {
    const model = context.assessment.models[context.owner.oid]
    if (!model) {
        return ''
    }
    const { bleedSize, blockRate } = model.risks
    return ` (acting side: bleeds ${bleedSize.toFixed(1)}, blocks ${blockRate.toFixed(2)}, guard x${model.guardFactor.toFixed(2)})`
}
