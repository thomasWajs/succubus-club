import { Player } from '@/shared/model/Player.ts'
import { CardRegion } from '@/shared/model/CardRegion.ts'
import { Card, Minion, PropertiesInPlay } from '@/shared/model/Card.ts'
import { ActionVerb, Marker, TurnSequence } from '@/shared/const/model.ts'
import {
    CARD_LOG_PLACEHOLDER,
    CONTROLLED_ZONE_HEIGHT,
    PLAY_AREA_WIDTH,
    TORPOR_ZONE_Y,
} from '@/shared/const/game.ts'
import {
    ActionModifier,
    ActionProperty,
    ALL_PLAYERS,
    ANY_PLAYER,
    CardRevelationTarget,
    CardRevelationViewer,
    GameType,
    getViewerKey,
    Invalid,
    MinionAction,
    MinionActionType,
    NO_ACTION_MODIFIER,
    NO_BLOCK,
    NO_REACTION,
    PlayerVision,
    TargetDeclaration,
    VALID,
    Validity,
} from '@/shared/types/state.ts'
import {
    MutationSyncMode,
    SerializedCard,
    VersioningId,
    VersioningTarget,
} from '@/shared/types/multiplayer.ts'
import { isRevealedToViewer, secureName } from '@/shared/state/cardVisibility.ts'
import { useTimer } from '@/shared/state/useTimer.ts'
import {
    createActionState,
    getBlockingMinion,
    passImpulse,
    regainImpulse,
} from '@/shared/state/actionState.ts'
import { createCombatState, inflictDamage } from '@/shared/state/combatState.ts'
import * as actions from '@/shared/state/minionActions.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { AnyCardRegion, CardOid, GameId } from '@/shared/types/model.ts'
import { getGameState, getMutationTrigger } from '@/shared/registries.ts'
import { hashObject, rehydrateCard, serializeObject } from '@/shared/serialization.ts'

export type GameMutationId = number
export interface GameMutationParams {
    [key: string]: unknown
}
export type AnyGameMutation = GameMutation<GameMutationParams>
export type GameMutationName = keyof typeof gameMutations

export abstract class GameMutation<ParamsType extends GameMutationParams> {
    readonly id: GameMutationId // Used to identify mutation when cancelling it
    abstract readonly syncMode: MutationSyncMode

    _isUserCancellable = true
    isIgnoredForCancel = false
    cancelToResolveConflict = false // will be set to true if the mutation is cancelled to resolve a conflict

    playerVision = {} as PlayerVision
    // Store as needed the previous state of the game to be able to make the cancel diff
    previousState = {} as { [key: string]: unknown }

    constructor(
        public gameId: GameId,
        public params: ParamsType,
        public timestamp: Date,
        public author: Player,
        public cancelsMutationId?: GameMutationId,
    ) {
        this.id = hashObject({
            t: this.timestamp.getTime(),
            a: this.author.oid,
            ...serializeObject(this.params),
        })
    }

    get name(): GameMutationName {
        // @ts-expect-error mutationName is injected by prototype
        return this.mutationName
    }

    get gameState() {
        return getGameState(this.gameId)
    }

    // To be overrided by subclasses when the mutation interact with a Card
    get card(): Card | null {
        return null
    }

    // To be overrided by subclasses which an Exclusive sync mode
    protected get allowedPlayer(): Player | typeof ANY_PLAYER | null | undefined {
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

    get isUserCancellable() {
        return this._isUserCancellable
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
            if (this.allowedPlayer != ANY_PLAYER && this.allowedPlayer != this.author) {
                return Invalid(
                    `${this.author.name} cannot apply ${this.name} to ${this.allowedPlayer.name}`,
                )
            }
        }

        if (this.gameState.isStrictGame) {
            const strictValidity = this.getStrictValidity(this.gameState)
            if (strictValidity != VALID) {
                strictValidity.reason = `[Strict game] ${strictValidity.reason}`
                return strictValidity
            }
        }

        // Mutation-specific validation
        return this.getValidity(this.gameState)
    }

