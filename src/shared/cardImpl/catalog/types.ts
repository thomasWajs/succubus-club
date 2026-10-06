import { Discipline, DisciplineLevel } from '@/shared/const/model.ts'
import { KrcgId } from '@/shared/types/gateway.ts'
import { EventName } from '@/shared/state/events.ts'

/**
 * The declarative description of a card. The cost, the clan requirement and the unique flag
 * are NOT repeated here: they come from the cardbase.
 *
 * A card is a list of PLAYS. A play is one way of playing the card, keyed by what it
 * requires of the player ( a discipline, nothing... ), and it has its own kind: the same
 * card can be an action modifier at inferior and a combat card at superior.
 */

export type CardKind = 'action' | 'modifier' | 'combat' | 'reaction' | 'master'

export type Requirement =
    | { type: 'none' }
    | { type: 'discipline'; discipline: Discipline; level: DisciplineLevel }
    // Every requirement at once ( "[pot][pre]" )
    | { type: 'all'; of: Requirement[] }
    // One of the requirements ( "[pot] or [pre]", or the two levels of a discipline )
    | { type: 'any'; of: Requirement[] }

// What must hold for the play to be possible right now
export type Condition =
    | { type: 'during'; action: 'bleed' }
    | { type: 'actionTargets'; who: 'you' }
    | { type: 'afterBlocksDeclined' }
    | { type: 'combatRound'; round: number }
    | { type: 'reactorIs'; minion: 'vampire' }
    // The target of the action has this much pool or less
    | { type: 'targetPoolAtMost'; amount: number }
    // A block attempt by one of your minions is standing ( by a vampire of the sect, when given )
    | { type: 'yourBlockStands'; sect?: 'Anarch' }
    // The card can be played by a locked minion, whatever its state ( "usable by a locked baron" )
    | { type: 'usableWhileLocked' }
    // The minion playing the card is locked ( and not awake ): the play is made for it. Without
    // this condition a reaction needs an unlocked ( or awake ) minion.
    | { type: 'minionLocked' }
    // The minion has not played this card since its last unlock phase
    | { type: 'oncePerUnlock' }
    // The combat is in this step ( the other windows are not offered by the combat engine )
    | { type: 'combatStep'; step: 'beforeRange' | 'beforeStrikes' | 'endOfRound' }
    | { type: 'closeRange' }
    // The minion has not played this card in the current round of the combat
    | { type: 'oncePerRound' }
    // The opponent in the combat is a vampire ( not an ally )
    | { type: 'opposingIsVampire' }

/**
 * Effects: a closed set per kind of play. Each one maps to an existing mutation.
 */

export type StealthEffect = { type: 'stealth'; amount: number }
export type BleedEffect = { type: 'bleed'; amount: number; limited?: boolean }
// The bleed bonus is the X the card is played for ( see the x range of the play )
export type VariableBleedEffect = { type: 'bleed'; amount: 'X'; limited?: boolean }
export type InterceptEffect = { type: 'intercept'; amount: number }
// The action is a bleed ( the +N of BleedEffect is on top of the minion's own bleed )
export type BleedActionEffect = { type: 'bleedAction' }
// Blood added to the target of the play ( an action's target, an ability's target )
export type GainBloodEffect = { type: 'gainBlood'; amount: number }
// A maneuver moves the range. With toCloseOnly it is only worth it when the range is long. In a play
// that also has a strike, the maneuver comes with it ( the card is played once ): the strike is
// the one of the maneuver, or can be played alone at the strike step.
export type ManeuverEffect = { type: 'maneuver'; toCloseOnly?: boolean }
export type StrikeEffect =
    | { type: 'strike'; preset: 'dodge' }
    // A hand strike with more damage than the strength of the minion
    | { type: 'strike'; preset: 'hand'; extraDamage: number; undodgeable?: boolean }
