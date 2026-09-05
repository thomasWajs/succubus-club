import { Card, Minion } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { ActionState, MinionAction } from '@/shared/types/state.ts'
import * as actions from '@/shared/state/minionActions.ts'
import { GameState } from '@/shared/state/gameState.ts'

export function createActionState(minionAction: MinionAction): ActionState {
    const actingMinion = minionAction.actingMinion
    return {
        minionAction,
        blockingDecision: null,
        stealth: actingMinion.minionAttrs.stealth + actions.getDefaultStealth(minionAction),
        intercept: 0,
        bleed: actingMinion.minionAttrs.bleed,
        hunt: actingMinion.minionAttrs.hunt,
        impulsePlayer: actingMinion.controller,
    }
}

/**
 * Wipe the ongoing action, whatever brought it to an end : the End action
 * button, or the closing of the referendum a political action put to the table.
 */
export function endAction(gameState: GameState): void {
    gameState.action = null
    gameState.targetDeclarations = []
}

export function getBlockingMinion(gameState: GameState): Minion | null {
    const blockingDecision = gameState.action?.blockingDecision
    return blockingDecision instanceof Card && blockingDecision.isMinion() ?
            (blockingDecision as Minion)
        :   null
}

export function selfCanAttemptBlock(gameState: GameState): boolean {
    const action = gameState.action
    return !!action && action.blockingDecision === null
}

// Acting player regain impulse after another player used it
export function regainImpulse(gameState: GameState): void {
    const action = gameState.action
    if (!action) return
    action.impulsePlayer = action.minionAction.actingMinion.controller
}

// We don't handle cards ignoring normal impulse rules, like eagle's sight
export function passImpulse(gameState: GameState): void {
    if (!gameState.action) return

    const action = gameState.action
    const minionAction = action.minionAction

    if (actions.isDirected(minionAction)) {
        if (action.impulsePlayer == gameState.activePlayer) {
            // On directed action, the impulse goes to the target
            if (minionAction.target instanceof Player) {
                action.impulsePlayer = minionAction.target
            } else if (minionAction.target instanceof Card) {
                action.impulsePlayer = minionAction.target.controller
            }
        }
        // The target passed, we can resolve the action/block
        else {
            resolveAction(gameState)
        }
    }
    // On undirected actions, the impulse goes to the prey, then the predator
    else {
        const actingMinion = minionAction.actingMinion
        const prey = actingMinion.controller.prey
        const predator = actingMinion.controller.predator
        if (prey && action.impulsePlayer == actingMinion.controller) {
            action.impulsePlayer = prey
        } else if (predator && action.impulsePlayer == prey && prey != predator) {
            action.impulsePlayer = predator
        }
        // The prey and predator both passed, we can resolve the action/block
        else {
            resolveAction(gameState)
        }
    }
}

function resolveAction(gameState: GameState): void {
    if (!gameState.action || !gameState.activePlayer) {
        return
    }

    // Block attempt
    if (getBlockingMinion(gameState)) {
        gameMutations.ACTION_resolveBlock.act(gameState.activePlayer, {})
    }
    // Successful action
    else {
        gameMutations.ACTION_resolveAction.act(gameState.activePlayer, {})
    }
}