    // To be overrided by subclasses with mutation-specific strict validation
    protected getStrictValidity(_gameState: GameState): Validity {
        return VALID
    }

    // To be overrided by subclasses with mutation-specific validation
    protected getValidity(_gameState: GameState): Validity {
        return VALID
    }

    apply() {
        // A player have vision on the card if it can see/peek the card
        // either before or after updating the gameState
        const visionBefore = this.card?.getPlayerVision() ?? { public: false }
        this.updateGameState(this.gameState)
        const visionAfter = this.card?.getPlayerVision() ?? { public: false }

        this.playerVision = {} as PlayerVision
        for (const playerOid in visionAfter) {
            this.playerVision[playerOid] = visionBefore[playerOid] || visionAfter[playerOid]
        }
    }

    protected abstract updateGameState(_gameState: GameState): void

    /**
     * Cancel
     */

    getCancelMutation(): AnyGameMutation {
        throw new Error('getCancelMutation is not implemented')
    }

    /**
     * Log Formatting
     */

    formatForLog(): string | null {
        return null
    }

    formatPlayerHand(player: Player) {
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
 * Become Minion / Vampire
 */

class BecomeMinion extends CardMutation {
    readonly syncMode = MutationSyncMode.Merge

    getValidity() {
        // Cannot apply if already a minion
        return this.params.card.isMinion() ? Invalid('Already an ally') : VALID
    }

    protected updateGameState() {
        this.params.card.becomeMinion()
    }

    formatForLog() {
        return `${CARD_LOG_PLACEHOLDER} become an ally`
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.becomeVampireInverse.createCancelMutation(this, {
            card: this.params.card,
        })
    }
}

class BecomeVampire extends CardMutation {
    readonly syncMode = MutationSyncMode.Merge

    getValidity() {
        // Cannot apply if already a minion
        return this.params.card.isVampire() ? Invalid('Already a vampire') : VALID
    }

    protected updateGameState() {
        this.params.card.becomeVampire()
    }

    formatForLog() {
        return `${CARD_LOG_PLACEHOLDER} become a vampire`
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
class BecomeVampireInverse extends CardMutation {
    readonly syncMode = MutationSyncMode.Merge

    protected updateGameState() {
        this.params.card.minionAttrs = undefined
        this.params.card.vampireAttrs = undefined
    }

    formatForLog() {
        return `${CARD_LOG_PLACEHOLDER} not a minion anymore`
    }
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
                `${secureName(this.params.card, this.author)} : Cannot change blood because it is not in play`,
            )

        // Cannot get a negative blood amount
        if (this.params.card.blood + this.params.amount < 0) {
            return Invalid(`${secureName(this.params.card, this.author)} : Cannot go below 0 blood`)
        }

        return VALID
    }

    protected updateGameState() {
        this.params.card.changeBlood(this.params.amount)
    }

    formatForLog() {
        const stateLog = `(now: ${this.params.card.blood})`
        return `${this.params.amount > 0 ? '+' : ''}${this.params.amount} blood on ${CARD_LOG_PLACEHOLDER} ${stateLog}`
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
                `${secureName(this.params.card, this.author)} : Cannot change counter because it is not in play`,
            )

        // Cannot get a negative counter amount
        if (this.params.card.greenCounter + this.params.amount < 0) {
            return Invalid(
                `${secureName(this.params.card, this.author)} : Cannot go below 0 counter`,
            )
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
 * Change Orange counter
 */

class ChangeOrangeCounter extends ChangeCounterMutation {
    readonly syncMode = MutationSyncMode.Merge

    getValidity() {
        // There's no counters outside of the play area
        if (!this.params.card.isIn.play)
            return Invalid(
                `${secureName(this.params.card, this.author)} : Cannot change counter because it is not in play`,
            )

        // Cannot get a negative counter amount
        if (this.params.card.orangeCounter + this.params.amount < 0) {
            return Invalid(
                `${secureName(this.params.card, this.author)} : Cannot go below 0 counter`,
            )
        }

        return VALID
    }

    protected updateGameState() {
        this.params.card.orangeCounter = Math.max(
            0,
            this.params.card.orangeCounter + this.params.amount,
        )
    }

    formatForLog() {
        return `${this.params.amount > 0 ? '+' : ''}${this.params.amount} orange counter on ${CARD_LOG_PLACEHOLDER}`
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.changeOrangeCounter.createCancelMutation(this, {
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

    getValidity() {
        // There's no markers outside of the play area
        if (!this.params.card.isIn.play)
            return Invalid(
                `${secureName(this.params.card, this.author)} : Cannot change marker because it is not in play`,
            )

        return VALID
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

    protected getStrictValidity(_gameState: GameState): Validity {
        if (this.params.player.oid != this.author.oid) {
            return Invalid(`Players can only change their own pool`)
        }

        return VALID
    }

    protected updateGameState() {
        this.params.player.changePool(this.params.amount)
    }

    formatForLog() {
        const stateLog = `(now: ${this.params.player.pool})`
        return `${this.params.amount > 0 ? '+' : ''}${this.params.amount} pool on ${this.params.player.name} ${stateLog}`
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

    protected updateGameState(gameState: GameState) {
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

    protected updateGameState(gameState: GameState) {
        this.previousState.position = this.params.card.position
        gameState.moveCardToRegion(this.params.card, this.params.card.owner.ashHeap)
        gameState.turnResources.dpa -= 1
    }

    formatForLog() {
        return `Discard ${CARD_LOG_PLACEHOLDER} ${this.formatPlayerHand(this.params.card.controller)}`
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

    protected updateGameState(gameState: GameState) {
        this.previousState.position = this.params.card.position
        gameState.moveCardToRegion(this.params.card, this.params.card.owner.ashHeap)
    }

    formatForLog() {
        return `Discard at random ${CARD_LOG_PLACEHOLDER} ${this.formatPlayerHand(this.params.card.controller)}`
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
        return `Draw Library ${this.formatPlayerHand(this.params.player)}`
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

    protected updateGameState(gameState: GameState) {
        this.previousState.turnNumber = gameState.turnNumber
        gameState.changeTurn(this.params.index)
    }

    formatForLog() {
        if (this.params.index > this.previousState.turnNumber) {
            return `Advance to turn ${this.gameState.turnNumber}`
        } else if (this.params.index < this.previousState.turnNumber) {
            return `Back to turn ${this.gameState.turnNumber}`
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

    protected updateGameState(gameState: GameState) {
        this.previousState.turnPhaseIndex = gameState.turnPhaseIndex
        gameState.turnPhaseIndex = this.params.index
        gameState.action = null
        gameState.combat = null
    }

    formatForLog() {
        return `Go to ${this.gameState.turnPhase} Phase`
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

    protected getStrictValidity(_gameState: GameState): Validity {
        if (this.params.card.owner?.oid != this.author.oid) {
            return Invalid(`Players can only influence their own cards`)
        }

        return VALID
    }

    protected updateGameState(gameState: GameState) {
        const card = this.params.card
        card.changeBlood(this.params.amount)
        card.controller.changePool(-this.params.amount)
        gameState.turnResources.transfers -= this.params.amount
    }

    formatForLog() {
        const stateLog = `(blood: ${this.params.card.blood} | pool: ${this.params.card.controller.pool})`
        return `Influence ${this.params.amount} on ${CARD_LOG_PLACEHOLDER} ${stateLog}`
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.influence.createCancelMutation(this, {
            card: this.params.card,
            amount: this.params.amount * -1,
        })
    }
}

/**
 * Move card inside the same region.
 * Use {x; y} when in play ( on the table ).
 * Use {position} when in a stack ( all other regions, including hand ).
 */

type MoveCardParams = CardMovement

class MoveCard extends GameMutation<MoveCardParams> {
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
        if (!this.params.card.isIn.play && this.params.card.owner?.oid != this.author.oid) {
            return Invalid(`Players can only reorder their own cards`)
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
        const previousPosition = (this.previousState.position ?? 0) as number
        return `Reorder ${this.params.card.region.name} : ${CARD_LOG_PLACEHOLDER} position ${previousPosition + 1} --> ${this.params.card.position + 1}`
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
}

class MoveCardToRegion extends GameMutation<MoveCardToRegionParams> {
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

    protected updateGameState(gameState: GameState) {
        const card = this.params.card

        const { isLocked, isFlipped, blood, greenCounter, orangeCounter, markers } = this.card
        this.previousState = {
            position: card.position,
            x: card.x,
            y: card.y,
            propsInPlay: { isLocked, isFlipped, blood, greenCounter, orangeCounter, markers },
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
                return `Play ${CARD_LOG_PLACEHOLDER}`
            }
            if (this.params.toCardRegion.is.ashHeap) {
                return `Discard ${CARD_LOG_PLACEHOLDER} ${this.formatPlayerHand(this.params.card.controller)}`
            }
        }

        return `Move ${CARD_LOG_PLACEHOLDER} from ${this.params.fromCardRegion.owner?.name}'s ${this.params.fromCardRegion.name} to ${this.params.toCardRegion.owner?.name}'s ${this.params.toCardRegion.name}`
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
        if (this.params.toCardRegion.is.library && this.params.card.isCrypt) {
            return Invalid(`Can move only library cards to ${this.params.toCardRegion.name}`)
        }

        // Can move only crypt cards to the crypt
        if (this.params.toCardRegion.is.crypt && !this.params.card.isCrypt) {
            return Invalid(`Can move only crypt cards to ${this.params.toCardRegion.name}`)
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

    protected getStrictValidity(_gameState: GameState): Validity {
        if (this.params.card.owner?.oid != this.author.oid) {
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
    protected updateGameState(gameState: GameState) {
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
            this.params.viewer === ALL_PLAYERS ? 'All players' : this.params.viewer.name

        const cardRegion =
            this.params.target instanceof CardRegion ?
                this.params.target
            :   this.params.target.region
        const cardRegionString = `${cardRegion.owner?.name}'s ${cardRegion.name}`

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

    protected getStrictValidity(_gameState: GameState): Validity {
        if (this.params.card.owner?.oid != this.author.oid) {
            return Invalid(`Players can only flip their own cards`)
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

class SetLock extends ChangeCardBoolMutation {
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
        if (this.params.cardRegion.owner?.oid != this.author.oid) {
            return Invalid(`Players can only shuffle their own cards`)
        }

        return VALID
    }

    protected updateGameState(gameState: GameState) {
        // If shuffledCards provided (server-side shuffle with new OIDs)
        if (this.params.shuffledCards) {
            // Move old cards to staleCards
            for (const oldOid of this.params.previousCardsOrder) {
                if (gameState.cards[oldOid]) {
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
        return `${this.cancelsMutationId ? 'Rewind shuffle' : 'Shuffle'} ${this.params.cardRegion.owner?.name}'s ${this.params.cardRegion.name}`
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

    getValidity(gameState: GameState) {
        return gameState.action ? VALID : Invalid('Must be applied during an action')
    }

    protected updateGameState(gameState: GameState) {
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
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        return this.gameState.activePlayer
    }

    get card(): Card | null {
        return this.params.minionAction.actingMinion
    }

    getValidity(gameState: GameState) {
        return gameState.action ? Invalid('An action is already in progress') : VALID
    }

    protected updateGameState(gameState: GameState) {
        this.params.minionAction.actingMinion.lock()
        gameState.action = createActionState(this.params.minionAction)
        actions.declare(this.params.minionAction)
    }

    formatForLog() {
        let actionVerb = ''
        let actionCard = ''
        if (
            this.params.minionAction.type == MinionActionType.ActionCardFromHand &&
            this.params.minionAction.card.type
        ) {
            actionVerb = `${ActionVerb[this.params.minionAction.card.type as keyof typeof ActionVerb]} `
        }
        if (this.params.minionAction.type == MinionActionType.ActionInPlay) {
            actionCard = ` ( ${this.params.minionAction.card.name} )`
        }
        return `Declare ${actionVerb}${actions.getName(this.params.minionAction)}${actionCard} with ${CARD_LOG_PLACEHOLDER}`
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.ACTION_declareActionInverse.createCancelMutation(this, {
            minionAction: this.params.minionAction,
        })
    }
}

class DeclareActionInverse extends GameMutation<DeclareActionParams> {
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        return this.params.minionAction.actingMinion.controller
    }

    protected updateGameState(gameState: GameState) {
        this.params.minionAction.actingMinion.unlock()
        gameState.action = null
    }

    formatForLog() {
        return `Cancel ${actions.getName(this.params.minionAction)}`
    }
}

/**
 * Action: Declare action modifier
 */

interface DeclareActionModifierParams extends GameMutationParams {
    actionModifier: ActionModifier | typeof NO_ACTION_MODIFIER
}

class DeclareActionModifier extends GameMutation<DeclareActionModifierParams> {
    _isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        return this.gameState.activePlayer
    }

    getValidity(gameState: GameState) {
        return gameState.action ? VALID : Invalid('Must be applied during an action')
    }

    protected updateGameState(gameState: GameState) {
        if (!gameState.action) {
            throw new Error('gameState.action is null')
        }
        passImpulse(gameState)
    }

    formatForLog() {
        if (this.params.actionModifier === NO_ACTION_MODIFIER) {
            return `No Action Modifier`
        } else {
            const am = this.params.actionModifier
            return `Action modifier : ${actions.getCardUsageDisplay(am.card, am.usage)}`
        }
    }

    get card() {
        return this.params.actionModifier == NO_ACTION_MODIFIER ?
                null
            :   this.params.actionModifier.card
    }
}

/**
 * Action: Declare block
 */

interface DeclareBlockParams extends GameMutationParams {
    blockingMinion: Minion | typeof NO_BLOCK
}

class DeclareBlock extends GameMutation<DeclareBlockParams> {
    _isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        return this.gameState.action?.impulsePlayer ?? null
    }

    getValidity(gameState: GameState) {
        return gameState.action ? VALID : Invalid('Must be applied during an action')
    }

    protected updateGameState(gameState: GameState) {
        if (!gameState.action) {
            throw new Error('gameState.action is null')
        }
        gameState.action.blockingDecision = this.params.blockingMinion
        regainImpulse(gameState)
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
    _isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        return this.gameState.action?.impulsePlayer ?? null
    }

    getValidity(gameState: GameState) {
        return gameState.action ? VALID : Invalid('Must be applied during an action')
    }

    protected updateGameState(gameState: GameState) {
        if (!gameState.action) {
            throw new Error('gameState.action is null')
        }
        passImpulse(gameState)
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
 * Action: End action
 */

class EndAction extends GameMutation<EmptyParams> {
    _isUserCancellable = false
    readonly syncMode = MutationSyncMode.Merge
    declare public previousState: { actionName: string }

    getValidity(gameState: GameState) {
        return gameState.action ? VALID : Invalid('Must be applied during an action')
    }

    protected updateGameState(gameState: GameState) {
        // Store for use formatForLog()
        if (gameState.action) {
            this.previousState.actionName = actions.getName(gameState.action.minionAction)
        }

        gameState.action = null
        gameState.targetDeclarations = []
    }

    formatForLog() {
        return `End ${this.previousState.actionName}`
    }
}

/**
 * Action: Resolve action
 */

export class ResolveAction extends GameMutation<EmptyParams> {
    _isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive
    declare public previousState: { actionName: string }

    get allowedPlayer() {
        return this.gameState.activePlayer
    }

    getValidity(gameState: GameState) {
        return gameState.action ? VALID : Invalid('Must be applied during an action')
    }

    protected updateGameState(gameState: GameState) {
        if (!gameState.action) {
            throw new Error('gameState.action is null')
        }
        // Store for use formatForLog()
        this.previousState.actionName = actions.getName(gameState.action.minionAction)
        actions.resolve(gameState.action.minionAction)
        gameState.action = null
    }

    formatForLog() {
        return `Resolve ${this.previousState.actionName}`
    }
}

/**
 * Action: Resolve block
 */

export class ResolveBlock extends GameMutation<EmptyParams> {
    _isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        return this.gameState.activePlayer
    }

    getValidity(gameState: GameState) {
        if (!gameState.action) {
            return Invalid('Must be applied during an action')
        }

        if (!getBlockingMinion(gameState)) {
            return Invalid('Need a blocking minion to resolve a block')
        }
        return VALID
    }

    protected updateGameState(gameState: GameState) {
        const action = gameState.action
        const blockingMinion = getBlockingMinion(gameState)

        if (!action) {
            throw new Error('gameState.action is null')
        }
        if (!gameState.activePlayer) {
            throw new Error('gameState.activePlayer is null')
        }
        if (!blockingMinion) {
            throw new Error('blockingMinion is null')
        }

        // Successful block
        if (action.intercept >= action.stealth) {
            this.previousState.isBlockSuccessful = true
            blockingMinion.lock()

            // start combat
            gameState.combat = createCombatState(action.minionAction.actingMinion, blockingMinion)

            /**
             * VERY TEMPORARY, handle combat as two hand strike for 1
             */
            inflictDamage(gameState.combat.acting, 1)
            inflictDamage(gameState.combat.defending, 1)
            gameState.combat = null
            /**
             * END OF TEMPORARY
             */

            gameState.action = null
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

    protected updateGameState(gameState: GameState) {
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

    protected updateGameState(gameState: GameState) {
        gameState.targetDeclarations = gameState.targetDeclarations.filter(
            (arrow: TargetDeclaration) =>
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

    protected updateGameState(gameState: GameState) {
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
 * UI : Change separators
 */

interface ChangeSeparatorsParams extends GameMutationParams {
    player: Player
    verticalX?: number
    horizontalY?: number
}

class ChangeSeparators extends GameMutation<ChangeSeparatorsParams> {
    readonly syncMode = MutationSyncMode.Merge
    isIgnoredForCancel = true

    protected get _versioningId(): VersioningId {
        return VersioningTarget.Separator
    }

    protected updateGameState() {
        if (this.params.verticalX) {
            this.params.player.separators.verticalX = this.params.verticalX
        }
        if (this.params.horizontalY) {
            this.params.player.separators.horizontalY = this.params.horizontalY
        }
    }
}

/**
 * UI : Timer
 */

interface TimerParams extends GameMutationParams {
    date: Date
}

class StartTimer extends GameMutation<TimerParams> {
    readonly syncMode = MutationSyncMode.Ordered
    isIgnoredForCancel = true

    protected get _versioningId(): VersioningId {
        return VersioningTarget.Timer
    }

    protected updateGameState() {
        useTimer(this.gameId).applyStartTimer(this.params.date)
    }

    formatForLog() {
        const timer = useTimer(this.gameId)
        return `Start timer ( ${timer.formatTime(timer.getRemainingTimeAt(this.params.date.getTime()))} )`
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
        useTimer(this.gameId).applyPauseTimer(this.params.date)
    }

    formatForLog() {
        const timer = useTimer(this.gameId)
        return `Pause timer ( ${timer.formatTime(timer.getRemainingTimeAt(this.params.date.getTime()))} )`
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

export class PingCard extends CardMutation {
    isIgnoredForCancel = true
    readonly syncMode = MutationSyncMode.Merge

    getValidity() {
        // Can apply only to cards in play
        return this.params.card.isIn.play ? VALID : Invalid('Cannot ping cards out of play')
    }

    protected updateGameState() {
        // This one is kinda special : we update the game bus instead of the game state
        // So we do nothing here
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
    return new gameMutationClass(author.gameId, params, new Date(), author, cancelsMutationId)
}

/**
 * Constructor of GameMutation, needed for typescript annotations
 */
export type GameMutationClassType<
    ParamsType extends GameMutationParams,
    GMClass extends GameMutation<ParamsType>,
> = new (
    gameId: GameId,
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
        act: (author: Player, params: ParamsType) =>
            getMutationTrigger().act(gameMutationClass, author, params),
        actSelf: (params: ParamsType) => getMutationTrigger().actSelf(gameMutationClass, params),
    }
}

/**
 * Random Result ( Coin Flip / Dice Roll )
 */

export interface RandomResultParams extends GameMutationParams {
    randomType: 'coin' | 'd6'
    result: number
}

export class RandomResult extends GameMutation<RandomResultParams> {
    readonly syncMode = MutationSyncMode.Merge
    isIgnoredForCancel = true

    protected updateGameState(): void {
        // No state change - this mutation only serves as a log/broadcast event
    }

    formatForLog() {
        if (this.params.randomType === 'coin') {
            const face = this.params.result === 1 ? 'Heads' : 'Tails'
            return `${this.author.name} flips a coin: ${face}`
        }
        return `${this.author.name} rolls a d6: ${this.params.result}`
    }
}

export const gameMutations = {
    becomeMinion: defineMutation(BecomeMinion),
    becomeVampire: defineMutation(BecomeVampire),
    becomeVampireInverse: defineMutation(BecomeVampireInverse),
    changeBlood: defineMutation(ChangeBlood),
    changeGreenCounter: defineMutation(ChangeGreenCounter),
    changeOrangeCounter: defineMutation(ChangeOrangeCounter),
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
    randomResult: defineMutation(RandomResult),
    unlockAll: defineMutation(UnlockAll),
    unlockAllInverse: defineMutation(UnlockAllInverse),

    /**
     * Action mutations
     */
    ACTION_changeProperty: defineMutation(ChangeActionProperty),
    ACTION_declareAction: defineMutation(DeclareAction),
    ACTION_declareActionInverse: defineMutation(DeclareActionInverse),
    ACTION_declareActionModifier: defineMutation(DeclareActionModifier),
    ACTION_declareBlock: defineMutation(DeclareBlock),
    ACTION_declareReaction: defineMutation(DeclareReaction),
    ACTION_endAction: defineMutation(EndAction),
    ACTION_resolveAction: defineMutation(ResolveAction),
    ACTION_resolveBlock: defineMutation(ResolveBlock),

    /**
     * UI mutations
     */
    UI_addTargetDeclaration: defineMutation(AddTargetDeclaration),
    UI_removeTargetDeclaration: defineMutation(RemoveTargetDeclaration),
    UI_changeTargetDeclaration: defineMutation(ChangeTargetDeclaration),
    UI_changeScale: defineMutation(ChangeScale),
    UI_changeSeparators: defineMutation(ChangeSeparators),
    UI_startTimer: defineMutation(StartTimer),
    UI_pauseTimer: defineMutation(PauseTimer),
    UI_pingCard: defineMutation(PingCard),
}

// Set mutation name on each GameMutation subclasses
for (const [mutationName, mutationDefinition] of Object.entries(gameMutations)) {
    mutationDefinition.gameMutationClass.prototype.mutationName = mutationName
}
