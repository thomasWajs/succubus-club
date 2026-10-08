import { Player } from '@/shared/model/Player.ts'
import { Card, CryptCard, LibraryCard, Minion, Vampire } from '@/shared/model/Card.ts'
import {
    ActionModifier,
    CombatStrike,
    LibraryCardUsage,
    MinionAction,
    PendingTrigger,
} from '@/shared/types/state.ts'
import { ReactionCardEffect } from '@/shared/cardImpl/base.ts'

export enum DecisionKind {
    Unlock = 'Unlock',
    Master = 'Master',
    Minion = 'Minion',
    Influence = 'Influence',
    Discard = 'Discard',
    Cleanup = 'Cleanup',
    // The hand is above the hand size ( a card giving a bonus left play ): out of turn too
    DiscardExcess = 'DiscardExcess',
    // An optional trigger of a card in play is pending: use it or not, before anything else goes on
    Trigger = 'Trigger',
    ActionImpulse = 'ActionImpulse',
    ReactionImpulse = 'ReactionImpulse',
    // The combat of a block is over: the blocker's controller may play the reactions made for it
    PostBlock = 'PostBlock',
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

interface GrappleOption {
    type: 'combatGrapple'
    minion: Minion
    press: boolean
    closeNextRound: boolean
    card?: LibraryCard
}

interface ManeuverOption {
    type: 'combatManeuver'
    minion: Minion
    strike?: CombatStrike
    card?: LibraryCard
    weapon?: Card
    // A maneuver the minion has with no card ( given by a reaction when it blocked )
    free?: boolean
}

interface StrikeOption {
    type: 'combatStrike'
    minion: Minion
    strike: CombatStrike
    card?: LibraryCard
    // The strike card also gives an additional strike
    additional?: { limited: boolean }
}

interface CombatPreventOption {
    type: 'combatPrevent'
    minion: Minion
    amount: number
    aggravated: boolean
    card?: LibraryCard
    // The card attached to the minion that prevents the damage ( once per combat ): nothing to play
    source?: Card
}

/**
 * One thing a bot can do at a decision point. Applying an option emits every
 * mutation it needs, including its automatic consequences (see referee.ts).
 */
export type BotOption =
    // Unlock all cards. Mandatory first step of the unlock phase.
    | { type: 'unlockAll' }
    | { type: 'endPhase' }
    // Uses the unlock-phase effect of a master card in play on a vampire ( once per card and turn )
    | { type: 'unlockEffect'; card: LibraryCard; vampire: Vampire }
    // Uses the "lock this card to discard a card" ability of a master card in play ( the hand is
    // drawn back up )
    | { type: 'lockEffect'; card: LibraryCard; discard: LibraryCard }
    // Locks a master card in play for the action in progress, which gives it its bonus ( The
    // Labyrinth ). Played like an action modifier: the acting player keeps the impulse.
    | { type: 'lockForAction'; card: LibraryCard }
    // Uses an ability of a master card in play that is paid with transfers ( the ability is an
    // index of the card's abilities ). Some remove a card of the uncontrolled region.
    | { type: 'transferEffect'; card: LibraryCard; ability: number; removed?: CryptCard }
    // Uses the ability of a card put on a vampire ( a Blood Doll ) to move blood between the vampire
    // and the pool, in the master phase ( once per card and turn, no master phase action )
    | { type: 'moveBlood'; card: Card; vampire: Vampire; amount: number; toPool: boolean }
    // Plays a master card from the hand (master phase action + pool cost). The minion is the
    // target of the effect of the card on play ( or the one it is put on ), for the cards that have one.
    | { type: 'playMaster'; card: LibraryCard; target?: Minion }
    // Go to the next turn (the hand is never refilled here: replacements are drawn immediately)
    | { type: 'endTurn' }
    // Send the one-shot cards played during the last action to the ash heap
    | { type: 'cleanup'; cards: LibraryCard[] }
    | { type: 'declareAction'; action: MinionAction }
    // Influence a vampire. A vampire reaching its capacity moves to the ready region.
    | { type: 'influence'; vampire: Vampire; amount: number }
    | { type: 'discard'; card: LibraryCard }
    // Discard down to the hand size: not a discard phase action
    | { type: 'discardExcess'; card: LibraryCard }
    // A pending optional trigger of a card in play: use it ( pay the cost, apply the effects ) or not
    | { type: 'useTrigger'; pending: PendingTrigger }
    | { type: 'skipTrigger'; pending: PendingTrigger }
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
    // The combat options below come with the combat card (from the hand) that
    // provides them, played as part of applying the option. No card = the default
    // hand strike.
    // The strike of the round
    | StrikeOption
    // Moves the range to long, or back to close. May also choose the strike (strike card, weapon).
    // The maneuver of a weapon in play has no card to play: the weapon is the one that gives it.
    | ManeuverOption
    // A press to continue, or the cancellation of the opposing one
    // A granted press is the one a card played earlier gave: no card to play
    | { type: 'combatPress'; minion: Minion; card?: LibraryCard; granted?: boolean }
    // Only offered in the window after a pair of strikes
    | { type: 'combatAdditionalStrike'; minion: Minion; limited: boolean; card?: LibraryCard }
    | GrappleOption
    // At the end of the round
    | { type: 'combatGainBlood'; minion: Minion; amount: number; card?: LibraryCard }
    // The strength bonus a card gave for the first round: no card to play
    | { type: 'combatStrengthBonus'; minion: Minion }
    // The strength of the minion for the rest of the combat ( window before the range )
    | { type: 'combatStrength'; minion: Minion; amount: number; card?: LibraryCard }
    // The opposing minion takes this much damage each round ( window before the range )
    | { type: 'combatEnvironmentalDamage'; minion: Minion; amount: number; card?: LibraryCard }
    | CombatPreventOption

export type BotOptionType = BotOption['type']
export type BotOptionOf<T extends BotOptionType> = Extract<BotOption, { type: T }>

// What a card can add to a combat step. The referee keeps the ones that fit the step.
export type CombatCardOption = BotOptionOf<
    | 'combatStrike'
    | 'combatManeuver'
    | 'combatPress'
    | 'combatPrevent'
    | 'combatStrength'
    | 'combatEnvironmentalDamage'
    | 'combatAdditionalStrike'
    | 'combatGrapple'
    | 'combatGainBlood'
    | 'combatStrengthBonus'
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
