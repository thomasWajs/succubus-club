import { Minion } from '@/model/Card.ts'
import { CombatantMinion, CombatState } from '@/state/types.ts'

export function createCombatantMinion(minion: Minion): CombatantMinion {
    return {
        minion,
        strength: minion.minionAttrs.strength,
        strike: null,
    }
}

// Aggravated & wounds & torpor are not handled for now
export function inflictDamage(
    combatant: CombatantMinion,
    amountRegular: number,
    amountAggravated: number = 0,
): void {
    combatant.minion.blood -= amountRegular
    combatant.minion.blood -= amountAggravated
}

export function createCombatState(acting: Minion, defending: Minion): CombatState {
    return {
        acting: createCombatantMinion(acting),
        defending: createCombatantMinion(defending),
        impulsePlayer: acting.controller,
        range: null,
        pressed: null,
    }
}
