import { Player } from '@/model/Player.ts'
import { useHistoryStore } from '@/store/history.ts'
import { GameStateStore, useGameStateStore } from '@/store/gameState.ts'
import { AnyCardRegion, CardRegion } from '@/model/CardRegion.ts'
import { Card, CardOid, CryptCard, LibraryCard, Minion, Vampire } from '@/model/Card.ts'
import {
    DEFAULT_DPA,
    DEFAULT_MPA,
    DEFAULT_TRANSFERS,
    Marker,
    RegionName,
    TurnSequence,
} from '@/model/const.ts'
import { CONTROLLED_ZONE_HEIGHT, GRID_SIZE, PLAY_AREA_WIDTH } from '@/game/const.ts'
import {
    ActionProperty,
    ActionState,
    NO_ACTION_MODIFIER,
    NO_BLOCK,
    NO_REACTION,
} from '@/state/actionState.ts'
import { ActionCardAction, MinionAction } from '@/state/minionActions.ts'
import {
    ALL_PLAYERS,
    CardRevelationTarget,
    CardRevelationViewer,
    GameType,
    getViewerKey,
    Invalid,
    VALID,
    Validity,
} from '@/state/types.ts'
import { CombatantMinion, CombatState } from '@/state/combatState.ts'
import { useCoreStore } from '@/store/core.ts'
import { broadcastGameMutation } from '@/multiplayer/room.ts'
import { useBusStore } from '@/store/bus.ts'
import { BOT_PERM_ID } from '@/game/setup.ts'
import { MutationSyncMode, VersionningId, VersionningTarget } from '@/multiplayer/common.ts'
import { hashObject } from '@/gateway/serialization.ts'

export type GameMutationId = number
export interface GameMutationParams {
    [key: string]: unknown
}
export type AnyGameMutation = GameMutation<GameMutationParams>
export type GameMutationName = keyof typeof gameMutations

export abstract class GameMutation<ParamsType extends GameMutationParams> {
    readonly id: GameMutationId // Used to identify mutation when cancelling it
    abstract readonly syncMode: MutationSyncMode
    isCancellable = true

    canSeeTargetCard = false
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
    get targetCard(): Card | null {
        return null
    }

    // To be overrided by subclasses which an Exclusive sync mode
    protected get allowedPlayer(): Player | null {
        return null
    }

    get versioningId(): VersionningId {
        if (this.syncMode != MutationSyncMode.LWW) {
            throw new Error('versioningId is only available for LWW mutations')
        }
        return this._versioningId
    }
    protected get _versioningId(): VersionningId {
        return ''
    }

    /**
     * Apply
     */

