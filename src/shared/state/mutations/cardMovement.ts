import { Card, Minion, PropertiesInPlay } from '@/shared/model/Card.ts'
import {
    CARD_LOG_PLACEHOLDER,
    CONTROLLED_ZONE_HEIGHT,
    COUNT_LOG_PLACEHOLDER,
    PLAY_AREA_WIDTH,
    TORPOR_ZONE_Y,
} from '@/shared/const/game.ts'
import {
    ANY_PLAYER,
    GameType,
    Invalid,
    MinionActionType,
    VALID,
    Validity,
} from '@/shared/types/state.ts'
import {
    MutationSyncMode,
    SerializedCard,
    VersioningId,
    VersioningTarget,
} from '@/shared/types/multiplayer.ts'
import { AnyCardRegion, CardOid } from '@/shared/types/model.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { rehydrateCard } from '@/shared/serialization.ts'
import { LogGroup } from '@/shared/types/history.ts'
import {
    ActionLineFold,
    logCard,
    logPlayer,
    logRegion,
} from '@/shared/state/history/mutationLog.ts'
import {
    AnyGameMutation,
    CardMovement,
    CardMutation,
    CardParams,
    GameMutation,
    GameMutationParams,
    PlayerMutation,
    validateCardMovement,
} from '@/shared/state/mutations/base.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'

/**
 * Discard
 */

export class Discard extends CardMutation {
    readonly syncMode = MutationSyncMode.Exclusive
    declare public previousState: { position: number }

    get allowedPlayer() {
        return this.params.card.controller
    }

    getValidity() {
        // Cannot apply if target card is not in the hand
        return this.params.card.isIn.hand ?
                VALID
            :   Invalid('Discarded card must come from the hand')
    }

    protected updateGameState(gameState: GameState) {
        this.previousState.position = this.params.card.position
        gameState.moveCardToRegion(this.params.card, this.params.card.owner.ashHeap)
        gameState.turnResources.dpa -= 1
    }

    formatForLog() {
        return `Discard ${CARD_LOG_PLACEHOLDER}`
    }

    formatLogDetails() {
        return this.handSizeDetails(this.params.card.controller)
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.moveCardToRegion.createCancelMutation(this, {
            card: this.params.card,
            fromCardRegion: this.params.card.region,
            toCardRegion: this.params.card.controller.hand,
            position: this.previousState.position,
        })
    }
}

/**
 * Discard at random ( from hand )
 */

export class DiscardAtRandom extends CardMutation {
    readonly syncMode = MutationSyncMode.Exclusive
    declare public previousState: { position: number }

    get allowedPlayer() {
        return this.params.card.controller
    }

    getValidity() {
        // Cannot apply if target card is not in the hand
        return this.params.card.isIn.hand ?
                VALID
            :   Invalid('Discarded card must come from the hand')
    }

    protected updateGameState(gameState: GameState) {
        this.previousState.position = this.params.card.position
        gameState.moveCardToRegion(this.params.card, this.params.card.owner.ashHeap)
    }

    formatForLog() {
        return `Discard at random ${CARD_LOG_PLACEHOLDER}`
    }

    formatLogDetails() {
        return this.handSizeDetails(this.params.card.controller)
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.moveCardToRegion.createCancelMutation(this, {
            card: this.params.card,
            fromCardRegion: this.params.card.region,
            toCardRegion: this.params.card.controller.hand,
            position: this.previousState.position,
        })
    }
}

/**
 * Draw Crypt
 */
export class DrawCrypt extends PlayerMutation {
    readonly syncMode = MutationSyncMode.Exclusive
    declare public previousState: CardParams

    get allowedPlayer() {
        // Normally, players can only draw from their own stacks.
        // But in Puppeteer mode, the user can make anyone draw
        if (this.params.player.gameState.gameType === GameType.Puppeteer) {
            return ANY_PLAYER
        }
        return this.params.player
    }

