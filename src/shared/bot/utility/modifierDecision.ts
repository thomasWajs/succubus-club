import { getCardDef } from '@/shared/cardImpl/catalog/index.ts'
import { findPlay } from '@/shared/cardImpl/catalog/requirements.ts'
import { CardOid } from '@/shared/types/model.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { getBlockingMinion, getReactingPlayers } from '@/shared/state/actionState.ts'
import { resolveCost } from '@/shared/state/cardCosts.ts'
import { getBlockedStrengthBonus, isBleed } from '@/shared/state/minionActions.ts'
import { ActionState, MinionAction, NO_BLOCK } from '@/shared/types/state.ts'
import { BotOption, BotOptionOf, DecisionPoint } from '@/shared/bot/types.ts'
import { Assessment } from '@/shared/bot/utility/assessment.ts'
import { AttackKit, DefenceSide, exact, resolveAttack } from '@/shared/bot/utility/attack.ts'
import {
    forecastFight,
    myFighter,
    netLoss,
    theirFighter,
} from '@/shared/bot/utility/combatPosition.ts'
import { attackKitOf, defenceOf, interceptReserve } from '@/shared/bot/utility/defence.ts'
import { gainOfBleeds } from '@/shared/bot/utility/equity.ts'
import { ExplainCandidate } from '@/shared/bot/utility/explain.ts'
import { HandEvaluator } from '@/shared/bot/utility/hand.ts'
import { MinionProfile } from '@/shared/bot/utility/minionProfile.ts'
import { PlayValues } from '@/shared/bot/utility/cardActions.ts'
import { candidateOf, idleOf } from '@/shared/bot/utility/turnPlan.ts'

/**
 * The cards and the abilities that raise the stealth or the bleed of one of my actions, while it is in
 * progress. Stealth is only worth playing when a block attempt stands that the cards flip: the cheapest
 * set that does is weighed against the fight the block runs my minion into, and the action it lets
 * through. The other side may raise its intercept back ( a card in play, an intercept card in a hand a
 * blocker may play from ): the race goes on with the cards left, and what a lost one costs is counted.
 * A bleed bonus is played once my prey has declined to block, for what it adds to the bleed,
 * the chance that my prey bounces it counted.
 */

export type ModifierJudgement = {
    // What to play, or the pass of the impulse when nothing is worth it
    option: BotOption
    candidates: ExplainCandidate[]
    note: string
}

type Source = {
    option: BotOptionOf<'playModifier'> | BotOptionOf<'lockForAction'>
    // A card is played once by a minion in an action
    key: string
    stealth: number
    bleed: number
    // The stealth comes from a card in play, not from the hand
    inPlay: boolean
    cost: number
}

type Context = {
    assessment: Assessment
    action: ActionState
    actor: MinionProfile
    pass: BotOption
    sources: Source[]
}

function sourcesOf(
    decision: DecisionPoint,
    assessment: Assessment,
    hand?: HandEvaluator,
): Source[] {
    const { table, profile } = assessment
    return decision.options.flatMap((option): Source[] => {
        if (option.type == 'playModifier') {
            const { card, usage, by } = option.modifier
            const def = getCardDef(card)
            const effects = (def && findPlay(def, 'modifier', usage)?.effects) ?? []
            // A card the hand has too many of costs less: the draw that takes its place is worth more than it
            const cost =
                profile.plan.spentCard -
                (hand ? hand.flowOf(card) : 0) +
                resolveCost(card.bloodCost, usage.x) * profile.plan.bloodValue +
                resolveCost(card.poolCost, usage.x) * profile.plan.caution
            return [
                {
                    option,
                    key: `${card.krcgId}:${by?.oid ?? ''}`,
                    stealth: effects.reduce(
                        (total, effect) => total + (effect.type == 'stealth' ? effect.amount : 0),
                        0,
                    ),
                    bleed: effects.reduce(
                        (total, effect) =>
                            total +
                            (effect.type == 'bleed' ?
                                effect.amount == 'X' ?
                                    (usage.x ?? 0)
                                :   effect.amount
                            :   0),
                        0,
                    ),
                    inPlay: false,
                    cost,
                },
            ]
        }
        if (option.type == 'lockForAction') {
            const ability = table.me.permanents
                .find(permanent => permanent.oid == option.card.oid)
                ?.abilities.find(candidate => candidate.activate == 'lockForAction')
            return [
                {
                    option,
                    key: `${option.card.oid}`,
                    stealth: (ability?.effects ?? []).reduce(
                        (total, effect) => total + (effect.type == 'stealth' ? effect.amount : 0),
                        0,
                    ),
                    bleed: 0,
                    inPlay: true,
                    cost: profile.modifier.abilityUse,
                },
            ]
        }
        return []
    })
}

