import { Player } from '@/model/Player.ts'
import { useHistoryStore } from '@/store/history.ts'
import { GameStateStore, useGameStateStore } from '@/store/gameState.ts'
import { AnyCardRegion, CardRegion } from '@/model/CardRegion.ts'
import { Card, CardOid, CryptCard, LibraryCard, Minion } from '@/model/Card.ts'
import { Marker, TurnSequence } from '@/model/const.ts'
import {
    CARD_LOG_PLACEHOLDER,
    CONTROLLED_ZONE_HEIGHT,
    PLAY_AREA_WIDTH,
    TORPOR_ZONE_Y,
} from '@/game/const.ts'
import {
    ActionProperty,
    ActionState,
    NO_ACTION_MODIFIER,
    NO_BLOCK,
    NO_REACTION,
} from '@/state/actionState.ts'
import { MinionAction } from '@/state/minionActions.ts'
import {
    ALL_PLAYERS,
    CardRevelationTarget,
    CardRevelationViewer,
    GameType,
    getViewerKey,
    Invalid,
    PlayerVision,
    TargetDeclaration,
    VALID,
    Validity,
} from '@/state/types.ts'
import { CombatantMinion, CombatState } from '@/state/combatState.ts'
import { useCoreStore } from '@/store/core.ts'
import { broadcastGameMutation } from '@/multiplayer/room.ts'
import { useBusStore, useGameBusStore } from '@/store/bus.ts'
import { MutationSyncMode, VersioningId, VersioningTarget } from '@/multiplayer/types.ts'
import { hashObject } from '@/gateway/serialization.ts'
import { isRevealedToViewer } from '@/state/cardVisibility.ts'
import { enqueueBotMutation } from '@/bot/mutationQueue.ts'
import { useTimer } from '@/game/composables/useTimer.ts'

export type GameMutationId = number
export interface GameMutationParams {
    [key: string]: unknown
}
export type AnyGameMutation = GameMutation<GameMutationParams>
export type GameMutationName = keyof typeof gameMutations

export abstract class GameMutation<ParamsType extends GameMutationParams> {
    readonly id: GameMutationId // Used to identify mutation when cancelling it
    abstract readonly syncMode: MutationSyncMode

    isUserCancellable = true
    isIgnoredForCancel = false
    cancelToResolveConflict = false // will be set to true if the mutation is cancelled to resolve a conflict

    playerVision = {} as PlayerVision
    // Store as needed the previous state of the game to be able to make the cancel diff
    previousState = {} as { [key: string]: unknown }

    constructor(
        public params: ParamsType,
        public timestamp: Date,
        public author: Player,
        public cancelsMutationId?: GameMutationId,
    ) {
        this.id = hashObject({
            t: this.timestamp.getTime(),
            a: this.author.oid,
            ...this.params,
        })
    }

    get name(): GameMutationName {
        // @ts-expect-error mutationName is injected by prototype
        return this.mutationName
    }

    // To be overrided by subclasses when the mutation interact with a Card
    get card(): Card | null {
        return null
    }

    // To be overrided by subclasses which an Exclusive sync mode
    protected get allowedPlayer(): Player | null | undefined {
        return null
    }

    get versioningId(): VersioningId {
        if (this.syncMode != MutationSyncMode.Ordered) {
            throw new Error('versioningId is only available for Ordered mutations')
        }
        return this._versioningId
    }
    protected get _versioningId(): VersioningId {
        return ''
    }

    /**
     * Apply
     */

    canApply(): Validity {
        // Ensure exclusive mutations are only applied by the correct player
        if (this.syncMode == MutationSyncMode.Exclusive) {
            if (!this.allowedPlayer) {
                return Invalid(`No valid player for ${this.name}`)
            }
            if (this.allowedPlayer != this.author) {
                return Invalid(
                    `${this.author.name} cannot apply ${this.name} to ${this.allowedPlayer.name}`,
                )
            }
        }
        // Mutation-specific validation
        return this.getValidity(useGameStateStore())
    }

    // To be overrided by subclasses with mutation-specific validation
    protected getValidity(_gameState: GameStateStore): Validity {
        return VALID
    }

    apply() {
        // A player have vision on the card if it can see/peek the card
        // either before or after updating the gameState
        const visionBefore = this.card?.getPlayerVision() ?? { public: false }
        this.updateGameState(useGameStateStore())
        const visionAfter = this.card?.getPlayerVision() ?? { public: false }

        this.playerVision = {} as PlayerVision
        for (const playerOid in visionAfter) {
            this.playerVision[playerOid] = visionBefore[playerOid] || visionAfter[playerOid]
        }
        useHistoryStore().addGameMutation(this)
    }

    protected abstract updateGameState(_gameState: GameStateStore): void

    /**
     * Cancel
     */

    cancel() {
        if (!this.isUserCancellable) {
            throw new Error('Cannot cancel this type of mutation')
        }
        dispatchMutation(this.getCancelMutation())
    }

    getCancelMutation(): AnyGameMutation {
        throw new Error('getCancelMutation is not implemented')
    }

    /**
     * Log Formatting
     */

    formatForLog(): string | null {
        return null
    }

    formatPlayerStateForLog(player: Player) {
        return `(hand: ${player.hand.length} | lib: ${player.library.length})`
    }
}

/**
 * Common Params
 */

type EmptyParams = GameMutationParams

interface CardParams extends GameMutationParams {
    card: Card
}

