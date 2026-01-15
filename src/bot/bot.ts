import { Player } from '@/model/Player.ts'
import { AnyGameMutation } from '@/state/gameMutations.ts'
import { NO_ACTION_MODIFIER, NO_BLOCK, NO_COMBAT, NO_REACTION } from '@/state/types.ts'
import { ActionModifier, MinionAction } from '@/state/types.ts'
import { KrcgId } from '@/resources/cards.ts'
import { LibraryCard } from '@/model/Card.ts'

/**
 * Flags for Conductor
 */
export const NEXT_PHASE = 'NEXT_PHASE' as const // Go forward to the next turn phase
export const NEXT_TURN = 'NEXT_TURN' as const // Go forward to the next turn ( end current turn )

export type BotDecision =
    | typeof NEXT_PHASE
    | typeof NEXT_TURN
    | typeof NO_COMBAT
    | typeof NO_BLOCK
    | typeof NO_REACTION
    | typeof NO_ACTION_MODIFIER
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

    abstract unlockPhase(): typeof NEXT_PHASE | AnyGameMutation

    abstract masterPhase(): typeof NEXT_PHASE | AnyGameMutation

    abstract minionPhase(): typeof NEXT_PHASE | MinionAction | AnyGameMutation

    abstract influencePhase(): typeof NEXT_PHASE | AnyGameMutation

    abstract discardPhase(): typeof NEXT_TURN | AnyGameMutation

    abstract actionModifier(): typeof NO_ACTION_MODIFIER | ActionModifier

    abstract combat(): typeof NO_COMBAT

    abstract reaction(): typeof NO_BLOCK | typeof NO_REACTION

    getCardInHand(krcgId: KrcgId) {
        for (const card of this.player.hand.cards) {
            if (card.krcgId == krcgId) {
                return card as LibraryCard
            }
        }
        return undefined
    }
}
