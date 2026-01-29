import { ActionCardImplementation } from '@/shared/cardImpl/base.ts'
import { DisciplineLevel } from '@/shared/const/model.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { Card, CryptCard, Minion } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { ActionProperty, Invalid, VALID } from '@/shared/types/state.ts'

export class GovernTheUnaligned extends ActionCardImplementation {
    getStealth() {
        return this.usage.level == DisciplineLevel.SUPERIOR ? 1 : 0
    }

    get isBleed() {
        return this.usage.level == DisciplineLevel.INFERIOR
    }

    canDeclare(actingMinion: Minion) {
        if (!this.usage.level) {
            return Invalid('Usage has no level')
        }
        if (!this.usage.target) {
            return Invalid('Usage has no target')
        }

        if (
            this.usage.level == DisciplineLevel.INFERIOR &&
            !(this.usage.target instanceof Player)
        ) {
            return Invalid('[inf] Target must be a player')
        }

        if (this.usage.level == DisciplineLevel.SUPERIOR) {
            if (!(this.usage.target instanceof Card && this.usage.target.isVampire())) {
                return Invalid('[SUP] Target must be a vampire')
            }
            if (!this.usage.target.region.is.uncontrolled) {
                return Invalid('[SUP] Target must be uncontrolled')
            }
            if (actingMinion.minionAttrs.capacity <= this.usage.target.minionAttrs.capacity) {
                return Invalid('[SUP] Target must be younger')
            }
        }

        return VALID
    }

    declare() {
        if (this.usage.level == DisciplineLevel.INFERIOR) {
            gameMutations.ACTION_changeProperty.act(this.player, {
                propertyName: ActionProperty.bleed,
                amount: 2,
            })
        }
    }

    resolve() {
        if (this.usage.level == DisciplineLevel.SUPERIOR) {
            gameMutations.changeBlood.act(this.player, {
                card: this.usage.target as CryptCard,
                amount: 3,
            })
        }
    }
}