// What stands between the action and its end: the defence of the Methuselahs that may react to it. With
// two of them ( an undirected action ) only their minions count, a bounce or a wake card is not weighed
function defenceAgainst(assessment: Assessment, minionAction: MinionAction): DefenceSide {
    const { table, densities } = assessment
    const kind = isBleed(minionAction) ? 'bleed' : 'general'
    const sides = getReactingPlayers(minionAction).flatMap(player => {
        const snapshot = table.others.find(other => other.oid == player.oid)
        return snapshot ? [defenceOf(table, snapshot, kind, densities[snapshot.oid])] : []
    })
    if (sides.length == 1) {
        return sides[0]
    }
    return {
        reactors: sides.flatMap(side => side.reactors),
        wakers: sides.flatMap(side => side.wakers).toSorted((a, b) => b - a),
        wakeCards: exact(0),
        bounceCards: exact(0),
        bouncers: 0,
        standingIntercept: Math.max(0, ...sides.map(side => side.standingIntercept)),
    }
}

// Every set of sources that raises the stealth to `needed` with no source to spare, one play of each card
function flippingSets(sources: Source[], needed: number): Source[][] {
    const groups = new Map<string, Source[]>()
    for (const source of sources) {
        groups.set(source.key, [...(groups.get(source.key) ?? []), source])
    }
    const keys = [...groups.keys()]
    const sets: Source[][] = []
    const walk = (index: number, chosen: Source[], points: number) => {
        if (points >= needed) {
            const spare = chosen.some(source => points - source.stealth >= needed)
            if (!spare) {
                sets.push(chosen)
            }
            return
        }
        if (index >= keys.length) {
            return
        }
        walk(index + 1, chosen, points)
        for (const source of groups.get(keys[index]) ?? []) {
            walk(index + 1, [...chosen, source], points + source.stealth)
        }
    }
    walk(0, [], 0)
    return sets
}

const sum = (sources: Source[], pick: (source: Source) => number) =>
    sources.reduce((total, source) => total + pick(source), 0)

function passed(context: Context, note: string, candidates: ExplainCandidate[] = []) {
    return { option: context.pass, candidates, note }
}

// A block attempt stands that the action would lose: play the stealth that flips it when that is worth
// more than the fight it avoids is worth to the other side
function playStealth(context: Context, blocker: CardOid): ModifierJudgement {
    const { assessment, action, actor, sources } = context
    const { table, profile, densities } = assessment
    const { minionAction } = action
    const needed = action.intercept - action.stealth + 1
    const stealthSources = sources.filter(source => source.stealth > 0)
    const sets = flippingSets(stealthSources, needed)
    const owner = table.others.find(other => other.minions.some(minion => minion.oid == blocker))
    const blocking = owner?.minions.find(minion => minion.oid == blocker)
    if (needed <= 0 || sets.length == 0 || !owner || !blocking) {
        return passed(context, 'no stealth that flips the block')
    }

    // What the block costs me when it stands: the action is lost and the minions fight
    const fight = netLoss(
        forecastFight(
            { ...myFighter(table, actor), strengthBonus: getBlockedStrengthBonus(minionAction) },
            theirFighter(owner, densities[owner.oid], blocking),
            profile,
        ),
        'acting',
        profile,
    )
    const onPrey = isBleed(minionAction) && minionAction.target?.oid == table.prey?.oid
    const worth =
        onPrey ? 0 : (
            (idleOf(
                assessment,
                actor,
                [candidateOf({ type: 'declareAction', action: minionAction })],
                new PlayValues(assessment),
            )?.unblocked ?? 0)
        )
    const kit = attackKitOf(table.me, [actor], densities[table.me.oid], profile)
    // The standing intercept of the cards in play is part of the reserve, not of this defence
    const defence = { ...defenceAgainst(assessment, minionAction), standingIntercept: 0 }
    const reserve = interceptReserve(owner, blocking, densities[owner.oid], profile)

    // What the action is worth once the stealth of `played` beats the block, the others still to get past
    const rewardOf = (played: Source[]) => {
        const cards = sum(played, source => (source.inPlay ? 0 : source.stealth))
        const left: AttackKit = {
            stealth: exact(Math.max(0, (kit.stealth[0]?.value ?? 0) - cards)),
            bonus: exact(0),
            standingStealth: Math.max(
                0,
                kit.standingStealth - sum(played, source => (source.inPlay ? source.stealth : 0)),
            ),
        }
        const result = resolveAttack(
            [
                {
                    bleed: onPrey ? action.bleed + sum(played, source => source.bleed) : 0,
                    stealth: action.stealth + sum(played, source => source.stealth),
                },
            ],
            defence,
            left,
        )
        const success =
            onPrey ? gainOfBleeds(assessment, result).total : (1 - result.blockedShare) * worth
        return { success, avoided: fight * (1 - result.blockedShare), blocked: result.blockedShare }
    }

    const candidates = sets.map(set => {
        const cost = sum(set, source => source.cost)
        const spare = sum(set, source => source.stealth) - needed
        const now = rewardOf(set)
        const unused = stealthSources.filter(source => !set.some(used => used.key == source.key))
        // The other side may raise its intercept to match the stealth: it can with `extra` points to spare
        // over what the set leaves. Then the race goes on with the cards that are left, as long as it pays;
        // what the set cost is spent for good.
        let score = -cost
        let reblocked = 0
        for (const { value: extra, p } of reserve) {
            if (extra <= spare) {
                score += p * (now.success + now.avoided)
                continue
            }
            reblocked += p
            const follow = flippingSets(unused, extra - spare).map(more => {
                const result = rewardOf([...set, ...more])
                return result.success + result.avoided - sum(more, source => source.cost)
            })
            score += p * Math.max(0, ...follow)
        }
        const first = set.toSorted((a, b) => a.cost - b.cost)[0]
        return {
            option: first.option,
            score,
            parts: {
                success: now.success,
                fight: now.avoided,
                cost,
                blocked: now.blocked,
                reblocked,
            },
        }
    })
    const ranked = candidates.toSorted((a, b) => b.score - a.score)
    const best = ranked[0]
    if (best.score > profile.modifier.margin) {
        return { option: best.option, candidates: ranked, note: 'stealth flips the block' }
    }
    return passed(context, 'the stealth is not worth it', ranked)
}

