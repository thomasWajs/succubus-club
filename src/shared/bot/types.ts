import { Player } from '@/shared/model/Player.ts'
import { LibraryCard, Minion, Vampire } from '@/shared/model/Card.ts'
import {
    ActionModifier,
    CombatStrike,
    LibraryCardUsage,
    MinionAction,
} from '@/shared/types/state.ts'
import { ReactionCardEffect } from '@/shared/cardImpl/base.ts'

export enum DecisionKind {
    Unlock = 'Unlock',
    Master = 'Master',
    Minion = 'Minion',
    Influence = 'Influence',
    Discard = 'Discard',
    Cleanup = 'Cleanup',
    ActionImpulse = 'ActionImpulse',
    ReactionImpulse = 'ReactionImpulse',
    // A window of a combat step, or the choice of a strike
    Combat = 'Combat',
}

interface ReactionOption {
    type: 'playReaction'
    minion: Minion
    card: LibraryCard
    usage: LibraryCardUsage
    effect: ReactionCardEffect
}

interface CombatPreventOption {
    type: 'combatPrevent'
    minion: Minion
    amount: number
    aggravated: boolean
    card?: LibraryCard
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
    // Plays a reaction card from the hand with a ready minion, which changes the action in
    // progress. One option per minion, discipline level and effect (e.g. new target).
    | ReactionOption
    // A reacting player is done (no block, no reaction): passes the impulse
    | { type: 'noReaction' }
    // Nothing more to play in this window of the combat step
    | { type: 'combatPass' }
    // The four combat options below come with the combat card (from the hand) that
    // provides them, played as part of applying the option. No card = the default
    // hand strike.
    // The strike of the round
    | { type: 'combatStrike'; minion: Minion; strike: CombatStrike; card?: LibraryCard }
    // Moves the range to long, or back to close. May also choose the strike (strike card).
    | { type: 'combatManeuver'; minion: Minion; strike?: CombatStrike; card?: LibraryCard }
    // A press to continue, or the cancellation of the opposing one
    | { type: 'combatPress'; minion: Minion; card?: LibraryCard }
    | CombatPreventOption

export type BotOptionType = BotOption['type']
export type BotOptionOf<T extends BotOptionType> = Extract<BotOption, { type: T }>

// What a card can add to a combat step. The referee keeps the ones that fit the step.
export type CombatCardOption = BotOptionOf<
    'combatStrike' | 'combatManeuver' | 'combatPress' | 'combatPrevent'
>

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
