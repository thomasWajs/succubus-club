import { CombatCardEffect, CombatCardImplementation } from '@/shared/cardImpl/base.ts'
import { createDodgeStrike } from '@/shared/state/combatState.ts'
import { DisciplineLevel } from '@/shared/const/model.ts'

// Only usable on the first round of combat.
// [obf] Maneuver. [OBF] Strike: dodge.
export class BehindYou extends CombatCardImplementation {
    getEffects(): CombatCardEffect[] {
        if (this.combat?.round != 1) {
            return []
        }
        if (this.level == DisciplineLevel.SUPERIOR) {
            return [{ type: 'strike', strike: createDodgeStrike() }]
        }
        if (this.level == DisciplineLevel.INFERIOR) {
            return [{ type: 'maneuver' }]
        }
        return []
    }
}