    canApply(): Validity {
        // Ensure exclusive mutations are only applied by the correct player
        if (this.syncMode == MutationSyncMode.Exclusive) {
            if (this.allowedPlayer == null) {
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
        // We show the card name in the logs if we can see/peek the card
        // either before or after updating the gameState
        this.canSeeTargetCard = this.targetCard?.canSeeOrPeak() ?? false
        this.updateGameState(useGameStateStore())
        this.canSeeTargetCard = (this.canSeeTargetCard || this.targetCard?.canSeeOrPeak()) ?? false
        useHistoryStore().addGameMutation(this)
    }

    protected abstract updateGameState(_gameState: GameStateStore): void

    /**
     * Cancel
     */

    cancel() {
        if (!this.isCancellable) {
            throw new Error('Cannot cancel this type of mutation')
        }
        dispatchMutation(this.getCancelMutation())
    }

    protected getCancelMutation(): AnyGameMutation {
        throw new Error('getCancelMutation is not implemented')
    }

    /**
     * Log Formatting
     */

    formatForLog(): string | null {
        return null
    }

    formatCardForLog() {
        if (this.targetCard && this.canSeeTargetCard) {
            return `<span class="${this.targetCard.cssClass}">${this.targetCard.name}</span>`
        } else {
            return '<span class="hidden">hidden card</span>'
        }
    }

    formatPlayerStateForLog(player: Player) {
        return `(hand: ${player.hand.length} | lib: ${player.library.length})`
    }
}

/**
 * Common Params
 */

type EmptyParams = GameMutationParams

interface TargetCardParams extends GameMutationParams {
    card: Card
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

interface TargetPlayerParams extends GameMutationParams {
    player: Player
}

// Used for turnIndex and turnPhaseIndex
interface ChangeIndexParams extends GameMutationParams {
    index: number
}

/**
 * Abstract Mutations
 */

abstract class TargetCardMutation extends GameMutation<TargetCardParams> {
    get targetCard() {
        return this.params.card
    }
}

abstract class ChangeCounterMutation extends GameMutation<ChangeCounterParams> {
    get targetCard() {
        return this.params.card
    }
}

abstract class ChangeCardBoolMutation extends GameMutation<ChangeCardBoolParams> {
    get targetCard() {
        return this.params.card
    }
}

abstract class TargetPlayerMutation extends GameMutation<TargetPlayerParams> {}

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
        // Cannot get a negative blood amount
        return this.params.card.blood + this.params.amount < 0 ?
                Invalid(`${this.params.card.secureName} : Cannot go below 0 blood`)
            :   VALID
    }

    protected updateGameState() {
        this.params.card.changeBlood(this.params.amount)
    }

    formatForLog() {
        return `${this.params.amount > 0 ? '+' : ''}${this.params.amount} blood on ${this.formatCardForLog()}`
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
        // Cannot get a negative counter amount
        return this.params.card.greenCounter + this.params.amount < 0 ?
                Invalid(`${this.params.card.secureName} : Cannot go below 0 green counter`)
            :   VALID
    }

    protected updateGameState() {
        this.params.card.greenCounter = Math.max(
            0,
            this.params.card.greenCounter + this.params.amount,
        )
    }

    formatForLog() {
        return `${this.params.amount > 0 ? '+' : ''}${this.params.amount} green counter on ${this.formatCardForLog()}`
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
    readonly syncMode = MutationSyncMode.LWW

    protected get _versioningId(): VersionningId {
        return `${VersionningTarget.Marker}-${this.params.card.oid}-${this.params.marker}`
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
        return `${this.params.operation} ${this.params.marker} on ${this.formatCardForLog()}`
    }

    get targetCard() {
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
    newController: Player | undefined
}

class ChangeTheEdgeControl extends GameMutation<ChangeTheEdgeControlParams> {
    readonly syncMode = MutationSyncMode.LWW

    protected get _versioningId(): VersionningId {
        return `${VersionningTarget.TheEdge}`
    }

    getValidity() {
        return (
                this.params.newController &&
                    this.params.newController.oid == useGameStateStore().theEdgeControllerOid
            ) ?
                Invalid(`${this.params.newController.name} : Already controls the Edge`)
            :   VALID
    }

    protected updateGameState(gameState: GameStateStore) {
        this.previousState.oldController = gameState.theEdgeController
        gameState.theEdgeControllerOid = this.params.newController?.oid
    }

    formatForLog() {
        if (this.params.newController === undefined) {
            return `Burn the Edge`
        } else {
            return `${this.params.newController.name} gain the Edge`
        }
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.changeTheEdgeControl.createCancelMutation(this, {
            newController: this.previousState.oldController as Player | undefined,
        })
    }
}

/**
 * Discard
 */

class Discard extends TargetCardMutation {
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        return this.params.card.controller
    }

    getValidity() {
        // Cannot apply if target card is not in the hand
        return this.params.card.region.name == RegionName.Hand ?
                VALID
            :   Invalid('Discarded card must come from the hand')
    }

    protected updateGameState(gameState: GameStateStore) {
        this.previousState.position = this.params.card.position
        gameState.moveCardToRegion(this.params.card, this.params.card.controller.ashHeap)
        gameState.turnResources.dpa -= 1
    }

    formatForLog() {
        return `Discard ${this.formatCardForLog()} ${this.formatPlayerStateForLog(this.params.card.controller)}`
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.moveCardToRegion.createCancelMutation(this, {
            card: this.params.card,
            fromCardRegion: this.params.card.region,
            toCardRegion: this.params.card.controller.hand,
            position: this.previousState.position as number,
        })
    }
}

/**
 * Discard at random ( from library )
 */

class DiscardAtRandom extends TargetCardMutation {
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        return this.params.card.controller
    }

    getValidity() {
        // Cannot apply if target card is not in the hand
        return this.params.card.region.name == RegionName.Hand ?
                VALID
            :   Invalid('Discarded card must come from the hand')
    }

    protected updateGameState(gameState: GameStateStore) {
        this.previousState.position = this.params.card.position
        gameState.moveCardToRegion(this.params.card, this.params.card.controller.ashHeap)
    }

    formatForLog() {
        return `Discard at random ${this.formatCardForLog()} ${this.formatPlayerStateForLog(this.params.card.controller)}`
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.moveCardToRegion.createCancelMutation(this, {
            card: this.params.card,
            fromCardRegion: this.params.card.region,
            toCardRegion: this.params.card.controller.hand,
            position: this.previousState.position as number,
        })
    }
}

/**
 * Draw Crypt
 */
class DrawCrypt extends TargetPlayerMutation {
    readonly syncMode = MutationSyncMode.Exclusive

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
        card.setCoordinates(PLAY_AREA_WIDTH / 2, CONTROLLED_ZONE_HEIGHT)

