import { Player } from '@/shared/model/Player.ts'
import { CardRegion } from '@/shared/model/CardRegion.ts'
import { Card } from '@/shared/model/Card.ts'
import { CARD_LOG_PLACEHOLDER } from '@/shared/const/game.ts'
import {
    ALL_PLAYERS,
    CardRevelationTarget,
    CardRevelationViewer,
    getViewerKey,
    Invalid,
    VALID,
    Validity,
} from '@/shared/types/state.ts'
import { MutationSyncMode, VersioningId, VersioningTarget } from '@/shared/types/multiplayer.ts'
import { AnyCardRegion, PlayerOid } from '@/shared/types/model.ts'
import { isRevealedToViewer } from '@/shared/state/cards/cardVisibility.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { LogDetail, LogGroup } from '@/shared/types/history.ts'
import { logCard, logPlayer, logRegion } from '@/shared/state/history/mutationLog.ts'
import {
    AnyGameMutation,
    CardMutation,
    CardsListParams,
    ChangeCardBoolMutation,
    GameMutation,
    GameMutationParams,
    PlayerMutation,
    PlayerParams,
} from '@/shared/state/mutations/base.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'

/**
 * Become Minion / Vampire
 */

export class BecomeMinion extends CardMutation {
    readonly syncMode = MutationSyncMode.Merge

    getValidity() {
        // Cannot apply if already a minion
        return this.params.card.isMinion() ? Invalid('Already an ally') : VALID
    }

    protected updateGameState() {
        this.params.card.becomeMinion()
    }

    formatForLog() {
        return `${CARD_LOG_PLACEHOLDER} becomes an ally`
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.becomeVampireInverse.createCancelMutation(this, {
            card: this.params.card,
        })
    }
}

export class BecomeVampire extends CardMutation {
    readonly syncMode = MutationSyncMode.Merge

    getValidity() {
        // Cannot apply if already a minion
        return this.params.card.isVampire() ? Invalid('Already a vampire') : VALID
    }

    protected updateGameState() {
        this.params.card.becomeVampire()
    }

    formatForLog() {
        return `${CARD_LOG_PLACEHOLDER} becomes a vampire`
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.becomeVampireInverse.createCancelMutation(this, {
            card: this.params.card,
        })
    }
}

// This is only for cancel.
// There's no existing mutation that can represent
// the inverse of BecomeMinion / BecomeVampire
export class BecomeVampireInverse extends CardMutation {
    readonly syncMode = MutationSyncMode.Merge

    protected updateGameState() {
        this.params.card.minionAttrs = undefined
        this.params.card.vampireAttrs = undefined
    }

    formatForLog() {
        return `${CARD_LOG_PLACEHOLDER} is no longer a minion`
    }
}

/**
 * Card Revelation
 */
interface RevealParams extends GameMutationParams {
    target: CardRevelationTarget
    viewer: CardRevelationViewer
}

export class Reveal extends GameMutation<RevealParams> {
    readonly syncMode = MutationSyncMode.Ordered
    declare public previousState: { viewer: CardRevelationViewer }

    protected get _versioningId(): VersioningId {
        return `${VersioningTarget.Reveal}-${this.params.target.oid}`
    }

    protected getStrictValidity(_gameState: GameState): Validity {
        if (this.params.target.owner?.oid != this.author.oid) {
            return Invalid(`Players can only reveal their own cards`)
        }

        return VALID
    }

    protected updateGameState(gameState: GameState) {
        this.previousState.viewer = this.params.viewer

        if (!gameState.revelations[this.params.target.oid]) {
            gameState.initCardRevelation(this.params.target.oid)
        }

        const viewerKey = getViewerKey(this.params.viewer)
        const revelation = gameState.revelations[this.params.target.oid]
        revelation[viewerKey] = !revelation[viewerKey]
    }

    formatForLog() {
        const viewerString =
            this.params.viewer === ALL_PLAYERS ? 'All players' : logPlayer(this.params.viewer)

        const cardRegion =
            this.params.target instanceof CardRegion ?
                this.params.target
            :   this.params.target.region
        const cardRegionString = logRegion(cardRegion, this.author)

        let verb, particle
        if (isRevealedToViewer(this.params.target, this.params.viewer)) {
            verb = 'Reveal'
            particle = 'to'
        } else {
            verb = 'Conceal'
            particle = 'from'
        }

        if (this.params.target instanceof CardRegion) {
            return `${verb} ${cardRegionString} ${particle} ${viewerString}`
        } else {
            const cardString = this.params.viewer === ALL_PLAYERS ? CARD_LOG_PLACEHOLDER : '1 card'
            return `${verb} ${cardString} of ${cardRegionString} ${particle} ${viewerString}`
        }
    }

