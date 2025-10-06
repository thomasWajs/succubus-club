import { Minion } from '@/model/Card.ts'
import { Player } from '@/model/Player.ts'

export class CombatantMinion {
    strength: number
    strike: null

    constructor(public minion: Minion) {
        this.strength = minion.minionAttrs.strength
    }

    // TODO : handle aggravated, handle wounded, handle going to torpor for vampire or burn for allies
    inflictDamage(amountRegular: number, amountAggravated: number = 0) {
        this.minion.blood -= amountRegular
        this.minion.blood -= amountAggravated
    }
}

export class CombatState {
    impulsePlayer: Player

    range: null
    pressed: null

    constructor(
        public acting: CombatantMinion,
        public defending: CombatantMinion,
    ) {
        this.impulsePlayer = this.acting.minion.controller
    }
}
