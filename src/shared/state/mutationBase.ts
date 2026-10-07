import { Player } from '@/shared/model/Player.ts'
import { Card } from '@/shared/model/Card.ts'
import { ANY_PLAYER, Invalid, PlayerVision, VALID, Validity } from '@/shared/types/state.ts'
import { MutationSyncMode, VersioningId } from '@/shared/types/multiplayer.ts'
import { GameId } from '@/shared/types/model.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { getGameState, getMutationTrigger } from '@/shared/registries.ts'
import { hashObject, serializeObject } from '@/shared/hashing.ts'
import { interruptsReferendumLastCall } from '@/shared/state/referendumState.ts'
import type { gameMutations } from '@/shared/state/gameMutations.ts'
import type { botMutations } from '@/shared/state/botMutations.ts'

export type GameMutationId = number
export interface GameMutationParams {
    [key: string]: unknown
}
export type AnyGameMutation = GameMutation<GameMutationParams>
export type GameMutationName = keyof typeof gameMutations | keyof typeof botMutations

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

    formatPlayerHand(player: Player) {
        return `(hand: ${player.hand.length} | lib: ${player.library.length})`
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

export interface PlayerParams extends GameMutationParams {
    player: Player
}

/**
 * Abstract Mutations
 */

export abstract class CardMutation extends GameMutation<CardParams> {
    get card() {
        return this.params.card
    }
}

export abstract class PlayerMutation extends GameMutation<PlayerParams> {}

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
export function defineMutation<
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
 * Mutation registry
 *
 * Mutations are serialized by name, so deserialization needs the class behind a name. The
 * registry is filled by gameMutations.ts and botMutations.ts, which keeps this file and the
 * deserializer from importing them ( they all depend on each other, and the mutation classes
 * extend GameMutation as soon as they are loaded ).
 */

type RegisteredMutationClass = new (
    gameId: GameId,
    params: never,
    timestamp: Date,
    author: Player,
    cancelsMutationId?: GameMutationId,
) => AnyGameMutation

const mutationClasses = new Map<string, RegisteredMutationClass>()

export function registerMutations(
    definitions: Record<string, { gameMutationClass: RegisteredMutationClass }>,
) {
    for (const [mutationName, definition] of Object.entries(definitions)) {
        // Set mutation name on each GameMutation subclasses
        definition.gameMutationClass.prototype.mutationName = mutationName
        mutationClasses.set(mutationName, definition.gameMutationClass)
    }
}

export function getMutationClass(name: GameMutationName) {
    const mutationClass = mutationClasses.get(name)
    if (!mutationClass) {
        throw new Error(`Unknown GameMutation : ${name}`)
    }
    return mutationClass
}