    get card() {
        return this.params.target instanceof Card ? this.params.target : null
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.reveal.createCancelMutation(this, {
            target: this.params.target,
            viewer: this.previousState.viewer,
        })
    }
}

/**
 * Flip a card
 */

export class SetFlip extends ChangeCardBoolMutation {
    readonly syncMode = MutationSyncMode.Ordered
    declare public previousState: { isFlipped: boolean }

    protected get _versioningId(): VersioningId {
        return `${VersioningTarget.Card}-${this.params.card.oid}`
    }

    getValidity() {
        // Can flip only in ready and torpor
        return this.params.card.isIn.controlled ?
                VALID
            :   Invalid(`Cannot flip in ${this.params.card.region.name}`)
    }

    protected getStrictValidity(_gameState: GameState): Validity {
        if (this.params.card.controllerOid != this.author.oid) {
            return Invalid(`Players can only flip cards they control`)
        }

        return VALID
    }

    protected updateGameState() {
        this.previousState.isFlipped = this.params.card.isFlipped
        this.params.card.isFlipped = this.params.newValue
    }

    formatForLog() {
        return `Flip ${CARD_LOG_PLACEHOLDER}`
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.setFlip.createCancelMutation(this, {
            card: this.params.card,
            newValue: this.previousState.isFlipped,
        })
    }
}

/**
 * Lock / Unlock a card
 */

export class SetLock extends ChangeCardBoolMutation {
    readonly syncMode = MutationSyncMode.Ordered
    declare public previousState: { isLocked: boolean }

    protected get _versioningId(): VersioningId {
        return `${VersioningTarget.Card}-${this.params.card.oid}`
    }

    getValidity() {
        // Can lock/unlock only in controlled
        return this.params.card.isIn.play ?
                VALID
            :   Invalid(`Cannot lock/unlock in ${this.params.card.region.name}`)
    }

    protected updateGameState() {
        this.previousState.isLocked = this.params.card.isLocked
        this.params.card.isLocked = this.params.newValue
    }

    formatForLog() {
        return `${this.params.card.isLocked ? 'Lock' : 'Unlock'} ${CARD_LOG_PLACEHOLDER}`
    }

    // Locked then unlocked by mistake : a single muted line
    get logGroup(): LogGroup {
        return {
            key: `${this.name}-${this.params.card.oid}`,
            amount: this.params.newValue ? 1 : -1,
            isToggle: true,
        }
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.setLock.createCancelMutation(this, {
            card: this.params.card,
            newValue: this.previousState.isLocked as boolean,
        })
    }
}

/**
 * Take control of a card, overriding the default controller rules
 * ( see Card.controllerOid ). A `controller` of undefined reverts to the default.
 */

export interface TakeControlParams extends GameMutationParams {
    card: Card
    controller: Player | undefined
}

export class TakeControl extends GameMutation<TakeControlParams> {
    readonly syncMode = MutationSyncMode.Ordered
    declare public previousState: { controllerOid: PlayerOid | undefined }

    protected get _versioningId(): VersioningId {
        return `${VersioningTarget.TakeControl}-${this.params.card.oid}`
    }

    get card() {
        return this.params.card
    }

    getValidity() {
        return this.params.card.isIn.controlled ?
                VALID
            :   Invalid(`Cannot take control of a card in ${this.params.card.region.name}`)
    }

    protected updateGameState(gameState: GameState) {
        this.previousState.controllerOid = gameState.takeovers[this.params.card.oid]
        if (this.params.controller) {
            gameState.takeovers[this.params.card.oid] = this.params.controller.oid
        } else {
            delete gameState.takeovers[this.params.card.oid]
        }
    }

    formatForLog() {
        return this.params.controller ?
                `${logPlayer(this.params.controller)} takes control of ${CARD_LOG_PLACEHOLDER}`
            :   `Control of ${CARD_LOG_PLACEHOLDER} reverts to its owner`
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.takeControl.createCancelMutation(this, {
            card: this.params.card,
            controller:
                this.previousState.controllerOid ?
                    this.gameState.players[this.previousState.controllerOid]
                :   undefined,
        })
    }
}

