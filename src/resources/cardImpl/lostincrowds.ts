import { ActionModifierCardImplementation } from '@/resources/cardImpl/base.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { gameMutations } from '@/state/gameMutations.ts'
import { ActionProperty } from '@/state/actionState.ts'
import { DisciplineLevel } from '@/model/const.ts'

export class LostInCrowds extends ActionModifierCardImplementation {
    apply() {
        const gameState = useGameStateStore()
        if (!gameState.activePlayer) {
            throw new Error('gameState.activePlayer is null')
        }

        gameMutations.ACTION_changeProperty.act(gameState.activePlayer, {
            propertyName: ActionProperty.stealth,
            amount: this.usage.level == DisciplineLevel.SUPERIOR ? 2 : 1,
        })
    }
}
