import { getMinionIntercept } from '@/shared/cardImpl/catalog/attached.ts'
import { getBlockedStrengthBonus, isBleed } from '@/shared/state/minionActions.ts'
import { MinionActionType } from '@/shared/types/state.ts'
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
import { MinionProfile } from '@/shared/bot/utility/minionProfile.ts'
import { MethuselahSnapshot, unlockedMinions } from '@/shared/bot/utility/snapshot.ts'

/**
 * The block of an action of another Methuselah, as a utility: what the block saves me, less the fight
 * it runs my blocker into and what the lock of the blocker costs me for the attacks to come. A block
 * is worth attempting when that is above the margin of the profile. The attempt only counts when it
 * can stand: the stealth cards of the acting side are believed from its hand, and flip it with the
 * chance they give.
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

// What the action costs me when nobody blocks it: the bleed aimed at me, the cards of the acting side
// that raise it counted. The other actions are only worth the guard against them.
function denialOf(
    assessment: Assessment,
    owner: MethuselahSnapshot,
    actor: MinionProfile,
    bleed: number | null,
): number {
    if (bleed === null) {
        return assessment.profile.plan.guard
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

// What it costs me that the blocker is locked: my predator still has its other minions to send this turn,
// any other Methuselah leaves it locked through the whole lunge of my predator that comes next
function lockCostOf(
    assessment: Assessment,
    owner: MethuselahSnapshot,
    actor: MinionProfile,
    blocker: MinionProfile,
): number {
    const { table, densities, profile, held } = assessment
    const { me } = table
    const now = unlockedMinions(me)
    const kept = now.filter(minion => minion.oid != blocker.oid)
    if (owner.isPredator) {
        const attackers = attackersOf(owner, 'now').filter(
            minion => minion.oid != actor.oid && !(held[owner.oid] ?? []).includes(minion.oid),
        )
        if (attackers.length == 0) {
            return 0
        }
        const attack = (unlocked: MinionProfile[]) =>
            costOfResult(
                assessment,
                resolveAttack(
                    toAttackers(attackers),
                    defenceOf(table, me, 'bleed', densities[me.oid], unlocked),
                    attackKitOf(owner, attackers, densities[owner.oid], profile),
                ),
            )
        return Math.max(0, attack(kept) - attack(now))
    }
    const lunge = (reserved: MinionProfile[]) =>
        costOfLunge(assessment, outcomeOfTurn(assessment, { actors: [], reserved })).total
    return Math.max(0, lunge(kept) - lunge(now))
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

    const { table, profile } = assessment
    const everybody = [...table.others, table.me]
    const actor = everybody
        .flatMap(methuselah => methuselah.minions)
        .find(minion => minion.oid == minionAction.actingMinion.oid)
    const owner = everybody.find(methuselah => methuselah.oid == actor?.controller)
    if (!actor || !owner || owner.isMe) {
        return null
    }
    const bleed =
        isBleed(minionAction) && minionAction.target?.oid == player.oid ? action.bleed : null
    const denial = denialOf(assessment, owner, actor, bleed)
    const strengthBonus = getBlockedStrengthBonus(minionAction)

    const candidates = blocks.flatMap(
        (option): (ExplainCandidate & { option: typeof option })[] => {
            const blocker = table.me.minions.find(minion => minion.oid == option.minion.oid)
            if (!blocker) {
                return []
            }
            const margin = getMinionIntercept(option.minion) - action.stealth
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
            return [
                {
                    option,
                    score: stands * (denial - fight - lock),
                    parts: { stands, denial, fight, lock },
                },
            ]
        },
    )
    const ranked = candidates.toSorted((a, b) => b.score - a.score)
    const best = ranked[0]
    const worth = best && best.score > profile.block.margin
    return {
        block: worth ? best.option : null,
        candidates: ranked,
        note: worth ? `block with ${best.option.minion.name}` : 'no block is worth it',
    }
}
