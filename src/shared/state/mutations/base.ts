import { Player } from '@/shared/model/Player.ts'
import { Card, CounterColor } from '@/shared/model/Card.ts'
import { ANY_PLAYER, Invalid, PlayerVision, VALID, Validity } from '@/shared/types/state.ts'
import { MutationSyncMode, VersioningId } from '@/shared/types/multiplayer.ts'
import { AnyCardRegion, GameId } from '@/shared/types/model.ts'
import { interruptsReferendumLastCall } from '@/shared/state/gameplay/referendumState.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { getGameState } from '@/shared/registries.ts'
import { hashObject, serializeObject } from '@/shared/serialization.ts'
import { LogDetail, LogGroup } from '@/shared/types/history.ts'
import { ActionLineFold } from '@/shared/state/history/mutationLog.ts'
import type { gameMutations } from '@/shared/state/gameMutations.ts'

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
            // Undoing a group creates several identical cancels in the same millisecond
            ...(cancelsMutationId !== undefined ? { _c: cancelsMutationId } : {}),
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

        interruptsReferendumLastCall(this)

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

    // State infos shown apart from the log text, right after the mutation is applied
    formatLogDetails(): LogDetail[] | null {
        return null
    }

    // Counter changes : consecutive changes of the same group make a single log line
    get logGroup(): LogGroup | null {
        return null
    }

    // Completes the action in progress : shown in the line of its declaration, replacing its
    // text ( the whole declaration logged again ) or silently ( the card played for it )
    get actionLineFold(): ActionLineFold {
        return null
    }

    // After a draw : the hand and the library left
    playerHandDetails(player: Player): LogDetail[] {
        return [
            ...this.handSizeDetails(player),
            { label: 'lib', value: `${player.library.length}` },
        ]
    }

    // After a discard
    handSizeDetails(player: Player): LogDetail[] {
        return [{ label: 'hand', value: `${player.hand.length}` }]
    }
}

/**
 * Common Params
 */

export type EmptyParams = GameMutationParams

export interface CardParams extends GameMutationParams {
    card: Card
}

export interface CardsListParams extends GameMutationParams {
    cards: Card[]
}

// Used to change blood/life/green counters ( blood and life share the same counter )
interface ChangeCounterParams extends GameMutationParams {
    card: Card
    amount: number
}

export interface ChangeColoredCounterParams extends ChangeCounterParams {
    color: CounterColor
}

// Used to flip or lock a card
interface ChangeCardBoolParams extends GameMutationParams {
    card: Card
    newValue: boolean
}

export interface PlayerParams extends GameMutationParams {
    player: Player
}

// Used for turnIndex and turnPhaseIndex
export interface ChangeIndexParams extends GameMutationParams {
    index: number
}

/**
 * Abstract Mutations
 */

export abstract class CardMutation extends GameMutation<CardParams> {
    get card() {
        return this.params.card
    }
}

export abstract class ChangeCounterMutation<
    P extends ChangeCounterParams = ChangeCounterParams,
> extends GameMutation<P> {
    get card() {
        return this.params.card
    }

    protected getStrictValidity(_gameState: GameState): Validity {
        if (this.params.card.controllerOid != this.author.oid) {
            return Invalid(`Players can change counters only on cards they control`)
        }

        return VALID
    }
}

export abstract class ChangeCardBoolMutation extends GameMutation<ChangeCardBoolParams> {
    get card() {
        return this.params.card
    }
}

export abstract class PlayerMutation extends GameMutation<PlayerParams> {}

/**
 * Common validation
 */

export interface CardMovement extends GameMutationParams {
    card: Card
    position?: number // For hand and stacks
    x?: number // For table regions
    y?: number // For table regions
}

export function validateCardMovement(movement: CardMovement, cardRegion: AnyCardRegion) {
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
