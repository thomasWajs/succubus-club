import { ActionModifierCardImplementation } from '@/shared/cardImpl/base.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { ActionProperty } from '@/shared/types/state.ts'
import { DisciplineLevel } from '@/shared/const/model.ts'

export class LostInCrowds extends ActionModifierCardImplementation {
    apply() {
        gameMutations.ACTION_changeProperty.act(this.player, {
            propertyName: ActionProperty.Stealth,
            amount: this.usage.level == DisciplineLevel.SUPERIOR ? 2 : 1,
        })
    }
}
