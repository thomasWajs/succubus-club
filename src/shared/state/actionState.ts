import { Card, Minion } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { ActionState, BlockingDecision, MinionAction, NO_BLOCK } from '@/shared/types/state.ts'
import * as actions from '@/shared/state/minionActions.ts'
import { GameState } from '@/shared/state/gameState.ts'

export function createActionState(minionAction: MinionAction): ActionState {
    const actingMinion = minionAction.actingMinion
    return {
        minionAction,
        blockingDecisions: [],
        stealth: actingMinion.minionAttrs.stealth + actions.getDefaultStealth(minionAction),
        intercept: 0,
        bleed: actingMinion.minionAttrs.bleed,
        hunt: actingMinion.isVampire() ? actingMinion.vampireAttrs.hunt : 0,
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

export function getBlockingDecision(gameState: GameState, player: Player): BlockingDecision | null {
    const decisions = gameState.action?.blockingDecisions ?? []
    return decisions.filter(decision => decision.player == player)[0] ?? null
}

// The first declared blocking minion, if any. Block resolution and the bot
// still reason about a single blocker.
export function getBlockingMinion(gameState: GameState): Minion | null {
    const decisions = gameState.action?.blockingDecisions ?? []
    const blockingMinions = decisions
        .map(decision => decision.block)
        .filter((m): m is Minion => m !== NO_BLOCK)
    return blockingMinions[0] ?? null
}

/**
 * Players allowed to attempt a block against the ongoing action. Empty when no
 * block can be attempted ( no action, or a combat / referendum is in progress ).
 * A player who already decided stays eligible : they may switch to blocking with
 * another minion ( their prior decision is overwritten ).
 * - A directed action can only be blocked by its target player.
 * - An undirected action can be blocked by the active player's prey and predator.
 */
/*
export function getBlockEligiblePlayers(gameState: GameState): Player[] {
    const action = gameState.action
    if (!action || gameState.combat || gameState.referendum) {
        return []
    }

    const minionAction = action.minionAction
    if (actions.isDirected(minionAction)) {
        const target = minionAction.target
        const targetPlayer =
            target instanceof Player ? target
            : target instanceof Card ? target.controller
            : null
        return targetPlayer ? [targetPlayer] : []
    }

    const activePlayer = gameState.activePlayer
    if (!activePlayer) {
        return []
    }
    return [activePlayer.prey, activePlayer.predator].filter((p): p is Player => p !== undefined)
}
 */

export function playerCanAttemptBlock(gameState: GameState, player: Player): boolean {
    if (!gameState.action || gameState.combat || gameState.referendum) {
        return false
    }
    return player.oid != gameState.activePlayer?.oid
}

export function minionCanAttemptBlock(gameState: GameState, minion: Minion): boolean {
    return playerCanAttemptBlock(gameState, minion.controller)
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