// The strength of the minion for the rest of the combat, when it is higher than it is
export type SetStrengthEffect = { type: 'setStrength'; amount: number }
// A bounce: the acting minion's controller is never the new target. The reacting vampire is
// locked when the card says so.
export type ChangeTargetEffect = { type: 'changeTarget'; lockReactor: boolean }
// The reacting minion wakes until the end of the action
export type WakeEffect = { type: 'wake' }
export type HandSizeEffect = { type: 'handSize'; amount: number }

// Takes pool from the target Methuselah ( at most what they have ) for the acting one
export type StealPoolEffect = { type: 'stealPool'; amount: number }
// The acting minion enters combat with the target minion
export type EnterCombatEffect = { type: 'enterCombat' }
// If the action is blocked, the minion can gain this much strength in the first round of the
// combat ( before the range )
export type StrengthIfBlockedEffect = { type: 'strengthIfBlocked'; amount: number }
export type ActionEffect =
    | StrengthIfBlockedEffect
    | StealthEffect
    | BleedEffect
    | BleedActionEffect
    | GainBloodEffect
    | StealPoolEffect
    | EnterCombatEffect
// What a trigger does when its event is announced
export type TriggerEffect =
    // The minion that failed its block is locked. With `at`, the lock waits for that event
    // ( the same action ) instead of being applied at once.
    | { type: 'lock'; who: 'eventBlocker'; at?: EventName }
    // The card that has the trigger is unlocked
    | { type: 'unlock'; who: 'self' }
// What must hold for a trigger to count, about the event and the card that has the trigger
export type EventCondition =
    // The minion that acted: another minion than the card ( `other` ), controlled by the same
    // Methuselah ( `controller: 'self'` ), of this sect
    { type: 'actorIs'; other?: boolean; controller?: 'self'; sect?: 'Anarch' }
// Paid when an optional trigger is used
export type TriggerCost = { type: 'burnBlood'; amount: number }
// A card in play or a played card that reacts to an event, with the effects it has
export type Trigger = {
    on: EventName
    // 'auto' applies at once, 'optional' is a decision of the controller ( a bot may opt out )
    mode: 'auto' | 'optional'
    when?: EventCondition[]
    cost?: TriggerCost
    // Tracked in turnResources.usedTriggers
    limit?: 'oncePerTurn'
    // Where the card with the trigger must be for it to count ( the ready region by default,
    // locked or not )
    sourceIn?: ('ready' | 'torpor')[]
    effects: TriggerEffect[]
}
// The trigger is armed for the rest of the action ( only the events from now on count )
export type ArmTriggerEffect = { type: 'armTrigger'; trigger: Trigger }
export type ModifierEffect =
    | StealthEffect
    | BleedEffect
    | VariableBleedEffect
    | InterceptEffect
    | ArmTriggerEffect
// One more strike for the minion ( limited: only one such card or effect per round ). In a play
// that has a strike, the additional strike comes with it; else the card is played in the
// window after the pairs of strikes.
export type AdditionalStrikeEffect = { type: 'additionalStrike'; limited: boolean }
// Only hand strikes this round, with a press the minion can use, and the next round at close range
export type GrappleEffect = { type: 'grapple'; press: boolean; closeNextRound: boolean }
// At the end of a round: the blood the opponent lost to damage this round
export type GainBloodFromDamageEffect = { type: 'gainBloodFromDamage' }
export type CombatEffect =
    | ManeuverEffect
    | StrikeEffect
    | SetStrengthEffect
    | AdditionalStrikeEffect
    | GrappleEffect
    | GainBloodFromDamageEffect
// Unlocks a locked vampire of the sect you control, which attempts to block the action with this
// much more intercept ( a block must be possible: none stands yet, the vampire did not try )
export type UnlockAndBlockEffect = { type: 'unlockAndBlock'; sect: 'Anarch'; intercept: number }
export type ReactionEffect =
    | ChangeTargetEffect
    | InterceptEffect
    | WakeEffect
    | UnlockAndBlockEffect
