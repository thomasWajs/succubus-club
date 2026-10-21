import { ReactionCardEffect } from '@/shared/cardImpl/base.ts'
import { getMinionIntercept } from '@/shared/cardImpl/catalog/attached.ts'
import { LibraryCard, Minion } from '@/shared/model/Card.ts'
import { getBlockingMinion } from '@/shared/state/actionState.ts'
import { getHost } from '@/shared/state/attachments.ts'
import { getCardTriggers } from '@/shared/state/triggers.ts'
import { Trigger } from '@/shared/cardImpl/catalog/types.ts'
import { MinionActionType } from '@/shared/types/state.ts'
import {
    BotOption,
    BotOptionOf,
    DecisionKind,
    DecisionPoint,
    optionsOfType,
} from '@/shared/bot/types.ts'
import { Assessment } from '@/shared/bot/utility/assessment.ts'
import { exact, resolveAttack } from '@/shared/bot/utility/attack.ts'
import { lastingLoss, takenBack } from '@/shared/bot/utility/bloat.ts'
import {
    BlockContext,
    blockContextOf,
    costOfCard,
    actingSideRead,
    InterceptSource,
    interceptSets,
    judgeBlock,
    landedCost,
    lockCostOf,
    unlockGainOf,
    valueOfBlock,
    valueOfBlockBy,
} from '@/shared/bot/utility/blockDecision.ts'
import { defenceOf } from '@/shared/bot/utility/defence.ts'
import { ExplainCandidate } from '@/shared/bot/utility/explain.ts'
import { MethuselahSnapshot, bounceTargetOf, canBounce } from '@/shared/bot/utility/snapshot.ts'
import { waysUsableBy } from '@/shared/bot/utility/summaries.ts'

/**
 * What I do with the cards and the cards in play that react to an action of another Methuselah, and with
 * the triggers of my minions. Everything is weighed in the currency of the block: the action that a play
 * stops or sends elsewhere, less the fight, the lock and what the play costs.
 *  - The block window: a block attempt, a card that wakes or unlocks a minion so that it can block, or a
 *    "no block" that leaves a bounce card for the next window, whichever is worth most.
 *  - A block attempt of mine stands but fails: the intercept that flips it, the cheapest that does.
 *  - The blocks are declined and the bleed is aimed at me: a bounce, to the Methuselah it hurts the most.
 *  - The block is over: the card that unlocks my blocker, for what an unlocked minion defends.
 *  - A trigger of a minion: used when the unlock is worth its blood.
 */

export type ReactionJudgement = {
    // What to play, or the pass of the window
    option: BotOption
    candidates: ExplainCandidate[]
    note: string
}

type Candidate = ExplainCandidate & { option: BotOption }

const byScore = (a: ExplainCandidate, b: ExplainCandidate) => b.score - a.score

function pass(decision: DecisionPoint, note: string, candidates: ExplainCandidate[] = []) {
    const option =
        decision.options.find(candidate => candidate.type == 'noReaction') ??
        decision.options.find(candidate => candidate.type == 'noBlock')
    return option ? { option, candidates, note } : null
}

// What burning the ally costs me: the worth it has in play, in pool, and the card
function burnCostOf(assessment: Assessment, option: BotOptionOf<'burnAlly'>): number {
    const { table, profile } = assessment
    const ally = table.me.minions.find(minion => minion.oid == option.card.oid)
    return profile.plan.spentCard + (ally?.worth ?? 0) * profile.plan.caution
}

// What it costs me that a woken ally stays locked at my next unlock phase: it is no blocker of the attacks to come.
// A vampire, or a card with no such clause, costs nothing
function missedUnlockCost(
    context: BlockContext,
    effect: ReactionCardEffect,
    minion: Minion,
    card: LibraryCard,
): number {
    if (effect.type != 'wake' || !effect.allyMissesUnlock || minion.isVampire()) {
        return 0
    }
    const ally = context.assessment.table.me.minions.find(profile => profile.oid == minion.oid)
    return ally ? unlockGainOf(context.assessment, context.owner, context.actor, ally, card) : 0
}

// The pool a bleed of this size takes from the Methuselah, at the weight it has for me
function bounceGain(context: BlockContext, target: MethuselahSnapshot, bleed: number): number {
    const { assessment, action } = context
    const { table, densities, profile, bloat, stakes } = assessment
    const result = resolveAttack(
        [{ bleed, stealth: action.stealth }],
        defenceOf(table, target, 'bleed', densities[target.oid]),
        { stealth: exact(0), bonus: exact(0), standingStealth: 0 },
    )
    const taken = lastingLoss(
        result,
        target.pool,
        takenBack(bloat[target.oid]),
        profile.bloat.recapture,
    )
    return taken * (stakes[target.oid]?.weight ?? profile.ringPrior.other)
}