/**
 * Give control of a card region ( stack ) to another player, who can then act on it
 * ( move, shuffle ). A `controller` of undefined returns it to its owner.
 */

export interface TakeRegionControlParams extends GameMutationParams {
    cardRegion: AnyCardRegion
    controller: Player | undefined
}

export class TakeRegionControl extends GameMutation<TakeRegionControlParams> {
    readonly syncMode = MutationSyncMode.Ordered
    declare public previousState: { controllerOid: PlayerOid | undefined }

    protected get _versioningId(): VersioningId {
        return `${VersioningTarget.TakeRegionControl}-${this.params.cardRegion.oid}`
    }

    getValidity() {
        return this.params.cardRegion.owner ?
                VALID
            :   Invalid(`Cannot give control of ${this.params.cardRegion.name}`)
    }

    protected getStrictValidity(_gameState: GameState): Validity {
        const { cardRegion, controller } = this.params
        const isOwner = cardRegion.owner?.oid == this.author.oid
        // The player holding the control may only hand it back
        const isHandingBack = !controller && cardRegion.delegate?.oid == this.author.oid
        if (!isOwner && !isHandingBack) {
            return Invalid(`Players can only give control of their own stacks`)
        }

        return VALID
    }

    protected updateGameState(gameState: GameState) {
        const { cardRegion, controller } = this.params
        this.previousState.controllerOid = gameState.regionTakeovers[cardRegion.oid]
        if (controller && controller.oid != cardRegion.owner?.oid) {
            gameState.regionTakeovers[cardRegion.oid] = controller.oid
        } else {
            delete gameState.regionTakeovers[cardRegion.oid]
        }
    }

    formatForLog() {
        const { cardRegion, controller } = this.params
        const owner = cardRegion.owner
        return controller && controller.oid != owner?.oid ?
                `${logPlayer(owner)} gives control of ${cardRegion.name} to ${logPlayer(controller)}`
            :   `Control of ${logPlayer(owner)}'s ${cardRegion.name} ends`
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.takeRegionControl.createCancelMutation(this, {
            cardRegion: this.params.cardRegion,
            controller:
                this.previousState.controllerOid ?
                    this.gameState.players[this.previousState.controllerOid]
                :   undefined,
        })
    }
}

/**
 * Unlock ALl
 */

interface UnlockAllInverseParams extends PlayerParams, CardsListParams {}

export class UnlockAll extends PlayerMutation {
    readonly syncMode = MutationSyncMode.Exclusive
    declare public previousState: UnlockAllInverseParams

    get allowedPlayer() {
        return this.params.player
    }

    protected updateGameState(gameState: GameState) {
        this.previousState = {
            player: this.params.player,
            cards: [],
        }

        for (const cardRegion of this.params.player.allCardRegions) {
            for (const card of cardRegion.cards) {
                if (card.isLocked) {
                    this.previousState.cards.push(card)
                }
                card.unlock()
            }
        }

        // Free Table : the shared table isn't one of this player's
        // allCardRegions, so their cards there must be unlocked separately.
        if (gameState.isFreeTable && gameState.table) {
            for (const card of gameState.table.cards) {
                if (card.controllerOid != this.params.player.oid) {
                    continue
                }
                if (card.isLocked) {
                    this.previousState.cards.push(card)
                }
                card.unlock()
            }
        }
    }

    formatForLog() {
        return `Unlock all`
    }

    // The unlocked cards
    formatLogDetails() {
        return lockedCardsLogDetails(this.previousState.cards)
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.unlockAllInverse.createCancelMutation(this, this.previousState)
    }
}

export class UnlockAllInverse extends GameMutation<UnlockAllInverseParams> {
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        return this.params.player
    }

    protected updateGameState() {
        for (const card of this.params.cards) {
            card.lock()
        }
    }

    formatForLog() {
        return `Lock the unlocked cards`
    }

    // The cards locked again
    formatLogDetails() {
        return lockedCardsLogDetails(this.params.cards)
    }
}

// The cards of an Unlock All, named to the players who can see them
function lockedCardsLogDetails(cards: Card[]): LogDetail[] {
    return cards.map(card => ({ value: logCard(card) }))
}