export type MasterEffect = HandSizeEffect

// What an action card aims at
export type ActionTarget = 'player' | 'youngerUncontrolledVampire' | 'minionOfOtherMethuselah'

export type StaysInPlay = 'discard' | 'onMinion' | 'standalone'

// Something a card in play does when the player chooses to
export type MasterAbility = UnlockAbility | LockAbility | TransferAbility

// "You can use N transfers to ...": usable in the influence phase while the transfers last
type TransferAbility = {
    activate: 'transfer'
    transfers: number
    effects: TransferEffect[]
}

export type TransferEffect =
    // Draw a card from the crypt, then remove a crypt card of the uncontrolled region from the game
    | { type: 'drawCryptRemoveUncontrolled' }
    | { type: 'burnSelf' }
    | { type: 'gainPool'; amount: number }

type UnlockAbility = {
    // During the unlock phase, once the cards are unlocked ( once per turn )
    activate: 'unlock'
    target: 'readyVampireBelowCapacity'
    // Only the vampires of this sect
    sect?: 'Anarch'
    effects: GainBloodEffect[]
}

// "You can lock this card to ...": usable while the card is unlocked, and it locks the card
type LockAbility = {
    activate: 'lock'
    effects: DiscardFromHandEffect[]
}

// A card of the hand is discarded ( the hand is drawn back up afterwards )
export type DiscardFromHandEffect = { type: 'discardFromHand' }

// What a master card does once, when it is played
export type MasterOnPlay = {
    target: 'readyVampireBelowCapacity'
    effects: GainBloodEffect[]
}

type PlayBase = {
    // None by default
    requires?: Requirement
    when?: Condition[]
}

export type ActionPlay = PlayBase & {
    kind: 'action'
    target: ActionTarget
    effects: ActionEffect[]
}
export type ModifierPlay = PlayBase & {
    kind: 'modifier'
    // Who plays it: the acting minion by default. The vampire still pays the cost and has the
    // requirement, but it is another one of the acting player's ready vampires.
    by?: 'otherThanActing'
    // The values the X of a card with a variable cost can take ( the cardbase only says "X" )
    x?: { min: number; max: number }
    effects: ModifierEffect[]
}
export type CombatPlay = PlayBase & { kind: 'combat'; effects: CombatEffect[] }
// An effect can have conditions of its own, on top of those of the play
export type ConditionalReactionEffect = ReactionEffect & { when?: Condition[] }
export type ReactionPlay = PlayBase & { kind: 'reaction'; effects: ConditionalReactionEffect[] }
export type MasterPlay = PlayBase & {
    kind: 'master'
    // 'discard' by default
    staysInPlay?: StaysInPlay
    effects?: MasterEffect[]
    onPlay?: MasterOnPlay
    abilities?: MasterAbility[]
}

export type Play = ActionPlay | ModifierPlay | CombatPlay | ReactionPlay | MasterPlay

export type PlayOfKind<K extends CardKind> = Extract<Play, { kind: K }>

// What a crypt card adds to itself, whatever the text says
export type CryptStatics = {
    // On top of the default bleed
    bleed?: number
    // On top of the default strength
    strength?: number
    // Can enter combat with a minion of another Methuselah as a directed action
    canEnterCombat?: boolean
    // Added to the stealth of the actions that are not directed at another Methuselah
    undirectedStealth?: number
    // Must bleed in the minion phase while the Methuselah controls a locked minion
    mustBleedWhileMinionLocked?: boolean
    // Hand size of the controller while the vampire is ready
    handSize?: number
    // What the vampire does when an event is announced ( optional ones are decisions )
    triggers?: Trigger[]
}

export type CardDef = {
    id: KrcgId
    // Checked against the cardbase by the catalog check
    name: string
    plays: Play[]
    crypt?: CryptStatics
}