// A bounce card is held and a minion that is unlocked can play it: what it would be worth to bounce
// the bleed that is aimed at me, before the block window is closed ( the next window has the cards )
function bounceEstimate(context: BlockContext, noBlock: BotOption): Candidate | null {
    const { assessment, bleed } = context
    const { table, profile } = assessment
    const target = bounceTargetOf(table, table.me)
    if (bleed === null || !canBounce(table) || !target) {
        return null
    }
    const plays = table.me.hand.flatMap(({ card, summary }) =>
        summary.plays
            .filter(play => play.kind == 'reaction' && play.roles.includes('bounce'))
            .map(play => ({ card, play })),
    )
    const bouncers = table.me.minions.filter(
        minion =>
            minion.state == 'unlocked' &&
            minion.isVampire &&
            plays.some(({ play }) => waysUsableBy(play.ways, minion.disciplines).length > 0),
    )
    if (bouncers.length == 0) {
        return null
    }
    const cost = Math.min(...plays.map(({ card }) => costOfCard(profile, card)))
    const lock = Math.min(
        ...bouncers.map(minion => lockCostOf(assessment, context.owner, context.actor, minion)),
    )
    const gain = bounceGain(context, target, bleed)
    return {
        option: noBlock,
        score: context.denial + gain - lock - cost,
        parts: { denial: context.denial, gain, lock, cost },
    }
}

// The block window: the blocks, the cards that make a minion able to block, and a bounce that waits
function judgeWindow(
    decision: DecisionPoint,
    context: BlockContext,
    noBlock: BotOption,
): ReactionJudgement {
    const { assessment } = context
    const { profile } = assessment
    const blocks = judgeBlock(decision, assessment)
    const candidates: Candidate[] = (blocks?.candidates ?? []).map(candidate => ({
        ...candidate,
        option: candidate.option,
    }))
    for (const option of optionsOfType(decision.options, 'playReaction')) {
        const { effect, minion, card, usage } = option
        const cost = costOfCard(profile, card, usage.x)
        const value =
            (effect.type == 'wake' || effect.type == 'unlock') && minion.isLocked ?
                valueOfBlockBy(
                    context,
                    minion,
                    getMinionIntercept(minion),
                    cost + missedUnlockCost(context, effect, minion, card),
                )
            : effect.type == 'unlockBlock' ?
                valueOfBlockBy(
                    context,
                    effect.target,
                    getMinionIntercept(effect.target) + effect.intercept,
                    cost,
                )
            :   null
        if (value) {
            candidates.push({ option, score: value.score, parts: value.parts })
        }
    }
    for (const option of optionsOfType(decision.options, 'burnAlly')) {
        const { effect, minion } = option
        if (effect.type == 'unlockMinion' && minion) {
            const value = valueOfBlockBy(
                context,
                minion,
                getMinionIntercept(minion),
                burnCostOf(assessment, option),
            )
            if (value) {
                candidates.push({ option, score: value.score, parts: value.parts })
            }
        }
    }
    const bounce = bounceEstimate(context, noBlock)
    if (bounce) {
        candidates.push(bounce)
    }
    const ranked = candidates.toSorted(byScore)
    const best = ranked[0]
    const read = actingSideRead(context)
    if (!best || best.score <= profile.block.margin) {
        return { option: noBlock, candidates: ranked, note: `no block is worth it${read}` }
    }
    const notes: Partial<Record<BotOption['type'], string>> = {
        block: `block with ${best.option.type == 'block' ? best.option.minion.name : ''}`,
        playReaction: 'a card lets a minion block',
        burnAlly: 'an ally is burned to let a minion block',
        noBlock: 'a bounce card is worth more than a block',
    }
    return {
        option: best.option,
        candidates: ranked,
        note: (notes[best.option.type] ?? '') + read,
    }
}

