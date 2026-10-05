import { MasterCardImplementation } from '@/shared/cardImpl/base.ts'
import { Vampire } from '@/shared/model/Card.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { Invalid } from '@/shared/types/state.ts'

// Unique location. Hunting ground ( ignored ).
// During your unlock phase, a ready vampire you control can gain 1 blood.
// Requires a ready Malkavian ( the clan of the card ).
export class AsylumHuntingGround extends MasterCardImplementation {
    get staysInPlay() {
        return true
    }

    // A vampire never goes over its capacity
    getUnlockEffectTargets() {
        return this.player.vampiresReady.filter(
            vampire => vampire.blood < vampire.minionAttrs.capacity,
        )
    }

    applyUnlockEffect(vampire: Vampire) {
        if (!this.getUnlockEffectTargets().includes(vampire)) {
            return Invalid('The vampire cannot gain blood')
        }
        return gameMutations.changeBlood.act(this.player, { card: vampire, amount: 1 })
    }
}
