import { Card, Minion } from '@/shared/model/Card.ts'
import { AMOUNT_LOG_PLACEHOLDER, CARD_LOG_PLACEHOLDER } from '@/shared/const/game.ts'
import {
    ActionModifier,
    ActionProperty,
    ANY_PLAYER,
    Invalid,
    LibraryCardUsage,
    MinionAction,
    MinionActionType,
    NO_ACTION_MODIFIER,
    NO_BLOCK,
    NO_REACTION,
    VALID,
} from '@/shared/types/state.ts'
import { MutationSyncMode } from '@/shared/types/multiplayer.ts'
import {
    createActionState,
    endAction,
    getBlockingMinion,
    passImpulse,
    regainImpulse,
} from '@/shared/state/gameplay/actionState.ts'
import { createCombatState, inflictDamage } from '@/shared/state/gameplay/combatState.ts'
import * as actions from '@/shared/state/gameplay/minionActions.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { disciplineUsesImg } from '@/shared/disciplineIcons.ts'
import { LogGroup } from '@/shared/types/history.ts'
import {
    ActionLineFold,
    counterDetail,
    declarationLogText,
    logActionName,
    logRevealedCard,
} from '@/shared/state/history/mutationLog.ts'
import {
    AnyGameMutation,
    EmptyParams,
    GameMutation,
    GameMutationParams,
} from '@/shared/state/mutations/base.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'

/**
 * Action: Change action value
 */

interface ChangeActionPropertyParams extends GameMutationParams {
    propertyName: ActionProperty
    amount: number
}

export class ChangeActionProperty extends GameMutation<ChangeActionPropertyParams> {
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
        return `${AMOUNT_LOG_PLACEHOLDER} ${this.params.propertyName} for the action`
    }

    formatLogDetails() {
        const action = this.gameState.action
        if (!action) {
            return null
        }
        const value = action[this.params.propertyName]
        return [counterDetail(this.params.propertyName, value, this.params.amount)]
    }

    get logGroup(): LogGroup {
        return { key: `${this.name}-${this.params.propertyName}`, amount: this.params.amount }
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

export class DeclareAction extends GameMutation<DeclareActionParams> {
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
        return declarationLogText(this.params.minionAction)
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.ACTION_declareActionInverse.createCancelMutation(this, {
            minionAction: this.params.minionAction,
        })
    }
}

export class DeclareActionInverse extends GameMutation<DeclareActionParams> {
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        return this.params.minionAction.actingMinion.controller
    }

    protected updateGameState(gameState: GameState) {
        this.params.minionAction.actingMinion.unlock()
        gameState.action = null
    }

    formatForLog() {
        return `Withdraw ${logActionName(this.params.minionAction)}`
    }
}

/**
 * Action: Update usage
 *
 * Refine the usage ( declared disciplines and/or target ) of the action card
 * currently in progress. Declaration is non-blocking, so the acting player fills
 * this in ( or amends it ) after the action itself is declared, and may keep
 * changing it while the action lasts. Each change is its own appended mutation,
 * consistent with the append-only history.
 */
interface UpdateActionUsageParams extends GameMutationParams {
    usage: LibraryCardUsage
}

export class UpdateActionUsage extends GameMutation<UpdateActionUsageParams> {
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        return this.gameState.activePlayer
    }

    get card(): Card | null {
        const minionAction = this.gameState.action?.minionAction
        return minionAction?.type == MinionActionType.ActionCardFromHand ? minionAction.card : null
    }

    getValidity(gameState: GameState) {
        if (!gameState.action) {
            return Invalid('Must be applied during an action')
        }
        if (gameState.action.minionAction.type != MinionActionType.ActionCardFromHand) {
            return Invalid('Usage can only be set for an action card')
        }
        return VALID
    }

    protected updateGameState(gameState: GameState) {
        const minionAction = gameState.action?.minionAction
        if (!minionAction || minionAction.type != MinionActionType.ActionCardFromHand) {
            throw new Error('No action card in progress')
        }
        this.previousState.usage = minionAction.usage
        minionAction.usage = this.params.usage
        minionAction.target = this.params.usage.target
    }

    // The whole declaration again, with the new usage : it replaces the text of the declaration
    // line
    formatForLog() {
        const minionAction = this.gameState.action?.minionAction
        if (!minionAction || minionAction.type != MinionActionType.ActionCardFromHand) {
            return null
        }
        return declarationLogText(minionAction)
    }

    get actionLineFold(): ActionLineFold {
        return 'replace'
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.ACTION_updateUsage.createCancelMutation(this, {
            usage: this.previousState.usage as LibraryCardUsage,
        })
    }
}