// A block attempt of mine stands and fails: the cheapest intercept that flips it, when it is worth its cost
function judgeFlip(decision: DecisionPoint, context: BlockContext): ReactionJudgement | null {
    const { assessment, action } = context
    const { table, profile } = assessment
    const blocking = getBlockingMinion(decision.player.gameState)
    const blocker = table.me.minions.find(minion => minion.oid == blocking?.oid)
    if (!blocker) {
        return null
    }
    const sources = decision.options.flatMap((option): InterceptSource<BotOption>[] => {
        if (option.type == 'playReaction' && option.effect.type == 'intercept') {
            return [
                {
                    key: option.card.krcgId ?? option.card.name,
                    amount: option.effect.amount,
                    cost: costOfCard(profile, option.card, option.usage.x),
                    option,
                },
            ]
        }
        if (option.type == 'lockForReaction') {
            const amount = table.me.permanents
                .find(permanent => permanent.oid == option.card.oid)
                ?.abilities.filter(ability => ability.activate == 'lockForReaction')
                .flatMap(ability => ability.effects)
                .reduce(
                    (total, effect) => total + (effect.type == 'intercept' ? effect.amount : 0),
                    0,
                )
            return [
                {
                    key: `${option.card.oid}`,
                    amount: amount ?? 0,
                    cost: profile.modifier.abilityUse,
                    option,
                },
            ]
        }
        return []
    })
    const sets = interceptSets(
        sources.filter(source => source.amount > 0),
        action.stealth - action.intercept,
    ).filter(set => set.length > 0)
    const candidates: Candidate[] = sets.map(set => {
        const cost = set.reduce((total, source) => total + source.cost, 0)
        const amount = set.reduce((total, source) => total + source.amount, 0)
        const value = valueOfBlock(context, blocker, action.intercept + amount, cost)
        const first = set.toSorted((a, b) => a.cost - b.cost)[0]
        return { option: first.option, score: value.score, parts: value.parts }
    })
    const ranked = candidates.toSorted(byScore)
    const best = ranked[0]
    if (best && best.score > profile.reaction.margin) {
        return { option: best.option, candidates: ranked, note: 'intercept flips the block' }
    }
    return pass(decision, 'the intercept is not worth it', ranked)
}

// The blocks are declined and the bleed is aimed at me: bounce it, or let it land
function judgeBounce(decision: DecisionPoint, context: BlockContext): ReactionJudgement | null {
    const { assessment, bleed } = context
    const { table, profile } = assessment
    const bounces = optionsOfType(decision.options, 'playReaction').flatMap(
        (option): BotOptionOf<'playReaction'>[] =>
            option.effect.type == 'changeTarget' ? [option] : [],
    )
    const cuts = optionsOfType(decision.options, 'burnAlly').flatMap(
        (option): BotOptionOf<'burnAlly'>[] =>
            option.effect.type == 'reduceBleed' ? [option] : [],
    )
    const cutCards = optionsOfType(decision.options, 'playReaction').flatMap(
        (option): BotOptionOf<'playReaction'>[] =>
            option.effect.type == 'reduceBleed' ? [option] : [],
    )
    if (bleed === null || bounces.length + cuts.length + cutCards.length == 0) {
        return null
    }
    const landed = landedCost(context)
    const cut = cuts.map((option): Candidate => {
        const amount = option.effect.type == 'reduceBleed' ? option.effect.amount : 0
        const gain = landed - landedCost(context, amount)
        const cost = burnCostOf(assessment, option)
        return { option, score: gain - cost, parts: { landed, gain, cost } }
    })
    const cutByCard = cutCards.map((option): Candidate => {
        const amount = option.effect.type == 'reduceBleed' ? option.effect.amount : 0
        const gain = landed - landedCost(context, amount)
        const cost = costOfCard(profile, option.card, option.usage.x)
        return { option, score: gain - cost, parts: { landed, gain, cost } }
    })
    const candidates: Candidate[] = bounces.flatMap(option => {
        const { effect, minion, card, usage } = option
        if (effect.type != 'changeTarget') {
            return []
        }
        const target = table.others.find(other => other.oid == effect.target.oid)
        const profileOf = table.me.minions.find(candidate => candidate.oid == minion.oid)
        if (!target || !profileOf) {
            return []
        }
        const gain = bounceGain(context, target, bleed)
        const lock =
            effect.lockMinion && profileOf.state == 'unlocked' ?
                lockCostOf(assessment, context.owner, context.actor, profileOf)
            :   0
        const cost = costOfCard(profile, card, usage.x)
        return [{ option, score: landed + gain - lock - cost, parts: { landed, gain, lock, cost } }]
    })
    const ranked = [...candidates, ...cut, ...cutByCard].toSorted(byScore)
    const best = ranked[0]
    if (best && best.score > profile.reaction.margin) {
        return {
            option: best.option,
            candidates: ranked,
            note:
                best.option.type == 'burnAlly' ? 'an ally is burned to cut the bleed'
                : best.option.type == 'playReaction' && best.option.effect.type == 'reduceBleed' ?
                    'a card cuts the bleed'
                :   'the bleed is bounced',
        }
    }
    return pass(decision, 'a bounce is not worth it', ranked)
}

// The block is over, my blocker is locked: unlock it when it defends for more than the card costs
function judgePostBlock(decision: DecisionPoint, context: BlockContext): ReactionJudgement | null {
    const { assessment } = context
    const { table, profile } = assessment
    const candidates: Candidate[] = optionsOfType(decision.options, 'playReaction').flatMap(
        option => {
            const minion = table.me.minions.find(candidate => candidate.oid == option.minion.oid)
            if (option.effect.type != 'unlock' || !minion) {
                return []
            }
            const gain = unlockGainOf(assessment, context.owner, context.actor, minion, option.card)
            const cost = costOfCard(profile, option.card, option.usage.x)
            return [{ option, score: gain - cost, parts: { gain, cost } }]
        },
    )
    const ranked = candidates.toSorted(byScore)
    const best = ranked[0]
    if (best && best.score > profile.reaction.margin) {
        return { option: best.option, candidates: ranked, note: 'the blocker is unlocked' }
    }
    return pass(decision, 'no unlock is worth it', ranked)
}