interface CardsListParams extends GameMutationParams {
    cards: Card[]
}

// Used to change blood/life/green counters
interface ChangeCounterParams extends GameMutationParams {
    card: Card
    amount: number
}

// Used to flip or lock a card
interface ChangeCardBoolParams extends GameMutationParams {
    card: Card
    newValue: boolean
}

interface PlayerParams extends GameMutationParams {
    player: Player
}

// Used for turnIndex and turnPhaseIndex
interface ChangeIndexParams extends GameMutationParams {
    index: number
}

/**
 * Abstract Mutations
 */

abstract class CardMutation extends GameMutation<CardParams> {
    get card() {
        return this.params.card
    }
}

abstract class ChangeCounterMutation extends GameMutation<ChangeCounterParams> {
    get card() {
        return this.params.card
    }
}

abstract class ChangeCardBoolMutation extends GameMutation<ChangeCardBoolParams> {
    get card() {
        return this.params.card
    }
}

abstract class PlayerMutation extends GameMutation<PlayerParams> {}

/**
 * Common validation
 */

export interface CardMovement extends GameMutationParams {
    card: Card
    position?: number // For hand and stacks
    x?: number // For table regions
    y?: number // For table regions
}

function validateCardMovement(movement: CardMovement, cardRegion: AnyCardRegion) {
    const { position, x, y } = movement

    if (position === undefined && x === undefined && y === undefined) {
        return Invalid(`Must specify position and/or x/y`)
    }

    if (position !== undefined) {
        if (position < 0) {
            return Invalid(`Position must be positive`)
        }
        if (position > cardRegion.length) {
            return Invalid(`Position must be less than ${cardRegion.length}`)
        }
    }

    return VALID
}

/**
 * Change Blood/life
 */

class ChangeBlood extends ChangeCounterMutation {
    readonly syncMode = MutationSyncMode.Merge

    getValidity() {
        // There's no blood outside of the play area
        if (!this.params.card.isIn.play)
            return Invalid(
                `${this.params.card.secureName} : Cannot change blood because it is not in play`,
            )

        // Cannot get a negative blood amount
        if (this.params.card.blood + this.params.amount < 0) {
            return Invalid(`${this.params.card.secureName} : Cannot go below 0 blood`)
        }

        return VALID
    }

    protected updateGameState() {
        this.params.card.changeBlood(this.params.amount)
    }

    formatForLog() {
        return `${this.params.amount > 0 ? '+' : ''}${this.params.amount} blood on ${CARD_LOG_PLACEHOLDER}`
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.changeBlood.createCancelMutation(this, {
            card: this.params.card,
            amount: this.params.amount * -1,
        })
    }
}

/**
 * Change Green counter
 */

class ChangeGreenCounter extends ChangeCounterMutation {
    readonly syncMode = MutationSyncMode.Merge

    getValidity() {
        // There's no counters outside of the play area
        if (!this.params.card.isIn.play)
            return Invalid(
                `${this.params.card.secureName} : Cannot change counter because it is not in play`,
            )

        // Cannot get a negative counter amount
        if (this.params.card.greenCounter + this.params.amount < 0) {
            return Invalid(`${this.params.card.secureName} : Cannot go below 0 counter`)
        }

        return VALID
    }

    protected updateGameState() {
        this.params.card.greenCounter = Math.max(
            0,
            this.params.card.greenCounter + this.params.amount,
        )
    }

    formatForLog() {
        return `${this.params.amount > 0 ? '+' : ''}${this.params.amount} green counter on ${CARD_LOG_PLACEHOLDER}`
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.changeGreenCounter.createCancelMutation(this, {
            card: this.params.card,
            amount: this.params.amount * -1,
        })
    }
}

/**
 * Change Marker
 */
interface ChangeMarkerParams extends GameMutationParams {
    card: Card
    marker: Marker
    operation: 'Add' | 'Remove'
}

class ChangeMarker extends GameMutation<ChangeMarkerParams> {
    readonly syncMode = MutationSyncMode.Ordered

    protected get _versioningId(): VersioningId {
        return `${VersioningTarget.Marker}-${this.params.card.oid}`
    }

    protected updateGameState() {
        if (this.params.operation == 'Remove') {
            this.params.card.markers = this.params.card.markers.filter(
                marker => marker !== this.params.marker,
            )
        }

        if (this.params.operation == 'Add' && !this.params.card.hasMarker(this.params.marker)) {
            this.params.card.markers.push(this.params.marker)
        }
    }

    formatForLog() {
        return `${this.params.operation} ${this.params.marker} on ${CARD_LOG_PLACEHOLDER}`
    }

    get card() {
        return this.params.card
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.changeMarker.createCancelMutation(this, {
            card: this.params.card,
            marker: this.params.marker,
            operation: this.params.operation == 'Add' ? 'Remove' : 'Add',
        })
    }
}

/**
 * Change Pool
 */
interface ChangePoolParams extends GameMutationParams {
    player: Player
    amount: number
}

class ChangePool extends GameMutation<ChangePoolParams> {
    readonly syncMode = MutationSyncMode.Merge

    getValidity() {
        // Cannot get a negative pool amount
        if (this.params.player.pool + this.params.amount < 0) {
            return Invalid(`${this.params.player.name} : Cannot go below 0 pool`)
        }

        return VALID
    }

    protected updateGameState() {
        this.params.player.changePool(this.params.amount)
    }