    getValidity() {
        // Cannot apply if crypt is empty
        return this.params.player.crypt.isEmpty ? Invalid('Cannot draw from an empty Crypt') : VALID
    }

    protected updateGameState(gameState: GameState) {
        const card = this.params.player.crypt.firstCard
        gameState.moveCardToRegion(card, this.params.player.uncontrolled)
        card.setCoordinates(this.params.player.separators.verticalX, TORPOR_ZONE_Y)

        this.previousState.card = card
    }

    formatForLog() {
        return `Draw ${COUNT_LOG_PLACEHOLDER} from crypt`
    }

    formatLogDetails() {
        return [
            { label: 'uncontrolled', value: `${this.params.player.uncontrolled.length}` },
            { label: 'crypt', value: `${this.params.player.crypt.length}` },
        ]
    }

    // Consecutive draws : "Draw 3 from crypt"
    get logGroup(): LogGroup {
        return { key: `${this.name}-${this.params.player.oid}`, amount: 1 }
    }

    getCancelMutation(): AnyGameMutation {
        const card = this.previousState.card
        return gameMutations.moveCardToRegion.createCancelMutation(this, {
            card,
            fromCardRegion: card.region,
            toCardRegion: card.controller.crypt,
            position: 0,
        })
    }
}

/**
 * Draw Library
 */
export class DrawLibrary extends PlayerMutation {
    readonly syncMode = MutationSyncMode.Exclusive
    declare public previousState: CardParams

    get allowedPlayer() {
        // Normally, players can only draw from their own stacks.
        // But in Puppeteer mode, the user can make anyone draw
        if (this.params.player.gameState.gameType === GameType.Puppeteer) {
            return ANY_PLAYER
        }
        return this.params.player
    }

    getValidity() {
        // Cannot apply if lib is empty
        return this.params.player.library.isEmpty ?
                Invalid('Cannot draw from an empty Library')
            :   VALID
    }

    protected updateGameState(gameState: GameState) {
        const card = this.params.player.library.firstCard
        this.previousState.card = card
        gameState.moveCardToRegion(card, this.params.player.hand)
    }

    formatForLog() {
        return `Draw ${COUNT_LOG_PLACEHOLDER} from library`
    }

    formatLogDetails() {
        return this.playerHandDetails(this.params.player)
    }

    // Consecutive draws : "Draw 3 from library"
    get logGroup(): LogGroup {
        return { key: `${this.name}-${this.params.player.oid}`, amount: 1 }
    }

    getCancelMutation(): AnyGameMutation {
        const card = this.previousState.card
        return gameMutations.moveCardToRegion.createCancelMutation(this, {
            card,
            fromCardRegion: card.region,
            toCardRegion: card.controller.library,
            position: 0,
        })
    }
}

/**
 * Move card inside the same region.
 * Use {x; y} when in play ( on the table ).
 * Use {position} when in a stack ( all other regions, including hand ).
 */

type MoveCardParams = CardMovement

export class MoveCard extends GameMutation<MoveCardParams> {
    _isUserCancellable = false
    isIgnoredForCancel = true
    readonly syncMode = MutationSyncMode.Ordered
    declare public previousState: Omit<CardMovement, 'card'>

    protected get _versioningId(): VersioningId {
        return `${VersioningTarget.Card}-${this.params.card.oid}`
    }

    getValidity() {
        return validateCardMovement(this.params, this.params.card.region)
    }

    protected getStrictValidity(_gameState: GameState): Validity {
        if (!this.params.card.region.isControlledBy(this.author)) {
            return Invalid(`Players can only move their own cards`)
        }

        return VALID
    }

    protected updateGameState() {
        const card = this.params.card

        this.previousState = {
            position: card.position,
            x: card.x,
            y: card.y,
        }

        if (this.params.position != undefined) {
            card.region.move(card, this.params.position)
        }
        if (this.params.x != undefined && this.params.y != undefined) {
            card.setCoordinates(this.params.x, this.params.y)
        }
    }

