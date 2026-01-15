import { Card, Minion } from '@/model/Card.ts'
import { Player } from '@/model/Player.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { gameMutations } from '@/state/gameMutations.ts'
import { ActionState, MinionAction } from '@/state/types.ts'
import * as actions from '@/state/minionActions.ts'

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

export function getBlockingMinion(): Minion | null {
    const blockingDecision = useGameStateStore().action?.blockingDecision
    return blockingDecision instanceof Card && blockingDecision.isMinion() ?
            (blockingDecision as Minion)
        :   null
}

export function selfHasImpulse(): boolean | null {
    const gameState = useGameStateStore()
    return gameState.action?.impulsePlayer == gameState.selfPlayer
}

export function selfCanAttemptBlock(): boolean {
    const action = useGameStateStore().action
    return !!action && action.blockingDecision === null
}

// Acting player regain impulse after another player used it
export function regainImpulse(): void {
    const action = useGameStateStore().action
    if (!action) return
    action.impulsePlayer = action.minionAction.actingMinion.controller
}

// We don't handle cards ignoring normal impulse rules, like eagle's sight
export function passImpulse(): void {
    const gameState = useGameStateStore()
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
            resolveAction()
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
            resolveAction()
        }
    }
}

function resolveAction(): void {
    const gameState = useGameStateStore()
    if (!gameState.action || !gameState.activePlayer) {
        return
    }

    // Block attempt
    if (getBlockingMinion()) {
        gameMutations.ACTION_resolveBlock.act(gameState.activePlayer, {})
    }
    // Successful action
    else {
        gameMutations.ACTION_resolveAction.act(gameState.activePlayer, {})
    }
}