/**
 * Action: Declare action modifier
 */

interface DeclareActionModifierParams extends GameMutationParams {
    actionModifier: ActionModifier | typeof NO_ACTION_MODIFIER
}

export class DeclareActionModifier extends GameMutation<DeclareActionModifierParams> {
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
            return `No action modifier`
        } else {
            const am = this.params.actionModifier
            return `Declare ${logRevealedCard(am.card)} ${disciplineUsesImg(am.usage.disciplines ?? [])}${actions.usageXLog(am.usage)}`
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
    // A minion attempting the block, NO_BLOCK to decline, or null to end the
    // block ( remove this player's decision, back to "no decision yet" ).
    block: Minion | typeof NO_BLOCK | null
}

export class DeclareBlock extends GameMutation<DeclareBlockParams> {
    _isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        // Relax the rules here, we don't handle impulse in multiplayer
        // return this.gameState.action?.impulsePlayer ?? null
        return ANY_PLAYER
    }

    getValidity(gameState: GameState) {
        return gameState.action ? VALID : Invalid('Must be applied during an action')
    }

    protected updateGameState(gameState: GameState) {
        if (!gameState.action) {
            throw new Error('gameState.action is null')
        }
        const block = this.params.block
        // The block decision belongs to the minion's controller, else the author.
        const blockingPLayer = block instanceof Card ? block.controller : this.author

        const decisions = gameState.action.blockingDecisions
        const index = decisions.findIndex(decision => decision.player.oid == blockingPLayer.oid)

        if (block === null) {
            // End block : drop this player's decision entirely.
            if (index >= 0) {
                decisions.splice(index, 1)
            }
        } else if (index >= 0) {
            // One decision per player : a player revising their choice overwrites it.
            decisions[index].block = block
        } else {
            decisions.push({ player: blockingPLayer, block })
        }

        // Seed the action intercept from the attempting minion, or reset it once
        // no minion is attempting the block anymore.
        if (block instanceof Card) {
            gameState.action.intercept = block.minionAttrs.intercept
        } else if (!getBlockingMinion(gameState)) {
            gameState.action.intercept = 0
        }

        regainImpulse(gameState)
    }

    formatForLog() {
        if (this.params.block === null) {
            return `End block`
        } else if (this.params.block === NO_BLOCK) {
            return `No block`
        } else {
            return `Attempt to block with ${CARD_LOG_PLACEHOLDER}`
        }
    }

    get card() {
        return this.params.block instanceof Card ? this.params.block : null
    }
}

/**
 * Action: Declare reaction
 */

interface DeclareReactionParams extends GameMutationParams {
    reaction: Card | typeof NO_REACTION
}

export class DeclareReaction extends GameMutation<DeclareReactionParams> {
    _isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        // Relax the rules here, we don't handle impulse in multiplayer
        // return this.gameState.action?.impulsePlayer ?? null
        return ANY_PLAYER
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
            return `No reaction`
        } else {
            return `React with ${CARD_LOG_PLACEHOLDER}`
        }
    }

    get card() {
        return this.params.reaction == NO_REACTION ? null : this.params.reaction
    }
}

/**
 * Action: End action
 */

export class EndAction extends GameMutation<EmptyParams> {
    _isUserCancellable = false
    readonly syncMode = MutationSyncMode.Merge
    declare public previousState: { actionName: string }

    getValidity(gameState: GameState) {
        return gameState.action ? VALID : Invalid('Must be applied during an action')
    }

    protected updateGameState(gameState: GameState) {
        // Store for use formatForLog()
        if (gameState.action) {
            this.previousState.actionName = logActionName(gameState.action.minionAction)
        }

        endAction(gameState)
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
        this.previousState.actionName = logActionName(gameState.action.minionAction)
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
        // Relax the rules here, we don't handle impulse in multiplayer
        // return this.gameState.activePlayer
        return ANY_PLAYER
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

            action.blockingDecisions = []
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