    formatForLog() {
        // Log reordering only when outside of ready and hand ( stacks )
        if (this.params.card.isIn.hand || this.params.card.isIn.play) {
            return null
        }
        return `Reorder ${CARD_LOG_PLACEHOLDER} in ${logRegion(this.params.card.region, this.author)}`
    }

    formatLogDetails() {
        if (this.params.card.isIn.hand || this.params.card.isIn.play) {
            return null
        }
        const previousPosition = (this.previousState.position ?? 0) as number
        return [
            {
                label: 'position',
                from: `${previousPosition + 1}`,
                value: `${this.params.card.position + 1}`,
            },
        ]
    }

    get card() {
        return this.params.card
    }

    // Users can't cancel these mutations, but we still need to implement the cancel mutation
    // for conflict resolution
    getCancelMutation(): AnyGameMutation {
        return gameMutations.moveCard.createCancelMutation(this, {
            card: this.params.card,
            ...this.previousState,
        })
    }
}

/**
 * Move card to region
 */
interface MoveCardToRegionParams extends CardMovement {
    fromCardRegion: AnyCardRegion
    toCardRegion: AnyCardRegion
    propsInPlay?: PropertiesInPlay
    // Minion the card is played with, when it isn't declared as an action ( a
    // played action modifier, reaction or combat card ). Log only.
    byMinion?: Minion
}

export class MoveCardToRegion extends GameMutation<MoveCardToRegionParams> {
    readonly syncMode = MutationSyncMode.Ordered
    declare public previousState: { propsInPlay: PropertiesInPlay } & Omit<CardMovement, 'card'>

    protected get _versioningId(): VersioningId {
        return `${VersioningTarget.Card}-${this.params.card.oid}`
    }

    getValidity() {
        // Cannot apply if card is already there
        if (this.params.toCardRegion.oid == this.params.card.region.oid) {
            return Invalid(`Card is already in ${this.params.toCardRegion.name}`)
        }

        // Can move only library cards to the hand and the library
        if (
            (this.params.toCardRegion.is.hand || this.params.toCardRegion.is.library) &&
            this.params.card.isCrypt
        ) {
            return Invalid(`Can move only library cards to ${this.params.toCardRegion.name}`)
        }

        // Can move only crypt cards to the crypt
        if (this.params.toCardRegion.is.crypt && !this.params.card.isCrypt) {
            return Invalid(`Can move only crypt cards to ${this.params.toCardRegion.name}`)
        }

        return validateCardMovement(this.params, this.params.toCardRegion)
    }

    protected getStrictValidity(_gameState: GameState): Validity {
        if (
            this.params.card.controllerOid != this.author.oid &&
            !this.params.card.region.isControlledBy(this.author)
        ) {
            return Invalid(`Players can only move their own cards`)
        }

        return VALID
    }

    protected updateGameState(gameState: GameState) {
        const card = this.params.card

        const { isLocked, isFlipped, blood, greenCounter, orangeCounter, purpleCounter, markers } =
            this.card
        this.previousState = {
            position: card.position,
            x: card.x,
            y: card.y,
            propsInPlay: {
                isLocked,
                isFlipped,
                blood,
                greenCounter,
                orangeCounter,
                purpleCounter,
                markers,
            },
        }

        gameState.moveCardToRegion(card, this.params.toCardRegion, this.params.position)
        if (this.params.x != undefined && this.params.y != undefined) {
            card.setCoordinates(this.params.x, this.params.y)
        }
        // Only used for inverse mutations
        if (this.params.propsInPlay) {
            card.updatePropertiesInPlay(this.params.propsInPlay)
        }
    }