        this.previousState.cardDrawed = card
    }

    formatForLog() {
        return `Draw Crypt (uncontrolled: ${this.params.player.uncontrolled.length} | crypt: ${this.params.player.crypt.length})`
    }

    getCancelMutation(): AnyGameMutation {
        const card = this.previousState.cardDrawed as Card
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
class DrawLibrary extends TargetPlayerMutation {
    readonly syncMode = MutationSyncMode.Exclusive

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
        this.previousState.cardDrawed = card
        gameState.moveCardToRegion(card, this.params.player.hand)
    }

    formatForLog() {
        return `Draw Library ${this.formatPlayerStateForLog(this.params.player)}`
    }

    getCancelMutation(): AnyGameMutation {
        const card = this.previousState.cardDrawed as Card
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
    readonly syncMode = MutationSyncMode.LWW

    protected get _versioningId(): VersionningId {
        return `${VersionningTarget.Turn}`
    }

    getValidity() {
        if (this.params.index < 1) {
            return Invalid(`Invalid turn number ${this.params.index}`)
        }

        return VALID
    }

    forward = false
    backward = false
    protected updateGameState(gameState: GameStateStore) {
        this.previousState.turnNumber = gameState.turnNumber

        // The turn didn't change, nothing to do
        if (this.params.index == gameState.turnNumber) {
            return
        } else {
            // Will normally be 1 or -1
            const delta = this.params.index - gameState.turnNumber
            gameState.turnNumber = this.params.index
            gameState.activePlayerIndex =
                (gameState.activePlayerIndex + delta + gameState.competingPlayers.length) %
                gameState.competingPlayers.length

            // Forward
            if (delta > 0) {
                this.forward = true
                gameState.turnPhaseIndex = 0
                gameState.turnResources = {
                    mpa: DEFAULT_MPA,
                    transfers: Math.min(DEFAULT_TRANSFERS, gameState.turnNumber),
                    dpa: DEFAULT_DPA,
                }
            }
            // Backward
            else {
                this.backward = true
                gameState.turnPhaseIndex = 4
            }
        }
    }

    formatForLog() {
        if (this.forward) {
            return `Advance to turn ${useGameStateStore().turnNumber}`
        } else if (this.backward) {
            return `Back to turn ${useGameStateStore().turnNumber}`
        }
        return null
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.goToTurn.createCancelMutation(this, {
            index: this.previousState.turnNumber as number,
        })
    }
}

class GoToTurnPhase extends GameMutation<ChangeIndexParams> {
    readonly syncMode = MutationSyncMode.LWW

    protected get _versioningId(): VersionningId {
        return `${VersionningTarget.TurnPhase}`
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
            index: this.previousState.turnPhaseIndex as number,
        })
    }
}