// My prey has declined to block: the bleed bonuses that add more than they cost
function playBonus(context: Context): ModifierJudgement {
    const { assessment, action, sources } = context
    const { table, profile, densities } = assessment
    const { prey } = table
    const { minionAction } = action
    const bonuses = sources.filter(source => source.bleed > 0 && source.stealth == 0)
    if (
        bonuses.length == 0 ||
        !prey ||
        !isBleed(minionAction) ||
        minionAction.target?.oid != prey.oid
    ) {
        return passed(context, 'no bleed bonus to play')
    }
    const declined = action.blockingDecisions.some(
        decision => decision.player.oid == prey.oid && decision.block === NO_BLOCK,
    )
    if (!declined) {
        return passed(context, 'the bonus waits for the block window')
    }

    // The block is final: only a bounce can still take the bleed away
    const defence: DefenceSide = {
        ...defenceOf(table, prey, 'bleed', densities[prey.oid], []),
        wakers: [],
        wakeCards: exact(0),
        standingIntercept: 0,
    }
    const gainAt = (bleed: number) =>
        gainOfBleeds(
            assessment,
            resolveAttack([{ bleed, stealth: 0 }], defence, {
                stealth: exact(0),
                bonus: exact(0),
                standingStealth: 0,
            }),
        ).total
    const base = gainAt(action.bleed)
    const ranked = bonuses
        .map(source => {
            const gain = gainAt(action.bleed + source.bleed) - base
            return {
                option: source.option,
                score: gain - source.cost,
                parts: { gain, cost: source.cost },
            }
        })
        .toSorted((a, b) => b.score - a.score)
    const best = ranked[0]
    if (best.score > profile.modifier.margin) {
        return { option: best.option, candidates: ranked, note: 'a bleed bonus is worth it' }
    }
    return passed(context, 'no bleed bonus is worth it', ranked)
}

/**
 * The impulse of the acting player, in the action of one of its minions: play a modifier or pass.
 * Null when the action is not mine to judge.
 */
export function judgeModifier(
    decision: DecisionPoint,
    assessment: Assessment,
    deck?: DeckList,
): ModifierJudgement | null {
    const { gameState } = decision.player
    const { action } = gameState
    const pass = decision.options.find(option => option.type == 'noModifier')
    const actor = assessment.table.me.minions.find(
        minion => minion.oid == action?.minionAction.actingMinion.oid,
    )
    if (!action || !pass || !actor) {
        return null
    }
    const context: Context = {
        assessment,
        action,
        actor,
        pass,
        sources: sourcesOf(
            decision,
            assessment,
            deck && decision.options.some(option => option.type == 'playModifier') ?
                new HandEvaluator(assessment, deck, decision.player)
            :   undefined,
        ),
    }
    if (context.sources.length == 0) {
        return passed(context, 'nothing to play')
    }
    const blocking = getBlockingMinion(gameState)
    return blocking ? playStealth(context, blocking.oid) : playBonus(context)
}