/**
 * The window of the Methuselah that reacts to an action of another one, or the window after its block.
 * Null when it is not mine to judge ( the window is passed ).
 */
export function judgeReaction(
    decision: DecisionPoint,
    assessment: Assessment,
): ReactionJudgement | null {
    if (decision.kind != DecisionKind.ReactionImpulse && decision.kind != DecisionKind.PostBlock) {
        return null
    }
    const { player } = decision
    const { action } = player.gameState
    const context = action ? blockContextOf(player, assessment) : null
    if (!action || !context) {
        return null
    }
    if (decision.kind == DecisionKind.PostBlock) {
        return judgePostBlock(decision, context)
    }
    const { minionAction } = action
    if (
        minionAction.type == MinionActionType.RescueFromTorpor &&
        minionAction.target.controller == player
    ) {
        return null
    }
    const blocking = getBlockingMinion(player.gameState)
    if (blocking) {
        return blocking.controller == player ? judgeFlip(decision, context) : null
    }
    const noBlock = decision.options.find(option => option.type == 'noBlock')
    return noBlock ? judgeWindow(decision, context, noBlock) : judgeBounce(decision, context)
}

export type TriggerJudgement = { option: BotOption; candidates: ExplainCandidate[]; note: string }

/**
 * A card in play that locks to react to an action ( blood for the vampire that hunted, an unlock for the
 * minion that acted ): used when the minion gets something out of it, the lock itself is the only cost.
 */
function judgeCardTrigger(
    use: BotOptionOf<'useTrigger'>,
    skip: BotOption,
    trigger: Trigger,
    assessment: Assessment,
): TriggerJudgement | null {
    const { profile, table } = assessment
    const { source, actor } = use.pending
    const host = getHost(source)
    const profileOf = (minion: Minion | undefined) =>
        table.me.minions.find(candidate => candidate.oid == minion?.oid)
    const gain = trigger.effects.reduce((total, effect) => {
        if (effect.type == 'armTrigger') {
            return total + profile.plan.cardAction
        }
        const gaining =
            effect.type == 'gainBlood' ? profileOf(effect.who == 'actor' ? actor : host) : null
        return (
            total +
            (effect.type == 'gainBlood' && gaining ?
                Math.min(effect.amount, Math.max(0, gaining.capacity - gaining.blood)) *
                profile.plan.bloodValue
            :   0)
        )
    }, 0)
    const cost = trigger.cost?.type == 'lockSelf' ? profile.modifier.abilityUse : 0
    const score = gain - cost
    const worth = score > profile.reaction.margin
    return {
        option: worth ? use : skip,
        candidates: [{ option: use, score, parts: { gain, cost } }],
        note: worth ? 'the card is worth its lock' : 'the card is not worth its lock',
    }
}

/**
 * An optional trigger of one of my minions ( it burns blood to unlock after an Anarch's action ): used when
 * the minion has the blood to pay and still act. A minion left with none must hunt first and does not act.
 */
export function judgeTrigger(
    decision: DecisionPoint,
    assessment: Assessment,
): TriggerJudgement | null {
    const use = optionsOfType(decision.options, 'useTrigger')[0]
    const skip = decision.options.find(option => option.type == 'skipTrigger')
    if (!use || !skip) {
        return null
    }
    const { source, index } = use.pending
    const trigger = getCardTriggers(source)[index]
    if (!trigger) {
        return null
    }
    const { plan } = assessment.profile
    if (!source.isMinion()) {
        return judgeCardTrigger(use, skip, trigger, assessment)
    }
    const minion = assessment.table.me.minions.find(candidate => candidate.oid == source.oid)
    if (!minion) {
        return null
    }
    const blood = trigger.cost?.type == 'burnBlood' ? trigger.cost.amount : 0
    const unlocks = trigger.effects.some(effect => effect.type == 'unlock')
    const benefit =
        !unlocks || minion.state == 'torpor' ? 0
        : minion.blood - blood >= 1 ? plan.cardAction
        : plan.guard
    const score = benefit - blood * plan.bloodValue
    const parts = { benefit, cost: blood * plan.bloodValue }
    const worth = score > assessment.profile.reaction.margin
    return {
        option: worth ? use : skip,
        candidates: [{ option: use, score, parts }],
        note: worth ? 'the unlock is worth its blood' : 'the unlock is not worth its blood',
    }
}