/**
 * Influence
 */

class Influence extends ChangeCounterMutation {
    readonly syncMode = MutationSyncMode.Merge

    getValidity() {
        if (this.params.card.region.name != RegionName.Uncontrolled) {
            return Invalid('Influence must be done on uncontrolled vampires')
        }
        return VALID
    }

    protected updateGameState(gameState: GameStateStore) {
        const core = useCoreStore()

        const minion = this.params.card
        minion.changeBlood(this.params.amount)
        minion.controller.changePool(-this.params.amount)
        gameState.turnResources.transfers -= this.params.amount

        // TODO : Move this to Conductor/Bot
        // Special case for TrainBot : move full vampire to controlled region
        if (
            core.gameType == GameType.TrainBot &&
            minion.controller.permId.startsWith(BOT_PERM_ID)
        ) {
            // In this case, we know it's a vampire, so we can cast it
            const vampire = minion as Vampire
            if (vampire.blood == vampire.capacity) {
                vampire.setCoordinates(
                    GRID_SIZE * 6 * vampire.controller.controlled.cards.length,
                    GRID_SIZE * 6,
                )
                gameState.moveCardToRegion(vampire, vampire.controller.controlled)
            }
        }
    }

    formatForLog() {
        return `Influence ${this.params.amount} on ${this.formatCardForLog()}`
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
    isCancellable = false
    readonly syncMode = MutationSyncMode.LWW

    protected get _versioningId(): VersionningId {
        return `${VersionningTarget.Move}-${this.params.card.oid}`
    }

    getValidity() {
        return validateCardMovement(this.params, this.params.card.region)
    }

    protected updateGameState() {
        if (this.params.position != undefined) {
            this.params.card.region.move(this.params.card, this.params.position)
        }
        if (this.params.x != undefined && this.params.y != undefined) {
            this.params.card.setCoordinates(this.params.x, this.params.y)
        }
    }

    get targetCard() {
        return this.params.card
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
    readonly syncMode = MutationSyncMode.LWW

    protected get _versioningId(): VersionningId {
        return `${VersionningTarget.Move}-${this.params.card.oid}`
    }

    getValidity() {
        // Cannot apply if card is already there
        if (this.params.toCardRegion.oid == this.params.card.region.oid) {
            return Invalid(`Card is already in ${this.params.toCardRegion.name}`)
        }

        // Can move only library cards to the hand and the library
        if (
            [RegionName.Hand, RegionName.Library].includes(this.params.toCardRegion.name) &&
            !(this.params.card instanceof LibraryCard)
        ) {
            return Invalid(`Can move only library cards to ${this.params.toCardRegion.name}`)
        }

        // Can move only crypt cards to the crypt
        if (
            this.params.toCardRegion.name == RegionName.Crypt &&
            !(this.params.card instanceof CryptCard)
        ) {
            return Invalid(`Can move only crypt cards to ${this.params.toCardRegion.name}`)
        }

        return validateCardMovement(this.params, this.params.toCardRegion)
    }

    protected updateGameState(gameState: GameStateStore) {
        this.previousState = {
            position: this.params.card.position,
            x: this.params.card.x,
            y: this.params.card.y,
        }

        gameState.moveCardToRegion(this.params.card, this.params.toCardRegion, this.params.position)
        if (this.params.x != undefined && this.params.y != undefined) {
            this.params.card.setCoordinates(this.params.x, this.params.y)
        }
    }

    formatForLog() {
        if (this.params.fromCardRegion.name === RegionName.Hand) {
            if (this.params.toCardRegion.name === RegionName.Controlled) {
                return `Play ${this.formatCardForLog()}`
            }
            if (this.params.toCardRegion.name === RegionName.AshHeap) {
                return `Discard ${this.formatCardForLog()} ${this.formatPlayerStateForLog(this.params.card.controller)}`
            }
        }

        return `Move ${this.formatCardForLog()} from ${this.params.fromCardRegion.owner.name}'s ${this.params.fromCardRegion.name} to ${this.params.toCardRegion.owner.name}'s ${this.params.toCardRegion.name}`
    }

    get targetCard() {
        return this.params.card
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.moveCardToRegion.createCancelMutation(this, {
            card: this.params.card,
            fromCardRegion: this.params.toCardRegion,
            toCardRegion: this.params.fromCardRegion,
            position: this.previousState.position as number,
            x: this.previousState.x as number,
            y: this.previousState.y as number,
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
    readonly syncMode = MutationSyncMode.LWW

    protected get _versioningId(): VersionningId {
        return `${VersionningTarget.Move}-${this.params.card.oid}`
    }

    getValidity() {
        // Can only send to the bottom of library and crypt
        if (![RegionName.Library, RegionName.Crypt].includes(this.params.toCardRegion.name)) {
            return Invalid(`Can only move to the bottom of library or crypt`)
        }

        // Can move only library cards to the the library
        if (
            this.params.toCardRegion.name == RegionName.Library &&
            !(this.params.card instanceof LibraryCard)
        ) {
            return Invalid(`Can move only library cards to ${this.params.toCardRegion.name}`)
        }

        // Can move only crypt cards to the crypt
        if (
            this.params.toCardRegion.name == RegionName.Crypt &&
            !(this.params.card instanceof CryptCard)
        ) {
            return Invalid(`Can move only crypt cards to ${this.params.toCardRegion.name}`)
        }

        return VALID
    }

    protected updateGameState(gameState: GameStateStore) {
        this.previousState = {
            fromCardRegion: this.params.card.region,
            position: this.params.card.position,
            x: this.params.card.x,
            y: this.params.card.y,
        }

        // The card is already in the correct region, move it inside the region
        if (this.params.toCardRegion.oid == this.params.card.region.oid) {
            this.params.card.region.move(this.params.card, this.params.toCardRegion.length)
        }
        // The card comes from another region, move it to the target region
        else {
            gameState.moveCardToRegion(
                this.params.card,
                this.params.toCardRegion,
                this.params.toCardRegion.length,
            )
        }
    }

    formatForLog() {
        return `Move ${this.formatCardForLog()} to the bottom of ${this.params.toCardRegion.name}`
    }

    get targetCard() {
        return this.params.card
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.moveCardToRegion.createCancelMutation(this, {
            card: this.params.card,
            fromCardRegion: this.params.toCardRegion,
            toCardRegion: this.previousState.fromCardRegion as AnyCardRegion,
            position: this.previousState.position as number,
            x: this.previousState.x as number,
            y: this.previousState.y as number,
        })
    }
}

/**
 * Play Face Down
 */

class PlayFaceDown extends TargetCardMutation {
    readonly syncMode = MutationSyncMode.LWW

    protected get _versioningId(): VersionningId {
        return `${VersionningTarget.Move}-${this.params.card.oid}`
    }

    protected updateGameState(gameState: GameStateStore) {
        this.previousState = {
            fromCardRegion: this.params.card.region,
            position: this.params.card.position,
            x: this.params.card.x,
            y: this.params.card.y,
        }

        this.params.card.flip()
        gameState.moveCardToRegion(this.params.card, this.params.card.controller.controlled)
        this.params.card.setCoordinates(PLAY_AREA_WIDTH / 2, CONTROLLED_ZONE_HEIGHT / 2)
    }

    formatForLog() {
        return `Play ${this.formatCardForLog()} Face Down `
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.playFaceDownInverse.createCancelMutation(this, {
            card: this.params.card,
            fromCardRegion: this.params.card.controller.controlled,
            toCardRegion: this.previousState.fromCardRegion as AnyCardRegion,
            position: this.previousState.position as number,
            x: this.previousState.x as number,
            y: this.previousState.y as number,
        })
    }
}

// This is a bit silly, but there's no existing mutation
// that can represent the inverse of PlayFaceDown
// because of the flip + movement
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
    // Should this be a Merge Sync ?
    readonly syncMode = MutationSyncMode.LWW

    protected get _versioningId(): VersionningId {
        return `${VersionningTarget.Reveal}-${this.params.target.oid}`
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
        const gameState = useGameStateStore()

        const viewerString =
            this.params.viewer === ALL_PLAYERS ? 'All players' : this.params.viewer.name

        const cardRegion =
            this.params.target instanceof CardRegion ?
                this.params.target
            :   this.params.target.region
        const cardRegionString = `${cardRegion.owner.name}'s ${cardRegion.name}`

        let verb, particle
        if (gameState.isRevealed(this.params.target, this.params.viewer)) {
            verb = 'Reveal'
            particle = 'to'
        } else {
            verb = 'Conceal'
            particle = 'from'
        }

        if (this.params.target instanceof CardRegion) {
            return `${verb} ${cardRegionString} ${particle} ${viewerString}`
        } else {
            return `${verb} 1 card of ${cardRegionString} ${particle} ${viewerString}`
        }
    }

    get targetCard() {
        return this.params.target instanceof Card ? this.params.target : null
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.reveal.createCancelMutation(this, {
            target: this.params.target,
            viewer: this.previousState.viewer as CardRevelationViewer,
        })
    }
}

/**
 * Flip a card
 */

class SetFlip extends ChangeCardBoolMutation {
    readonly syncMode = MutationSyncMode.Merge

    protected get _versioningId(): VersionningId {
        return `${VersionningTarget.Flip}-${this.params.card.oid}`
    }

    getValidity() {
        // Can flip only in controlled and torpor
        return [RegionName.Controlled, RegionName.Torpor].includes(this.params.card.region.name) ?
                VALID
            :   Invalid(`Cannot flip in ${this.params.card.region.name}`)
    }

    protected updateGameState() {
        this.previousState.isFlipped = this.params.card.isFlipped
        this.params.card.isFlipped = this.params.newValue
    }

    formatForLog() {
        return `Flip ${this.formatCardForLog()}`
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.setFlip.createCancelMutation(this, {
            card: this.params.card,
            newValue: this.previousState.isFlipped as boolean,
        })
    }
}

/**
 * Lock / Unlock a card
 */

class SetLock extends ChangeCardBoolMutation {
    readonly syncMode = MutationSyncMode.LWW

    protected get _versioningId(): VersionningId {
        return `${VersionningTarget.ChangeLock}-${this.params.card.oid}`
    }

    getValidity() {
        // Can lock/unlock only in controlled and torpor
        return [RegionName.Controlled, RegionName.Torpor].includes(this.params.card.region.name) ?
                VALID
            :   Invalid(`Cannot lock/unlock in ${this.params.card.region.name}`)
    }

    protected updateGameState() {
        this.previousState.isLocked = this.params.card.isLocked
        this.params.card.isLocked = this.params.newValue
    }

    formatForLog() {
        return `${this.params.card.isLocked ? 'Lock' : 'Unlock'} ${this.formatCardForLog()}`
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
    newCardsOrder: CardOid[]
}

class Shuffle extends GameMutation<ShuffleParams> {
    isCancellable = false
    readonly syncMode = MutationSyncMode.LWW

    protected get _versioningId(): VersionningId {
        return `${VersionningTarget.Shuffle}-${this.params.cardRegion.oid}`
    }

    protected updateGameState() {
        this.params.cardRegion.cardsOid = this.params.newCardsOrder
    }

    formatForLog() {
        return `Shuffle ${this.params.cardRegion.owner.name}'s ${this.params.cardRegion.name}`
    }
}

/**
 * Unlock ALl
 */
class UnlockAll extends TargetPlayerMutation {
    isCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        return this.params.player
    }

    protected updateGameState() {
        for (const cardRegion of this.params.player.allCardRegions) {
            for (const card of cardRegion.cards) {
                card.unlock()
            }
        }
    }

    formatForLog() {
        return `Unlock All`
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
    isCancellable = false
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
        return `Declare ${this.params.minionAction.name} with ${this.formatCardForLog()}`
    }

    get targetCard(): Card | null {
        return this.params.minionAction.actingMinion
    }
}

/**
 * Action: Declare action modifier
 */

interface DeclareActionModifierParams extends GameMutationParams {
    actionModifier: Card | NO_ACTION_MODIFIER
}

class DeclareActionModifier extends GameMutation<DeclareActionModifierParams> {
    isCancellable = false
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
            return `Action modifier : ${this.formatCardForLog()}`
        }
    }

    get targetCard() {
        return this.params.actionModifier instanceof Card ? this.params.actionModifier : null
    }
}

/**
 * Action: Declare block
 */

// TODO: handle multiple player who declines ( prey/predator)
interface DeclareBlockParams extends GameMutationParams {
    blockingMinion: Minion | NO_BLOCK
}

class DeclareBlock extends GameMutation<DeclareBlockParams> {
    isCancellable = false
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
            return `Block attempt with ${this.formatCardForLog()}`
        }
    }

