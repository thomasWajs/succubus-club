import { Player } from '@/shared/model/Player.ts'
import { LibraryCard, Minion, Vampire } from '@/shared/model/Card.ts'
import { ActionModifier, MinionAction } from '@/shared/types/state.ts'

export enum DecisionKind {
    Unlock = 'Unlock',
    Master = 'Master',
    Minion = 'Minion',
    Influence = 'Influence',
    Discard = 'Discard',
    Cleanup = 'Cleanup',
    ActionImpulse = 'ActionImpulse',
    ReactionImpulse = 'ReactionImpulse',
}

/**
 * One thing a bot can do at a decision point. Applying an option emits every
 * mutation it needs, including its automatic consequences (see referee.ts).
 */
export type BotOption =
    // Unlock all cards. Mandatory first step of the unlock phase.
    | { type: 'unlockAll' }
    | { type: 'endPhase' }
    // Go to the next turn (the hand is never refilled here: replacements are drawn immediately)
    | { type: 'endTurn' }
    // Send the one-shot cards played during the last action to the ash heap
    | { type: 'cleanup'; cards: LibraryCard[] }
    | { type: 'declareAction'; action: MinionAction }
    // Influence a vampire. A vampire reaching its capacity moves to the ready region.
    | { type: 'influence'; vampire: Vampire; amount: number }
    | { type: 'discard'; card: LibraryCard }
    | { type: 'playModifier'; modifier: ActionModifier }
    // The acting player passes the impulse
    | { type: 'noModifier' }
    | { type: 'block'; minion: Minion }
    // Declines to block, the acting player regains the impulse
    | { type: 'noBlock' }
    // A reacting player is done (no block, no reaction): passes the impulse
    | { type: 'noReaction' }

export type BotOptionType = BotOption['type']
export type BotOptionOf<T extends BotOptionType> = Extract<BotOption, { type: T }>

export function optionsOfType<T extends BotOptionType>(
    options: BotOption[],
    type: T,
): BotOptionOf<T>[] {
    return options.filter((option): option is BotOptionOf<T> => option.type == type)
}

export type DecisionPoint = {
    kind: DecisionKind
    player: Player
    // Never empty. An agent must return one of these very objects.
    options: BotOption[]
}

export interface BotAgent {
    choose(decision: DecisionPoint): BotOption
}

// Thrown when a bot (agent or referee) does something the engine refuses
export class InvalidBotMove extends Error {}