    formatForLog() {
        if (this.params.fromCardRegion.is.hand) {
            if (this.params.toCardRegion.is.ready) {
                const byMinion = this.params.byMinion
                if (!byMinion) {
                    return `Play ${CARD_LOG_PLACEHOLDER}`
                }
                return `${logCard(byMinion)} plays ${CARD_LOG_PLACEHOLDER}`
            }
            if (this.params.toCardRegion.is.ashHeap) {
                return `Discard ${CARD_LOG_PLACEHOLDER}`
            }
        }

        const from = logRegion(this.params.fromCardRegion, this.author)
        const to = logRegion(this.params.toCardRegion, this.author)
        return `Move ${CARD_LOG_PLACEHOLDER} from ${from} to ${to}`
    }

    formatLogDetails() {
        if (this.params.fromCardRegion.is.hand && this.params.toCardRegion.is.ashHeap) {
            return this.handSizeDetails(this.params.card.controller)
        }
        return null
    }

    // The card of the action in progress, played from hand : the declaration already names it
    get actionLineFold(): ActionLineFold {
        const minionAction = this.gameState.action?.minionAction
        return (
                this.params.fromCardRegion.is.hand &&
                    minionAction?.type == MinionActionType.ActionCardFromHand &&
                    minionAction.card.oid === this.params.card.oid
            ) ?
                'silent'
            :   null
    }

    get card() {
        return this.params.card
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.moveCardToRegion.createCancelMutation(this, {
            card: this.params.card,
            fromCardRegion: this.params.toCardRegion,
            toCardRegion: this.params.fromCardRegion,
            ...this.previousState,
        })
    }
}

/**
 * Move a card to the bottom of the library or crypt
 */
interface MoveToBottomParams extends GameMutationParams {
    card: Card
    toCardRegion: AnyCardRegion
}

export class MoveToBottom extends GameMutation<MoveToBottomParams> {
    readonly syncMode = MutationSyncMode.Ordered
    declare public previousState: Omit<CardMovement, 'card'> & { cardRegion: AnyCardRegion }

    protected get _versioningId(): VersioningId {
        return `${VersioningTarget.Card}-${this.params.card.oid}`
    }

    getValidity() {
        // Can only send to the bottom of library and crypt

        if (!(this.params.toCardRegion.is.library || this.params.toCardRegion.is.crypt)) {
            return Invalid(`Can only move to the bottom of library or crypt`)
        }

        // Can move only library cards to the the library
        if (this.params.toCardRegion.is.library && this.params.card.isCrypt) {
            return Invalid(`Can move only library cards to ${this.params.toCardRegion.name}`)
        }

        // Can move only crypt cards to the crypt
        if (this.params.toCardRegion.is.crypt && !this.params.card.isCrypt) {
            return Invalid(`Can move only crypt cards to ${this.params.toCardRegion.name}`)
        }

        return VALID
    }

    protected getStrictValidity(_gameState: GameState): Validity {
        if (
            this.params.card.controllerOid != this.author.oid &&
            !this.params.card.region.isControlledBy(this.author)
        ) {
            return Invalid(`Players can only move their own cards`)
        }

        return VALID
    }

    protected updateGameState(gameState: GameState) {
        const card = this.params.card

        this.previousState = {
            cardRegion: card.region,
            position: card.position,
            x: card.x,
            y: card.y,
        }

        // The card is already in the correct region, move it inside the region
        if (this.params.toCardRegion.oid == card.region.oid) {
            card.region.move(card, this.params.toCardRegion.length)
        }
        // The card comes from another region, move it to the target region
        else {
            gameState.moveCardToRegion(
                card,
                this.params.toCardRegion,
                this.params.toCardRegion.length,
            )
        }
    }

    formatForLog() {
        return `Move ${CARD_LOG_PLACEHOLDER} to the bottom of ${logRegion(this.params.toCardRegion, this.author)}`
    }

    get card() {
        return this.params.card
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.moveCardToRegion.createCancelMutation(this, {
            card: this.params.card,
            fromCardRegion: this.params.toCardRegion,
            toCardRegion: this.previousState.cardRegion,
            ...this.previousState,
        })
    }
}