    get targetCard() {
        return this.params.blockingMinion instanceof Card ? this.params.blockingMinion : null
    }
}

/**
 * Action: Declare reaction
 */

interface DeclareReactionParams extends GameMutationParams {
    reaction: Card | NO_REACTION
}

class DeclareReaction extends GameMutation<DeclareReactionParams> {
    isCancellable = false
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
            return `Reaction : ${this.formatCardForLog()}`
        }
    }

    get targetCard() {
        return this.params.reaction instanceof Card ? this.params.reaction : null
    }
}

/**
 * Action: Resolve action
 */

class ResolveAction extends GameMutation<EmptyParams> {
    isCancellable = false
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
    }

    formatForLog() {
        return `Resolve ${this.minionActionName}`
    }
}

/**
 * Action: Resolve block
 */

class ResolveBlock extends GameMutation<EmptyParams> {
    isCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        return useGameStateStore().activePlayer
    }

    getValidity(gameState: GameStateStore) {
        if (!gameState.action) {
            return Invalid('Must be applied during an action')
        }
        if (!(gameState.action.blockingMinion instanceof Minion)) {
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

        const action = gameState.action
        const blockingMinion = action.blockingMinion as Minion

        // Successful block
        if (action.intercept >= action.stealth) {
            this.previousState.isBlockSuccessful = true

            if (gameState.action.minionAction instanceof ActionCardAction) {
                gameState.action.minionAction.sendCardToAshHeap()
            }

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
            gameState.action.actingMinion.inflictDamage(1)
            blockingMinion.inflictDamage(1)
            gameState.combat = null
            /**
             * END OF TEMPORARY
             */

            gameState.action = null
        }
        // Failed block
        else {
            this.previousState.isBlockSuccessful = true

            action.blockingDecision = null
            action.impulsePlayer = gameState.activePlayer
            action.intercept = 0
        }
    }

    formatForLog() {
        return this.previousState.isBlockSuccessful ? `Block successful` : `Block failed`
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
export function applyMutationLocally(gameMutation: AnyGameMutation) {
    const core = useCoreStore()

    const validity = gameMutation.canApply()
    if (validity.isValid) {
        gameMutation.apply()
    }

    // Is this the best place to put that ?
    // Replace with a watch ? Or an event ?
    if (core.gameType == GameType.TrainBot) {
        core.conductor?.runDecisionMaking()
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
}

// Set mutation name on each GameMutation subclasses
for (const [mutationName, mutationDefinition] of Object.entries(gameMutations)) {
    if (mutationName == 'action') {
        continue
    }
    mutationDefinition.gameMutationClass.prototype.mutationName = mutationName
}
