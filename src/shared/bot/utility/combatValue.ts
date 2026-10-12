import { BotProfile } from '@/shared/bot/utility/profile.ts'
import { CombatSim, SimCombatant, settled } from '@/shared/bot/utility/combatModel.ts'

/**
 * What a combat costs a side, in pool ( step 3.4b of .claude/docs/bot-ai-phase3.md ): the blood it lost,
 * its worth if it goes to torpor or burns ( the same worth as in assessment.ts: its capacity and the cards
 * attached to it ), and the retainers it lost.
 */

export type LossWeights = {
    // A point of blood
    blood: number
    // The share of its worth lost in torpor ( all of it, burned )
    torporShare: number
    retainer: number
}

export function lossWeightsOf(profile: BotProfile): LossWeights {
    return {
        blood: profile.plan.bloodValue,
        torporShare: profile.combat.torporShare,
        retainer: profile.combat.retainerValue,
    }
}

function worthOf(combatant: SimCombatant): number {
    return combatant.capacity + combatant.attached.length
}

// What the combatant has lost since the combat began, as it is ( a copy settled by the caller if damage is
// still pending ): blood ( a negative loss when it gained some ), its state, the retainers burned
export function lossOf(weights: LossWeights, combatant: SimCombatant): number {
    const state =
        combatant.state == 'burned' ? 1
        : combatant.state == 'torpor' ? weights.torporShare
        : 0
    const retainers = combatant.attached.filter(card => card.retainer && card.life <= 0).length
    return (
        (combatant.startBlood - combatant.blood) * weights.blood +
        state * worthOf(combatant) +
        retainers * weights.retainer
    )
}

// What the combat has cost the combatant so far, the damage pending on it counted
export function lossSoFar(weights: LossWeights, sim: CombatSim, combatant: SimCombatant): number {
    return lossOf(weights, settled(sim, combatant))
}