    formatForLog() {
        return `${this.params.amount > 0 ? '+' : ''}${this.params.amount} pool on ${this.params.player.name}`
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.changePool.createCancelMutation(this, {
            player: this.params.player,
            amount: this.params.amount * -1,
        })
    }
}

/**
 * Change The Edge Control
 */
interface ChangeTheEdgeControlParams extends GameMutationParams {
    theEdgeController: Player | undefined
}

class ChangeTheEdgeControl extends GameMutation<ChangeTheEdgeControlParams> {
    readonly syncMode = MutationSyncMode.Ordered
    declare public previousState: ChangeTheEdgeControlParams

    protected get _versioningId(): VersioningId {
        return `${VersioningTarget.TheEdge}`
    }

    protected updateGameState(gameState: GameStateStore) {
        this.previousState.theEdgeController = gameState.theEdgeController
        gameState.theEdgeControllerOid = this.params.theEdgeController?.oid
    }

    formatForLog() {
        if (this.params.theEdgeController) {
            return `${this.params.theEdgeController.name} gains the Edge`
        } else {
            return `Burns the Edge`
        }
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.changeTheEdgeControl.createCancelMutation(this, {
            theEdgeController: this.previousState.theEdgeController,
        })
    }
}

/**
 * Discard
 */

class Discard extends CardMutation {
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

    protected updateGameState(gameState: GameStateStore) {
        this.previousState.position = this.params.card.position
        gameState.moveCardToRegion(this.params.card, this.params.card.owner.ashHeap)
        gameState.turnResources.dpa -= 1
    }

