import { Card, Minion } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import {
    ActionState,
    BlockingDecision,
    Invalid,
    MinionAction,
    MinionActionType,
    NO_BLOCK,
    VALID,
    Validity,
} from '@/shared/types/state.ts'
import * as actions from '@/shared/state/minionActions.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { emitEvent } from '@/shared/state/events.ts'

export function createActionState(minionAction: MinionAction): ActionState {
    const actingMinion = minionAction.actingMinion
    return {
        minionAction,
        blockingDecisions: [],
        blockAttempters: [],
        awakeMinions: [],
        armedTriggers: [],
        playedCards: [],
        stealth: actingMinion.minionAttrs.stealth + actions.getDefaultStealth(minionAction),
        intercept: 0,
        bleed: actingMinion.minionAttrs.bleed,
        hunt: actingMinion.isVampire() ? actingMinion.vampireAttrs.hunt : 0,
        impulsePlayer: actingMinion.controller,
        reactionsPassed: false,
    }
}

/**
 * Wipe the ongoing action, whatever brought it to an end : the End action
 * button, or the closing of the referendum a political action put to the table.
 */
export function endAction(gameState: GameState): void {
    const ended = gameState.action?.minionAction
    gameState.action = null
    gameState.targetDeclarations = []
    if (ended) {
        emitEvent(gameState, { type: 'actionResolved', action: ended })
    }
}

export function hasPlayedThisAction(gameState: GameState, minion: Minion, card: Card): boolean {
    return !!gameState.action?.playedCards.some(
        played => played.minion == minion && played.krcgId == card.krcgId,
    )
}

export function markPlayedThisAction(gameState: GameState, minion: Minion, card: Card): void {
    if (card.krcgId) {
        gameState.action?.playedCards.push({ minion, krcgId: card.krcgId })
    }
}

export function isAwake(gameState: GameState, minion: Minion): boolean {
    return !!gameState.action?.awakeMinions.includes(minion)
}

// A ready minion may attempt a block or play a reaction card if it is unlocked, or woken
export function isAvailableToReact(gameState: GameState, minion: Minion): boolean {
    return !minion.isLocked || isAwake(gameState, minion)
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

// Can the Methuselah targeted by the action in progress be replaced by `target` ( a bounce
// card ) ? Only actions aimed at a Methuselah can change target, and never to the acting
// minion's controller.
export function canChangeTarget(gameState: GameState, target: Player): Validity {
    const action = gameState.action
    if (!action) {
        return Invalid('Must be applied during an action')
    }
    const minionAction = action.minionAction
    if (
        minionAction.type != MinionActionType.Bleed &&
        minionAction.type != MinionActionType.ActionCardFromHand
    ) {
        return Invalid('This action cannot change target')
    }
    if (!(minionAction.target instanceof Player)) {
        return Invalid('The action is not aimed at a Methuselah')
    }
    if (target.isOusted) {
        return Invalid('The new target is ousted')
    }
    if (target == minionAction.target) {
        return Invalid('The new target is already the target')
    }
    if (target == minionAction.actingMinion.controller) {
        return Invalid("The new target cannot be the acting minion's controller")
    }
    return VALID
}

// The new target gets a fresh opportunity to block and react, even if the previous
// target declined: the blocking window is reopened, and the acting player regains the
// impulse ( playing the bounce card was an effect, the impulse then passes to the new
// target as for any directed action ).
export function changeActionTarget(gameState: GameState, target: Player): void {
    const action = gameState.action
    if (!action) {
        throw new Error('gameState.action is null')
    }
    const minionAction = action.minionAction
    const previousTarget = minionAction.target

    if (minionAction.type == MinionActionType.Bleed) {
        minionAction.target = target
    } else if (minionAction.type == MinionActionType.ActionCardFromHand) {
        minionAction.target = target
        minionAction.usage = { ...minionAction.usage, target }
    } else {
        throw new Error('This action cannot change target')
    }

    // Keep the target arrows in line with the new target
    const origins = [
        minionAction.actingMinion.oid,
        ...(minionAction.type == MinionActionType.ActionCardFromHand ?
            [minionAction.card.oid]
        :   []),
    ]
    for (const declaration of gameState.targetDeclarations) {
        if (
            declaration.targetOid == previousTarget?.oid &&
            origins.includes(declaration.originOid)
        ) {
            declaration.targetOid = target.oid
        }
    }

    action.blockingDecisions = []
    action.blockAttempters = []
    action.intercept = 0
    regainImpulse(gameState)
}

// The Methuselahs the impulse can reach after the acting player, see passImpulse(): the
// target of a directed action, else the prey and the predator
export function getReactingPlayers(minionAction: MinionAction): Player[] {
    const actingPlayer = minionAction.actingMinion.controller
    if (actions.isDirected(minionAction)) {
        const target = minionAction.target
        const targetPlayer =
            target instanceof Player ? target
            : target instanceof Card ? target.controller
            : null
        return targetPlayer ? [targetPlayer] : []
    }
    return [actingPlayer.prey, actingPlayer.predator].filter(
        (player, index, all): player is Player =>
            player !== undefined && player != actingPlayer && all.indexOf(player) == index,
    )
}

// Does a bot have a chance to react to this action of a human ? It only does once it holds the
// impulse, so the human hands it over by hand or, for a declaration that is complete, at once
export function humanActsOnBot(minionAction: MinionAction): boolean {
    return (
        !minionAction.actingMinion.controller.isBot &&
        getReactingPlayers(minionAction).some(player => player.isBot)
    )
}

// Acting player regain impulse after another player used it
export function regainImpulse(gameState: GameState): void {
    const action = gameState.action
    if (!action) return
    action.impulsePlayer = action.minionAction.actingMinion.controller
    action.reactionsPassed = false
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

    // Humans resolve their own actions by hand: once the bots have passed, the impulse goes
    // back to the human (who ends the action), instead of stalling on the bot that passed
    if (
        !getBlockingMinion(gameState) &&
        !gameState.action.minionAction.actingMinion.controller.isBot
    ) {
        regainImpulse(gameState)
        gameState.action.reactionsPassed = true
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
