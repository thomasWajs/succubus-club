import { OUST_POOL_GAIN } from '@/shared/const/model.ts'
import { Assessment, TurnOutcome } from '@/shared/bot/utility/assessment.ts'
import { AttackResult, chanceOfLossAtLeast } from '@/shared/bot/utility/attack.ts'
import { lastingLoss } from '@/shared/bot/utility/bloat.ts'
import { bounceTargetOf } from '@/shared/bot/utility/snapshot.ts'

/**
 * The currency of the plans ( .claude/docs/bot-ai-phase3.md, section 3 "One currency" ): everything a
 * turn does is worth some pool. Pool taken from a Methuselah counts at its stake, my own pool at
 * `caution`, and two terms are not linear: ousting my prey ( a victory point and 6 pool, or the game when
 * it is the last one ) and being ousted ( the rest of the game ).
 */

// What my bleeds on my prey are worth
export type BleedGain = {
    // Pool taken from it, at its stake
    drain: number
    // Pool of the bleeds it bounces: it lands on its own prey, at the stake of that Methuselah
    bounced: number
    // The chance to oust it times what an oust is worth
    oust: number
    total: number
}

// What ousting my prey brings: its pool does not count, the bleeds took it. The victory point, and the
// pool I gain; with only my prey left the oust ends the game, which is worth what losing it costs.
export function valueOfOust(assessment: Assessment): number {
    const { table, profile } = assessment
    const ends = table.others.length == 1
    return profile.vpValue + (ends ? profile.plan.oustedCost : OUST_POOL_GAIN)
}

export function gainOfBleeds(assessment: Assessment, result: AttackResult | null): BleedGain {
    const { table, stakes } = assessment
    const { prey } = table
    if (!result || !prey) {
        return { drain: 0, bounced: 0, oust: 0, total: 0 }
    }
    // What lasts of the pool taken: the prey takes back its income from the blood bank, and a bleed that does
    // not oust it only counts above that
    const taken = lastingLoss(
        result,
        prey.pool,
        assessment.bloat[prey.oid]?.pool ?? 0,
        assessment.profile.bloat.recapture,
    )
    const target = bounceTargetOf(table, prey)
    const drain = taken * (stakes[prey.oid]?.weight ?? assessment.profile.ringPrior.prey)
    const bounced = target ? result.expectedBounced * (stakes[target.oid]?.weight ?? 0) : 0
    const oust = chanceOfLossAtLeast(result, prey.pool) * valueOfOust(assessment)
    return { drain, bounced, oust, total: drain + bounced + oust }
}

// What the lunge of my predator costs me after my turn
export type LungeCost = {
    // The pool I lose that lasts against what I take back from the blood bank, at `caution`
    pool: number
    // The chance of being ousted times what it costs
    ousted: number
    total: number
}

export function costOfLunge(assessment: Assessment, outcome: TurnOutcome): LungeCost {
    const { plan } = assessment.profile
    const pool = outcome.lastingLoss * plan.caution
    const ousted = outcome.chanceOfBeingOusted * plan.oustedCost
    return { pool, ousted, total: pool + ousted }
}
