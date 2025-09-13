import { Player } from '@/model/Player.ts'
import { ActionModifier, MinionAction } from '@/state/minionActions.ts'
import { AnyGameMutation } from '@/state/gameMutations.ts'
import { NO_ACTION_MODIFIER, NO_BLOCK, NO_COMBAT, NO_REACTION } from '@/state/actionState.ts'
import { KrcgId } from '@/resources/cards.ts'
import { LibraryCard } from '@/model/Card.ts'

/**
 * Markers for Conductor
 */
export class NEXT_PHASE {} // Go forward to the next turn phase
export class NEXT_TURN {} // Go forward to the next turn ( end current turn )

export type BotDecision =
    | NEXT_PHASE
    | NEXT_TURN
    | NO_COMBAT
    | NO_BLOCK
    | NO_REACTION
    | NO_ACTION_MODIFIER
    | AnyGameMutation
    | MinionAction
    | ActionModifier

/**
 * Bot skeleton
 */

export abstract class Bot {
    constructor(public player: Player) {}

    // Callback to init state
    startTurn() {}

    // Callback to clean state
    endTurn() {}

    abstract unlockPhase(): NEXT_PHASE | AnyGameMutation

    abstract masterPhase(): NEXT_PHASE | AnyGameMutation

    abstract minionPhase(): NEXT_PHASE | MinionAction | AnyGameMutation

    abstract influencePhase(): NEXT_PHASE | AnyGameMutation

    abstract discardPhase(): NEXT_TURN | AnyGameMutation

    abstract actionModifier(): NO_ACTION_MODIFIER | ActionModifier

    abstract combat(): NO_COMBAT

    abstract reaction(): NO_BLOCK | NO_REACTION

    getCardInHand(krcgId: KrcgId) {
        for (const card of this.player.hand.cards) {
            if (card.krcgId == krcgId) {
                return card as LibraryCard
            }
        }
        return undefined
    }
}
