import { Card, Minion } from '@/shared/model/Card.ts'
import { MinionActionType } from '@/shared/types/state.ts'
import { Assessment } from '@/shared/bot/utility/assessment.ts'
import { Candidate } from '@/shared/bot/utility/turnPlan.ts'
import {
    forecastFight,
    myFighter,
    netLoss,
    theirFighter,
} from '@/shared/bot/utility/combatPosition.ts'
import { profileMinion } from '@/shared/bot/utility/minionProfile.ts'
import { summarizeCard } from '@/shared/bot/utility/summaries.ts'

/**
 * The gate before an action that starts a combat ( step 3.4d of .claude/docs/bot-ai-phase3.md ): a minion
 * that enters combat with a minion of another Methuselah, or plays a card that makes it do so. The fight
 * is forecast with my hand and my blood as they are now ( combatPosition.ts ), and the action is made only
 * if what it is expected to take from the other side, less what it is expected to cost mine, is worth
 * `combat.enterMargin`: a minion that would walk in without the kit does something else this turn, and
 * tries again when it holds one.
 */

export type CombatStart = { target: Minion; targetActs: boolean }

// The combat an action starts, none when it does not start one
export function combatStartOf(candidate: Candidate): CombatStart | null {
    const { action } = candidate.option
    if (action.type == MinionActionType.EnterCombat) {
        return { target: action.target, targetActs: false }
    }
    if (action.type != MinionActionType.ActionCardFromHand) {
        return null
    }
    const { target } = action.usage
    if (!(target instanceof Card) || !target.isMinion()) {
        return null
    }
    const effects = summarizeCard(action.card)?.plays.flatMap(play => play.effects) ?? []
    const enter = effects.find(effect => effect.type == 'enterCombat')
    return enter ? { target, targetActs: enter.targetActs } : null
}

// What the combat is expected to bring me, in pool: what it costs the other side, less what it costs mine
export function combatStartGain(
    assessment: Assessment,
    candidate: Candidate,
    start: CombatStart,
): number {
    const { table, profile, densities } = assessment
    const actor = table.me.minions.find(minion => minion.oid == candidate.actor)
    const owner = table.others.find(other => other.oid == start.target.controller.oid)
    if (!actor || !owner) {
        return 0
    }
    const mine = myFighter(table, actor)
    const theirs = theirFighter(owner, densities[owner.oid], profileMinion(start.target))
    const forecast =
        start.targetActs ?
            forecastFight(theirs, mine, profile)
        :   forecastFight(mine, theirs, profile)
    return -netLoss(forecast, start.targetActs ? 'defending' : 'acting', profile)
}

// Is the action, if it starts a combat, one that the position allows
export function combatStartAllowed(assessment: Assessment, candidate: Candidate): boolean {
    const start = combatStartOf(candidate)
    return (
        !start ||
        combatStartGain(assessment, candidate, start) >= assessment.profile.combat.enterMargin
    )
}
