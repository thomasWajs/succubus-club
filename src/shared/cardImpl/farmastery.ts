import { ActionCardImplementation } from '@/shared/cardImpl/base.ts'
import { DisciplineLevel, LibraryCardType } from '@/shared/const/model.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { Card, LibraryCard } from '@/shared/model/Card.ts'
import { getAutoPlayPosition, getPlayRegion } from '@/shared/state/cardPlacement.ts'
import { Invalid, LibraryCardUsage, VALID } from '@/shared/types/state.ts'

export class FarMastery extends ActionCardImplementation {
    getStealth() {
        return 1
    }

    // Inferior steals a retainer, superior an ally: the cards controlled by the others
    getTargets(): LibraryCardUsage['target'][] {
        return this.player.gameState.competingPlayers
            .flatMap(player => player.ready.cards)
            .filter(card => this.checkTarget(card).isValid)
    }

    canDeclare() {
        if (!this.level) {
            return Invalid('Usage has no level')
        }
        return this.checkTarget(this.usage.target)
    }

    private checkTarget(target: LibraryCardUsage['target']) {
        if (!(target instanceof Card)) {
            return Invalid('Target must be a card')
        }
        if (!target.isIn.ready) {
            return Invalid('Target must be ready')
        }
        if (target.controller == this.player || target.controller.isOusted) {
            return Invalid('Target must be controlled by another Methuselah')
        }

        const type =
            this.level == DisciplineLevel.SUPERIOR ? LibraryCardType.Ally : LibraryCardType.Retainer
        return target instanceof LibraryCard && target.type == type ?
                VALID
            :   Invalid(`Target must be a ${type}`)
    }

    resolve() {
        const target = this.usage.target
        if (!(target instanceof Card)) {
            return
        }
        gameMutations.takeControl.act(this.player, { card: target, controller: this.player })

        // An ally is a minion of its own, on some free space. A retainer is not attached
        // to a vampire in the model yet, so it comes next to the acting minion.
        const toCardRegion = getPlayRegion(this.player)
        if (target.region == toCardRegion) {
            return
        }
        const byMinion = this.level == DisciplineLevel.SUPERIOR ? undefined : this.minion
        const { x, y } = getAutoPlayPosition(this.player, target, toCardRegion, byMinion)
        gameMutations.moveCardToRegion.act(this.player, {
            card: target,
            fromCardRegion: target.region,
            toCardRegion,
            x,
            y,
        })
    }
}
