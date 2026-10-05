import { ReactionCardEffect, ReactionCardImplementation } from '@/shared/cardImpl/base.ts'
import { DisciplineLevel } from '@/shared/const/model.ts'
import { getBlockingDecision } from '@/shared/state/actionState.ts'
import { isBleed } from '@/shared/state/minionActions.ts'
import { NO_BLOCK } from '@/shared/types/state.ts'

// Only usable if a minion is bleeding you, after blocks are declined.
// [dom] Lock this reacting vampire. Change the target of the bleed to another Methuselah
// other than the acting minion's controller (that Methuselah can attempt to block).
// [DOM] As above, but do not lock this vampire.
export class Deflection extends ReactionCardImplementation {
    getEffects(): ReactionCardEffect[] {
        const gameState = this.player.gameState
        const action = gameState.action?.minionAction
        if (!action || !this.level || !this.minion.isVampire()) {
            return []
        }
        if (!isBleed(action) || action.target != this.player) {
            return []
        }
        // "After blocks are declined": the bled player has said no block
        if (getBlockingDecision(gameState, this.player)?.block !== NO_BLOCK) {
            return []
        }

        const actingPlayer = action.actingMinion.controller
        return gameState.competingPlayers
            .filter(other => other != this.player && other != actingPlayer)
            .map(target => ({
                type: 'changeTarget',
                target,
                lockMinion: this.level == DisciplineLevel.INFERIOR,
            }))
    }
}
