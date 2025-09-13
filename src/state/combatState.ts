import { Minion } from '@/model/Card.ts'
import { Player } from '@/model/Player.ts'

export class CombatantMinion {
    strength: number
    strike: null

    constructor(public minion: Minion) {
        this.strength = minion.strength
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
