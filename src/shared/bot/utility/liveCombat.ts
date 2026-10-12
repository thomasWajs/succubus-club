import { LibraryCard } from '@/shared/model/Card.ts'
import { BotOption, DecisionPoint } from '@/shared/bot/types.ts'
import { Assessment } from '@/shared/bot/utility/assessment.ts'
import { ExplainCandidate } from '@/shared/bot/utility/explain.ts'
import { combatCardsOf, optionOfMove, simOfCombat } from '@/shared/bot/utility/combatBridge.ts'
import { describeMove, planCombat } from '@/shared/bot/utility/combatPlan.ts'
import { cardFactsOf } from '@/shared/bot/utility/combatSetup.ts'
import { profileMinion } from '@/shared/bot/utility/minionProfile.ts'

/**
 * A combat of the engine played by the plan ( step 3.4d of .claude/docs/bot-ai-phase3.md ): the combat is
 * read into the model with the cards I hold, the other hand is the one believed of its Methuselah, and the
 * move of the plan is told back as the option of the referee that makes it.
 */

export type LiveCombatChoice = {
    option: BotOption
    note: string
    candidates: ExplainCandidate[]
}

// None when the decision is not a combat window of mine, or the referee does not offer the move of the
// plan ( the model and the engine are checked to agree, so it does not happen ): the caller plays the
// rules of its fallback then
export function chooseLiveCombat(
    decision: DecisionPoint,
    assessment: Assessment,
): LiveCombatChoice | null {
    const me = decision.player
    const combat = me.gameState.combat
    if (!combat) {
        return null
    }
    const mine = combat.acting.minion.controller == me ? combat.acting : combat.defending
    const theirs = mine == combat.acting ? combat.defending : combat.acting
    const hand = me.hand.cards.flatMap(card =>
        card instanceof LibraryCard ? [cardFactsOf(card)] : [],
    )
    const sim = simOfCombat(combat, player => (player == me ? hand : []))
    if (sim.impulsePlayer != (mine == combat.acting ? 'acting' : 'defending')) {
        return null
    }
    const other = theirs.minion.controller
    const plan = planCombat(assessment.profile, sim, {
        minion: profileMinion(theirs.minion),
        hand: { size: other.hand.length, densities: assessment.densities[other.oid] ?? {} },
    })
    const cards = combatCardsOf(combat)
    const option = optionOfMove(decision.options, plan.move, sim, cards)
    if (!option) {
        return null
    }
    const candidates = plan.options.flatMap(weighed => {
        const weighedOption = optionOfMove(decision.options, weighed.move, sim, cards)
        return weighedOption ?
                [
                    {
                        option: weighedOption,
                        score: weighed.value,
                        parts: { mean: weighed.mean, worst: weighed.worst },
                    },
                ]
            :   []
    })
    return { option, note: `combat plan: ${describeMove(sim, plan.move)}`, candidates }
}
