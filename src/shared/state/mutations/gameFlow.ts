import { Player } from '@/shared/model/Player.ts'
import { TurnSequence } from '@/shared/const/model.ts'
import { Invalid, VALID } from '@/shared/types/state.ts'
import { MutationSyncMode, VersioningId, VersioningTarget } from '@/shared/types/multiplayer.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { simpleEscapeHtml } from '@/shared/utils.ts'
import { LogDetail } from '@/shared/types/history.ts'
import { logPlayer } from '@/shared/state/history/mutationLog.ts'
import {
    AnyGameMutation,
    ChangeIndexParams,
    EmptyParams,
    GameMutation,
    GameMutationParams,
} from '@/shared/state/mutations/base.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'

/**
 * Change The Edge Control
 */
interface ChangeTheEdgeControlParams extends GameMutationParams {
    theEdgeController: Player | undefined
}

export class ChangeTheEdgeControl extends GameMutation<ChangeTheEdgeControlParams> {
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
        const theEdgeController = this.params.theEdgeController
        if (theEdgeController) {
            return theEdgeController.oid === this.author.oid ?
                    `Take the Edge`
                :   `Give the Edge to ${logPlayer(theEdgeController)}`
        } else {
            return `Burn the Edge`
        }
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.changeTheEdgeControl.createCancelMutation(this, {
            theEdgeController: this.previousState.theEdgeController,
        })
    }
}

/**
 * Change Turn / Phase
 */

export class GoToTurn extends GameMutation<ChangeIndexParams> {
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

export class GoToTurnPhase extends GameMutation<ChangeIndexParams> {
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
        return this.params.randomType === 'coin' ? `Flip a coin` : `Roll a d6`
    }

    // The result, after a coin or a die
    formatLogDetails(): LogDetail[] {
        if (this.params.randomType === 'coin') {
            return [{ icon: 'coin', value: this.params.result === 1 ? 'Heads' : 'Tails' }]
        }
        return [{ icon: 'dice', value: `${this.params.result}` }]
    }
}

/**
 * Secret ( hidden choice revealed simultaneously, like a bid or rock/paper/scissor )
 *
 * The secret value is kept locally by the author until it is revealed.
 * AnnounceSecret only broadcasts that a choice has been made.
 * RevealSecret broadcasts the actual value for everyone to see in the logs.
 */

export class SecretAnnounce extends GameMutation<EmptyParams> {
    readonly syncMode = MutationSyncMode.Merge
    isIgnoredForCancel = true

    protected updateGameState(): void {
        // No state change - this mutation only serves as a log/broadcast event
    }

    formatForLog() {
        return `Choose a secret`
    }
}

export interface RevealSecretParams extends GameMutationParams {
    secret: string
}

export class SecretReveal extends GameMutation<RevealSecretParams> {
    readonly syncMode = MutationSyncMode.Merge
    isIgnoredForCancel = true

    protected updateGameState(): void {
        // No state change - this mutation only serves as a log/broadcast event
    }

    formatForLog() {
        return `Reveal the secret`
    }

    // The secret, typed by the author : escaped
    formatLogDetails() {
        return [{ value: simpleEscapeHtml(this.params.secret) }]
    }
}