    formatForLog() {
        return `Discard ${CARD_LOG_PLACEHOLDER} ${this.formatPlayerStateForLog(this.params.card.controller)}`
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

class DiscardAtRandom extends CardMutation {
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

    protected updateGameState(gameState: GameStateStore) {
        this.previousState.position = this.params.card.position
        gameState.moveCardToRegion(this.params.card, this.params.card.owner.ashHeap)
    }

    formatForLog() {
        return `Discard at random ${CARD_LOG_PLACEHOLDER} ${this.formatPlayerStateForLog(this.params.card.controller)}`
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
class DrawCrypt extends PlayerMutation {
    readonly syncMode = MutationSyncMode.Exclusive
    declare public previousState: CardParams

    get allowedPlayer() {
        return this.params.player
    }

    getValidity() {
        // Cannot apply if crypt is empty
        return this.params.player.crypt.isEmpty ? Invalid('Cannot draw from an empty Crypt') : VALID
    }

    protected updateGameState(gameState: GameStateStore) {
        const card = this.params.player.crypt.firstCard
        gameState.moveCardToRegion(card, this.params.player.uncontrolled)
        card.setCoordinates(PLAY_AREA_WIDTH / 2, TORPOR_ZONE_Y)

        this.previousState.card = card
    }

    formatForLog() {
        return `Draw Crypt (uncontrolled: ${this.params.player.uncontrolled.length} | crypt: ${this.params.player.crypt.length})`
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
class DrawLibrary extends PlayerMutation {
    readonly syncMode = MutationSyncMode.Exclusive
    declare public previousState: CardParams

    get allowedPlayer() {
        return this.params.player
    }

    getValidity() {
        // Cannot apply if lib is empty
        return this.params.player.library.isEmpty ?
                Invalid('Cannot draw from an empty Library')
            :   VALID
    }

    protected updateGameState(gameState: GameStateStore) {
        const card = this.params.player.library.firstCard
        this.previousState.card = card
        gameState.moveCardToRegion(card, this.params.player.hand)
    }

    formatForLog() {
        return `Draw Library ${this.formatPlayerStateForLog(this.params.player)}`
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
 * Change Turn / Phase
 */

class GoToTurn extends GameMutation<ChangeIndexParams> {
    readonly syncMode = MutationSyncMode.Ordered
    declare public previousState: { turnNumber: number }

    protected get _versioningId(): VersioningId {
        return `${VersioningTarget.Turn}`
    }

    getValidity() {
        if (this.params.index < 1) {
            return Invalid(`Invalid turn number ${this.params.index}`)
        }

        return VALID
    }

    protected updateGameState(gameState: GameStateStore) {
        this.previousState.turnNumber = gameState.turnNumber
        gameState.changeTurn(this.params.index)
    }

    formatForLog() {
        if (this.params.index > this.previousState.turnNumber) {
            return `Advance to turn ${useGameStateStore().turnNumber}`
        } else if (this.params.index < this.previousState.turnNumber) {
            return `Back to turn ${useGameStateStore().turnNumber}`
        }
        return null
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.goToTurn.createCancelMutation(this, {
            index: this.previousState.turnNumber,
        })
    }
}

class GoToTurnPhase extends GameMutation<ChangeIndexParams> {
    readonly syncMode = MutationSyncMode.Ordered
    declare public previousState: { turnPhaseIndex: number }

    protected get _versioningId(): VersioningId {
        return `${VersioningTarget.TurnPhase}`
    }

    getValidity() {
        if (this.params.index < 0 || this.params.index >= TurnSequence.length) {
            return Invalid(`Invalid phase index ${this.params.index}`)
        }
        return VALID
    }

    protected updateGameState(gameState: GameStateStore) {
        this.previousState.turnPhaseIndex = gameState.turnPhaseIndex
        gameState.turnPhaseIndex = this.params.index
        gameState.action = null
        gameState.combat = null
    }

    formatForLog() {
        return `Go to ${useGameStateStore().turnPhase} Phase`
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.goToTurnPhase.createCancelMutation(this, {
            index: this.previousState.turnPhaseIndex,
        })
    }
}

/**
 * Influence
 */

class Influence extends ChangeCounterMutation {
    readonly syncMode = MutationSyncMode.Merge

    getValidity() {
        if (!this.params.card.isIn.uncontrolled) {
            return Invalid('Influence must be done on uncontrolled vampires')
        }
        return VALID
    }

    protected updateGameState(gameState: GameStateStore) {
        const card = this.params.card
        card.changeBlood(this.params.amount)
        card.controller.changePool(-this.params.amount)
        gameState.turnResources.transfers -= this.params.amount
    }

    formatForLog() {
        return `Influence ${this.params.amount} on ${CARD_LOG_PLACEHOLDER}`
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.influence.createCancelMutation(this, {
            card: this.params.card,
            amount: this.params.amount * -1,
        })
    }
}

/**
 * Move card
 */

type MoveCardParams = CardMovement

class MoveCard extends GameMutation<MoveCardParams> {
    isUserCancellable = false
    isIgnoredForCancel = true
    readonly syncMode = MutationSyncMode.Ordered
    declare public previousState: Omit<CardMovement, 'card'>

    protected get _versioningId(): VersioningId {
        return `${VersioningTarget.Card}-${this.params.card.oid}`
    }

    getValidity() {
        return validateCardMovement(this.params, this.params.card.region)
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
}

class MoveCardToRegion extends GameMutation<MoveCardToRegionParams> {
    readonly syncMode = MutationSyncMode.Ordered
    declare public previousState: Omit<CardMovement, 'card'>

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
            !(this.params.card instanceof LibraryCard)
        ) {
            return Invalid(`Can move only library cards to ${this.params.toCardRegion.name}`)
        }

        // Can move only crypt cards to the crypt
        if (this.params.toCardRegion.is.crypt && !(this.params.card instanceof CryptCard)) {
            return Invalid(`Can move only crypt cards to ${this.params.toCardRegion.name}`)
        }

        return validateCardMovement(this.params, this.params.toCardRegion)
    }

    protected updateGameState(gameState: GameStateStore) {
        const card = this.params.card

        this.previousState = {
            position: card.position,
            x: card.x,
            y: card.y,
        }

        gameState.moveCardToRegion(card, this.params.toCardRegion, this.params.position)
        if (this.params.x != undefined && this.params.y != undefined) {
            card.setCoordinates(this.params.x, this.params.y)
        }
    }

    formatForLog() {
        if (this.params.fromCardRegion.is.hand) {
            if (this.params.toCardRegion.is.ready) {
                return `Play ${CARD_LOG_PLACEHOLDER}`
            }
            if (this.params.toCardRegion.is.ashHeap) {
                return `Discard ${CARD_LOG_PLACEHOLDER} ${this.formatPlayerStateForLog(this.params.card.controller)}`
            }
        }

        return `Move ${CARD_LOG_PLACEHOLDER} from ${this.params.fromCardRegion.owner.name}'s ${this.params.fromCardRegion.name} to ${this.params.toCardRegion.owner.name}'s ${this.params.toCardRegion.name}`
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

class MoveToBottom extends GameMutation<MoveToBottomParams> {
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
        if (this.params.toCardRegion.is.library && !(this.params.card instanceof LibraryCard)) {
            return Invalid(`Can move only library cards to ${this.params.toCardRegion.name}`)
        }

        // Can move only crypt cards to the crypt
        if (this.params.toCardRegion.is.crypt && !(this.params.card instanceof CryptCard)) {
            return Invalid(`Can move only crypt cards to ${this.params.toCardRegion.name}`)
        }

        return VALID
    }

    protected updateGameState(gameState: GameStateStore) {
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
        return `Move ${CARD_LOG_PLACEHOLDER} to the bottom of ${this.params.toCardRegion.name}`
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

class PlayFaceDown extends CardMutation {
    readonly syncMode = MutationSyncMode.Ordered
    declare public previousState: Omit<CardMovement, 'card'> & { cardRegion: AnyCardRegion }

    protected get _versioningId(): VersioningId {
        return `${VersioningTarget.Card}-${this.params.card.oid}`
    }

    protected updateGameState(gameState: GameStateStore) {
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
        return `Play ${CARD_LOG_PLACEHOLDER} Face Down `
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
class PlayFaceDownInverse extends MoveCardToRegion {
    protected updateGameState(gameState: GameStateStore) {
        super.updateGameState(gameState)
        this.params.card.flip()
    }
}

/**
 * Card Revelation
 */
interface RevealParams extends GameMutationParams {
    target: CardRevelationTarget
    viewer: CardRevelationViewer
}

class Reveal extends GameMutation<RevealParams> {
    readonly syncMode = MutationSyncMode.Ordered
    declare public previousState: { viewer: CardRevelationViewer }

    protected get _versioningId(): VersioningId {
        return `${VersioningTarget.Reveal}-${this.params.target.oid}`
    }

    protected updateGameState(gameState: GameStateStore) {
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
            this.params.viewer === ALL_PLAYERS ? 'All players' : this.params.viewer.name

        const cardRegion =
            this.params.target instanceof CardRegion ?
                this.params.target
            :   this.params.target.region
        const cardRegionString = `${cardRegion.owner.name}'s ${cardRegion.name}`

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

class SetFlip extends ChangeCardBoolMutation {
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

class SetLock extends ChangeCardBoolMutation {
    readonly syncMode = MutationSyncMode.Ordered
    declare public previousState: { isLocked: boolean }

    protected get _versioningId(): VersioningId {
        return `${VersioningTarget.Card}-${this.params.card.oid}`
    }

    getValidity() {
        // Can lock/unlock only in controlled
        return this.params.card.isIn.controlled ?
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

    getCancelMutation(): AnyGameMutation {
        return gameMutations.setLock.createCancelMutation(this, {
            card: this.params.card,
            newValue: this.previousState.isLocked as boolean,
        })
    }
}

/**
 * Shuffle
 */

interface ShuffleParams extends GameMutationParams {
    cardRegion: AnyCardRegion
    previousCardsOrder: CardOid[]
    cardsOrder: CardOid[]
}

class Shuffle extends GameMutation<ShuffleParams> {
    readonly syncMode = MutationSyncMode.Ordered

    protected get _versioningId(): VersioningId {
        return `${VersioningTarget.Shuffle}-${this.params.cardRegion.oid}`
    }

    protected updateGameState() {
        this.params.cardRegion.cardsOid = this.params.cardsOrder
    }

    formatForLog() {
        return `${this.cancelsMutationId ? 'Rewind shuffle' : 'Shuffle'} ${this.params.cardRegion.owner.name}'s ${this.params.cardRegion.name}`
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.shuffle.createCancelMutation(this, {
            cardRegion: this.params.cardRegion,
            cardsOrder: this.params.previousCardsOrder,
            previousCardsOrder: this.params.cardsOrder,
        })
    }
}

/**
 * Unlock ALl
 */

interface UnlockAllInverseParams extends PlayerParams, CardsListParams {}

class UnlockAll extends PlayerMutation {
    readonly syncMode = MutationSyncMode.Exclusive
    declare public previousState: UnlockAllInverseParams

    get allowedPlayer() {
        return this.params.player
    }

    protected updateGameState() {
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
    }

    formatForLog() {
        return `Unlock All`
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.unlockAllInverse.createCancelMutation(this, this.previousState)
    }
}

class UnlockAllInverse extends GameMutation<UnlockAllInverseParams> {
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
        return `Lock some cards`
    }
}

/**
 * Action: Change action value
 */

interface ChangeActionPropertyParams extends GameMutationParams {
    propertyName: ActionProperty
    amount: number
}

class ChangeActionProperty extends GameMutation<ChangeActionPropertyParams> {
    readonly syncMode = MutationSyncMode.Merge

    getValidity(gameState: GameStateStore) {
        return gameState.action ? VALID : Invalid('Must be applied during an action')
    }

    protected updateGameState(gameState: GameStateStore) {
        if (!gameState.action) {
            throw new Error('gameState.action is null')
        }
        gameState.action[this.params.propertyName] += this.params.amount
    }

    formatForLog() {
        return `${this.params.amount > 0 ? '+' : ''}${this.params.amount} ${this.params.propertyName} for the action`
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.ACTION_changeProperty.createCancelMutation(this, {
            propertyName: this.params.propertyName,
            amount: this.params.amount * -1,
        })
    }
}

/**
 * Action: Declare action
 */

interface DeclareActionParams extends GameMutationParams {
    minionAction: MinionAction
}

class DeclareAction extends GameMutation<DeclareActionParams> {
    isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        return useGameStateStore().activePlayer
    }

    getValidity(gameState: GameStateStore) {
        return gameState.action ? Invalid('An action is already in progress') : VALID
    }

    protected updateGameState(gameState: GameStateStore) {
        this.params.minionAction.actingMinion.lock()
        gameState.action = new ActionState(this.params.minionAction)
        this.params.minionAction.declare()
    }

    formatForLog() {
        return `Declare ${this.params.minionAction.name} with ${CARD_LOG_PLACEHOLDER}`
    }

    get card(): Card | null {
        return this.params.minionAction.actingMinion
    }
}

/**
 * Action: Declare action modifier
 */

interface DeclareActionModifierParams extends GameMutationParams {
    actionModifier: Card | typeof NO_ACTION_MODIFIER
}

class DeclareActionModifier extends GameMutation<DeclareActionModifierParams> {
    isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        return useGameStateStore().activePlayer
    }

    getValidity(gameState: GameStateStore) {
        return gameState.action ? VALID : Invalid('Must be applied during an action')
    }

    protected updateGameState(gameState: GameStateStore) {
        if (!gameState.action) {
            throw new Error('gameState.action is null')
        }
        gameState.action.passImpulse()
    }

    formatForLog() {
        if (this.params.actionModifier === NO_ACTION_MODIFIER) {
            return `No Action Modifier`
        } else {
            return `Action modifier : ${CARD_LOG_PLACEHOLDER}`
        }
    }

    get card() {
        return this.params.actionModifier == NO_ACTION_MODIFIER ? null : this.params.actionModifier
    }
}

/**
 * Action: Declare block
 */

// TODO: handle multiple player who declines ( prey/predator)
interface DeclareBlockParams extends GameMutationParams {
    blockingMinion: Minion | typeof NO_BLOCK
}

class DeclareBlock extends GameMutation<DeclareBlockParams> {
    isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        return useGameStateStore().action?.impulsePlayer ?? null
    }

    getValidity(gameState: GameStateStore) {
        return gameState.action ? VALID : Invalid('Must be applied during an action')
    }

    protected updateGameState(gameState: GameStateStore) {
        if (!gameState.action) {
            throw new Error('gameState.action is null')
        }
        gameState.action.blockingDecision = this.params.blockingMinion
        gameState.action.regainImpulse()
    }

    formatForLog() {
        if (this.params.blockingMinion === NO_BLOCK) {
            return `No Block`
        } else {
            return `Block attempt with ${CARD_LOG_PLACEHOLDER}`
        }
    }

    get card() {
        return this.params.blockingMinion == NO_BLOCK ? null : this.params.blockingMinion
    }
}

/**
 * Action: Declare reaction
 */

interface DeclareReactionParams extends GameMutationParams {
    reaction: Card | typeof NO_REACTION
}

class DeclareReaction extends GameMutation<DeclareReactionParams> {
    isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        return useGameStateStore().action?.impulsePlayer ?? null
    }

    getValidity(gameState: GameStateStore) {
        return gameState.action ? VALID : Invalid('Must be applied during an action')
    }

    protected updateGameState(gameState: GameStateStore) {
        if (!gameState.action) {
            throw new Error('gameState.action is null')
        }
        gameState.action.passImpulse()
    }

    formatForLog() {
        if (this.params.reaction === NO_REACTION) {
            return `No Reaction`
        } else {
            return `Reaction : ${CARD_LOG_PLACEHOLDER}`
        }
    }

    get card() {
        return this.params.reaction == NO_REACTION ? null : this.params.reaction
    }
}

/**
 * Action: Resolve action
 */

class ResolveAction extends GameMutation<EmptyParams> {
    isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive
    minionActionName = ''

    get allowedPlayer() {
        return useGameStateStore().activePlayer
    }

    getValidity(gameState: GameStateStore) {
        return gameState.action ? VALID : Invalid('Must be applied during an action')
    }

    protected updateGameState(gameState: GameStateStore) {
        if (!gameState.action) {
            throw new Error('gameState.action is null')
        }
        // Store for use formatForLog()
        this.minionActionName = gameState.action.minionAction.name
        gameState.action.minionAction.resolve()
        gameState.action = null
        useCoreStore().conductor?.onActionResolve()
    }

    formatForLog() {
        return `Resolve ${this.minionActionName}`
    }
}

/**
 * Action: Resolve block
 */

class ResolveBlock extends GameMutation<EmptyParams> {
    isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        return useGameStateStore().activePlayer
    }

    getValidity(gameState: GameStateStore) {
        if (!gameState.action) {
            return Invalid('Must be applied during an action')
        }
        if (
            !(
                gameState.action.blockingMinion instanceof Card &&
                gameState.action.blockingMinion.isMinion()
            )
        ) {
            return Invalid('Need a blocking minion to resolve a block')
        }
        return VALID
    }

    protected updateGameState(gameState: GameStateStore) {
        if (!gameState.action) {
            throw new Error('gameState.action is null')
        }
        if (!gameState.action.blockingMinion) {
            throw new Error('gameState.action.blockingDecision is null')
        }
        if (!gameState.activePlayer) {
            throw new Error('gameState.activePlayer is null')
        }

        const action = gameState.action
        const blockingMinion = action.blockingMinion as Minion

        // Successful block
        if (action.intercept >= action.stealth) {
            this.previousState.isBlockSuccessful = true
            blockingMinion.lock()

            // start combat
            gameState.combat = new CombatState(
                new CombatantMinion(gameState.action.actingMinion),
                new CombatantMinion(blockingMinion),
            )

            /**
             * VERY TEMPORARY, handle combat as two hand strike for 1
             * TODO: remove this
             */
            gameState.combat.acting.inflictDamage(1)
            gameState.combat.defending.inflictDamage(1)
            gameState.combat = null
            /**
             * END OF TEMPORARY
             */

            gameState.action = null
            useCoreStore().conductor?.onActionResolve()
        }
        // Failed block
        else {
            this.previousState.isBlockSuccessful = false

            action.blockingDecision = null
            action.impulsePlayer = gameState.activePlayer
            action.intercept = 0
        }
    }

    formatForLog() {
        return this.previousState.isBlockSuccessful ?
                `Block successful. !! TEMPORARY !! : Combat resolved as hand strikes for 1`
            :   `Block failed`
    }
}

/**
 * UI : Target Declaration ( Arrow )
 */

interface TargetDeclarationParams extends GameMutationParams {
    origin: Card
    target: Card | Player
}

interface TargetDeclarationsParams extends GameMutationParams {
    targetDeclarations: TargetDeclaration[]
}

class AddTargetDeclaration extends GameMutation<TargetDeclarationParams> {
    readonly syncMode = MutationSyncMode.Ordered

    protected get _versioningId(): VersioningId {
        return VersioningTarget.TargetDeclaration
    }

    get card() {
        return this.params.target instanceof Card ? this.params.target : null
    }

    protected updateGameState(gameState: GameStateStore) {
        gameState.targetDeclarations.push({
            originOid: this.params.origin.oid,
            targetOid: this.params.target.oid,
        })
    }

    formatForLog() {
        if (this.params.target instanceof Card) {
            return `Declare target ${CARD_LOG_PLACEHOLDER} for ${this.params.origin.name} `
        } else {
            return `Declare target ${this.params.target.name} for ${this.params.origin.name} `
        }
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.UI_removeTargetDeclaration.createCancelMutation(this, {
            origin: this.params.origin,
            target: this.params.target,
        })
    }
}

class RemoveTargetDeclaration extends GameMutation<TargetDeclarationParams> {
    readonly syncMode = MutationSyncMode.Ordered

    protected get _versioningId(): VersioningId {
        return VersioningTarget.TargetDeclaration
    }

    get card() {
        return this.params.target instanceof Card ? this.params.target : null
    }

    protected updateGameState(gameState: GameStateStore) {
        gameState.targetDeclarations = gameState.targetDeclarations.filter(
            arrow =>
                arrow.originOid != this.params.origin.oid ||
                arrow.targetOid != this.params.target.oid,
        )
    }

    formatForLog() {
        return `Remove target ${CARD_LOG_PLACEHOLDER}`
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.UI_addTargetDeclaration.createCancelMutation(this, {
            origin: this.params.origin,
            target: this.params.target,
        })
    }
}

class ChangeTargetDeclaration extends GameMutation<TargetDeclarationsParams> {
    readonly syncMode = MutationSyncMode.Ordered

    protected get _versioningId(): VersioningId {
        return VersioningTarget.TargetDeclaration
    }

    protected updateGameState(gameState: GameStateStore) {
        this.previousState.targetDeclarations = [...gameState.targetDeclarations]
        gameState.targetDeclarations = this.params.targetDeclarations
    }

    formatForLog() {
        return this.params.targetDeclarations.length == 0 ? 'Clear targets' : 'Set targets'
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.UI_changeTargetDeclaration.createCancelMutation(this, {
            targetDeclarations: this.previousState.targetDeclarations as TargetDeclaration[],
        })
    }
}

/**
 * UI : Change scale
 */

interface ChangeScaleParams extends GameMutationParams {
    player: Player
    scale: number
}

class ChangeScale extends GameMutation<ChangeScaleParams> {
    readonly syncMode = MutationSyncMode.Merge
    isIgnoredForCancel = true

    protected get _versioningId(): VersioningId {
        return VersioningTarget.Scale
    }

    protected updateGameState() {
        this.params.player.scale = this.params.scale
    }
}

/**
 * UI : Timer
 */

interface TimerParams extends GameMutationParams {
    remainingTime: number
    date: Date
}

class StartTimer extends GameMutation<TimerParams> {
    readonly syncMode = MutationSyncMode.Ordered
    isIgnoredForCancel = true

    protected get _versioningId(): VersioningId {
        return VersioningTarget.Timer
    }

    protected updateGameState() {
        const timeDrift = Date.now() - this.params.date.getTime()
        useTimer().applyStartTimer(this.params.remainingTime - timeDrift)
    }

    formatForLog() {
        return `Start timer ( ${useTimer().formatTime(this.params.remainingTime)} )`
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.UI_pauseTimer.createCancelMutation(this, {
            remainingTime: this.params.remainingTime,
            date: this.params.date,
        })
    }
}

class PauseTimer extends GameMutation<TimerParams> {
    readonly syncMode = MutationSyncMode.Ordered
    isIgnoredForCancel = true

    protected get _versioningId(): VersioningId {
        return VersioningTarget.Timer
    }

    protected updateGameState() {
        useTimer().applyPauseTimer(this.params.remainingTime)
    }

    formatForLog() {
        return `Pause timer ( ${useTimer().formatTime(this.params.remainingTime)} )`
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.UI_startTimer.createCancelMutation(this, {
            remainingTime: this.params.remainingTime,
            date: this.params.date,
        })
    }
}

/**
 * UI : Ping Card
 */

class PingCard extends CardMutation {
    isIgnoredForCancel = true
    readonly syncMode = MutationSyncMode.Merge

    getValidity() {
        // Can apply only to cards in play
        return this.params.card.isIn.play ? VALID : Invalid('Cannot ping cards out of play')
    }

    protected updateGameState() {
        // This one is kinda special : we update the game bus instead of the game state
        useGameBusStore().pingCard(this.params.card.oid)
    }
}

/**
 * Mutation handling
 */

/**
 * Factory function to creates a new instance of a game mutation object.
 */
export function createMutation<
    ParamsType extends GameMutationParams,
    GMClass extends GameMutation<ParamsType>,
>(
    gameMutationClass: GameMutationClassType<ParamsType, GMClass>,
    author: Player,
    params: ParamsType,
    cancelsMutationId?: GameMutationId,
) {
    if (!params) {
        params = {} as ParamsType
    }
    return new gameMutationClass(params, new Date(), author, cancelsMutationId)
}

/**
 * Apply the mutation locally, if it's valid.
 */
export function applyMutationIfValid(gameMutation: AnyGameMutation) {
    const validity = gameMutation.canApply()
    if (validity.isValid) {
        gameMutation.apply()
    }
}

/**
 * In multiplayer, apply immediately.
 * With TrainBot, enqueue the mutation to maintain correct ordering.
 */
export function applyMutationLocally(gameMutation: AnyGameMutation) {
    if (useCoreStore().gameType == GameType.TrainBot) {
        enqueueBotMutation(gameMutation)
    } else {
        applyMutationIfValid(gameMutation)
    }
}

/**
 * If the mutation is valid, apply it locally AND broadcast it to other players.
 * Alert the user if the mutation is invalid.
 */
export function dispatchMutation(gameMutation: AnyGameMutation) {
    const core = useCoreStore()

    const validity = gameMutation.canApply()
    if (!validity.isValid) {
        useBusStore().alertWarning(validity.reason)
        return validity
    }

    applyMutationLocally(gameMutation)
    if (core.gameType == GameType.Multiplayer) {
        broadcastGameMutation(gameMutation)
    }

    return VALID
}

/**
 * A player act on the game : create the mutation and dispatch it.
 */
export function act<
    ParamsType extends GameMutationParams,
    GMClass extends GameMutation<ParamsType>,
>(
    gameMutationClass: GameMutationClassType<ParamsType, GMClass>,
    author: Player,
    params: ParamsType,
): Validity {
    const gameMutation = createMutation(gameMutationClass, author, params)
    return dispatchMutation(gameMutation)
}

/**
 * Shorthand when self player act on the game.
 */
export function actSelf<
    ParamsType extends GameMutationParams,
    GMClass extends GameMutation<ParamsType>,
>(gameMutationClass: GameMutationClassType<ParamsType, GMClass>, params: ParamsType): Validity {
    const gameState = useGameStateStore()
    // spectators can't act on the game
    if (gameState.isSpectator) {
        return Invalid("Spectators can't act on the game")
    }
    if (!gameState.selfPlayer) {
        throw new Error('Cannot act without a self player defined')
    }
    return act(gameMutationClass, gameState.selfPlayer, params)
}

/**
 * Constructor of GameMutation, needed for typescript annotations
 */
type GameMutationClassType<
    ParamsType extends GameMutationParams,
    GMClass extends GameMutation<ParamsType>,
> = new (
    params: ParamsType,
    timestamp: Date,
    author: Player,
    cancelsMutationId?: GameMutationId,
) => GMClass

/**
 * Mutation definition
 */
function defineMutation<
    ParamsType extends GameMutationParams,
    GMClass extends GameMutation<ParamsType>,
>(gameMutationClass: GameMutationClassType<ParamsType, GMClass>) {
    return {
        gameMutationClass,
        createMutation: (author: Player, params: ParamsType) =>
            createMutation(gameMutationClass, author, params),
        createCancelMutation: (cancels: AnyGameMutation, params: ParamsType) =>
            // Can only cancel own actions, so cancels.author is always selfPlayer
            createMutation(gameMutationClass, cancels.author, params, cancels.id),
        act: (author: Player, params: ParamsType) => act(gameMutationClass, author, params),
        actSelf: (params: ParamsType) => actSelf(gameMutationClass, params),
    }
}

/**
 * Register all mutations
 */

export const gameMutations = {
    changeBlood: defineMutation(ChangeBlood),
    changeGreenCounter: defineMutation(ChangeGreenCounter),
    changeMarker: defineMutation(ChangeMarker),
    changePool: defineMutation(ChangePool),
    changeTheEdgeControl: defineMutation(ChangeTheEdgeControl),
    discard: defineMutation(Discard),
    discardAtRandom: defineMutation(DiscardAtRandom),
    drawLibrary: defineMutation(DrawLibrary),
    drawCrypt: defineMutation(DrawCrypt),
    goToTurnPhase: defineMutation(GoToTurnPhase),
    goToTurn: defineMutation(GoToTurn),
    influence: defineMutation(Influence),
    moveCard: defineMutation(MoveCard),
    moveCardToRegion: defineMutation(MoveCardToRegion),
    moveToBottom: defineMutation(MoveToBottom),
    playFaceDown: defineMutation(PlayFaceDown),
    playFaceDownInverse: defineMutation(PlayFaceDownInverse),
    reveal: defineMutation(Reveal),
    setFlip: defineMutation(SetFlip),
    setLock: defineMutation(SetLock),
    shuffle: defineMutation(Shuffle),
    unlockAll: defineMutation(UnlockAll),
    unlockAllInverse: defineMutation(UnlockAllInverse),

    /**
     * Action mutations
     */
    ACTION_changeProperty: defineMutation(ChangeActionProperty),
    ACTION_declareAction: defineMutation(DeclareAction),
    ACTION_declareActionModifier: defineMutation(DeclareActionModifier),
    ACTION_declareBlock: defineMutation(DeclareBlock),
    ACTION_declareReaction: defineMutation(DeclareReaction),
    ACTION_resolveAction: defineMutation(ResolveAction),
    ACTION_resolveBlock: defineMutation(ResolveBlock),

    /**
     * UI mutations
     */
    UI_addTargetDeclaration: defineMutation(AddTargetDeclaration),
    UI_removeTargetDeclaration: defineMutation(RemoveTargetDeclaration),
    UI_changeTargetDeclaration: defineMutation(ChangeTargetDeclaration),
    UI_changeScale: defineMutation(ChangeScale),
    UI_startTimer: defineMutation(StartTimer),
    UI_pauseTimer: defineMutation(PauseTimer),
    UI_pingCard: defineMutation(PingCard),
}

// Set mutation name on each GameMutation subclasses
for (const [mutationName, mutationDefinition] of Object.entries(gameMutations)) {
    if (mutationName == 'action') {
        continue
    }
    mutationDefinition.gameMutationClass.prototype.mutationName = mutationName
}
