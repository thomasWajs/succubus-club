import { ActionCardImplementation } from '@/resources/cardImpl/base.ts'
import { DisciplineLevel, RegionName } from '@/model/const.ts'
import { gameMutations } from '@/state/gameMutations.ts'
import { CryptCard, Minion, Vampire } from '@/model/Card.ts'
import { Player } from '@/model/Player.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { ActionProperty } from '@/state/actionState.ts'
import { Invalid, VALID } from '@/state/types.ts'

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
            if (!(this.usage.target instanceof Vampire)) {
                return Invalid('[SUP] Target must be a vampire')
            }
            if (this.usage.target.region.name != RegionName.Uncontrolled) {
                return Invalid('[SUP] Target must be uncontrolled')
            }
            if (actingMinion.capacity <= this.usage.target.capacity) {
                return Invalid('[SUP] Target must be younger')
            }
        }

        return VALID
    }

    declare() {
        const gameState = useGameStateStore()

        if (this.usage.level == DisciplineLevel.INFERIOR) {
            gameMutations.ACTION_changeProperty.act(gameState.activePlayer, {
                propertyName: ActionProperty.bleed,
                amount: 2,
            })
        }
    }

    resolve() {
        const gameState = useGameStateStore()

        if (this.usage.level == DisciplineLevel.SUPERIOR) {
            gameMutations.changeBlood.act(gameState.activePlayer, {
                card: this.usage.target as CryptCard,
                amount: 3,
            })
        }
    }
}