/**
 * Play Face Down
 */

export class PlayFaceDown extends CardMutation {
    readonly syncMode = MutationSyncMode.Ordered
    declare public previousState: Omit<CardMovement, 'card'> & { cardRegion: AnyCardRegion }

    protected get _versioningId(): VersioningId {
        return `${VersioningTarget.Card}-${this.params.card.oid}`
    }

    protected getStrictValidity(_gameState: GameState): Validity {
        if (this.params.card.ownerOid != this.author.oid) {
            return Invalid(`Players can only play face down their own cards`)
        }

        return VALID
    }

    protected updateGameState(gameState: GameState) {
        const card = this.params.card

        this.previousState = {
            cardRegion: card.region,
            position: card.position,
            x: card.x,
            y: card.y,
        }

        card.flip()
        gameState.moveCardToRegion(card, card.controller.ready)
        card.setCoordinates(PLAY_AREA_WIDTH / 2, CONTROLLED_ZONE_HEIGHT / 2)
    }

    formatForLog() {
        return `Play ${CARD_LOG_PLACEHOLDER} Face Down`
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.playFaceDownInverse.createCancelMutation(this, {
            card: this.params.card,
            fromCardRegion: this.params.card.controller.ready,
            toCardRegion: this.previousState.cardRegion,
            ...this.previousState,
        })
    }
}

// This is only for cancel.
// There's no existing mutation that can represent
// the inverse of PlayFaceDown because of the flip + movement
export class PlayFaceDownInverse extends MoveCardToRegion {
    protected updateGameState(gameState: GameState) {
        super.updateGameState(gameState)
        this.params.card.flip()
    }
}

/**
 * Shuffle
 */

interface ShuffleParams extends GameMutationParams {
    cardRegion: AnyCardRegion
    previousCardsOrder: CardOid[]
    cardsOrder: CardOid[]
    shuffledCards?: SerializedCard[] // Serialized card objects with new OIDs (for server-side shuffle)
}

export class Shuffle extends GameMutation<ShuffleParams> {
    readonly syncMode = MutationSyncMode.Ordered

    // Cannot cancel shuffling when it's done server-side
    get isUserCancellable() {
        return this.params.shuffledCards === undefined
    }

    protected get _versioningId(): VersioningId {
        return `${VersioningTarget.Shuffle}-${this.params.cardRegion.oid}`
    }

    protected getStrictValidity(_gameState: GameState): Validity {
        if (!this.params.cardRegion.isControlledBy(this.author)) {
            return Invalid(`Players can only shuffle their own cards`)
        }

        return VALID
    }

    protected updateGameState(gameState: GameState) {
        // If shuffledCards provided (server-side shuffle with new OIDs)
        if (this.params.shuffledCards) {
            // Move old cards to staleCards ( a partial shuffle keeps the other cards as is )
            const keptOids = new Set(this.params.cardsOrder)
            for (const oldOid of this.params.previousCardsOrder) {
                if (!keptOids.has(oldOid) && gameState.cards[oldOid]) {
                    gameState.staleCards[oldOid] = gameState.cards[oldOid]
                    delete gameState.cards[oldOid]
                }
            }

            // Add cards with new OIDs to gameState.cards
            for (const cardData of this.params.shuffledCards) {
                rehydrateCard(gameState, cardData)
            }
        }

        // Apply the shuffled order
        this.params.cardRegion.cardsOid = this.params.cardsOrder
    }

    formatForLog() {
        return `${this.cancelsMutationId ? 'Rewind shuffle' : 'Shuffle'} ${logPlayer(this.params.cardRegion.owner)}'s ${this.params.cardRegion.name}`
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.shuffle.createCancelMutation(this, {
            cardRegion: this.params.cardRegion,
            cardsOrder: this.params.previousCardsOrder,
            previousCardsOrder: this.params.cardsOrder,
        })
    }
}
