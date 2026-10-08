/** Game types **/
import { Player } from '@/shared/model/Player.ts'
import { Card, LibraryCard, Minion } from '@/shared/model/Card.ts'
import { Discipline, DisciplineLevel } from '@/shared/const/model.ts'
import { AnyCardRegion, CardOid, CardRegionOid, PlayerOid, Point2D } from '@/shared/types/model.ts'
import { KrcgId } from '@/shared/types/gateway.ts'
import { Trigger, TriggerEffect } from '@/shared/cardImpl/catalog/types.ts'

export enum GameType {
    Unset = 'Unset',
    TrainBot = 'TrainBot',
    Multiplayer = 'Multiplayer',
    Puppeteer = 'Puppeteer',
}

/** Mutation validity **/

// A response object that tells if a mutation/action can be applied/declared
export class Validity {
    constructor(
        public isValid: boolean,
        public reason: string,
    ) {}
}

export const VALID = new Validity(true, '')
export const Invalid = (reason: string) => new Validity(false, reason)

// A marker for game mutations that can be done by any player
export const ANY_PLAYER = 'ANY_PLAYER' as const
/**
 * Declined impulses
 */
export const NO_BLOCK = 'NO_BLOCK' as const // No block for this impulse
export const NO_ACTION_MODIFIER = 'NO_ACTION_MODIFIER' as const // No action modifier for this impulse
export const NO_REACTION = 'NO_REACTION' as const // No reaction for this impulse

/**
 * Card attributes a player can adjust by hand during play.
 */
export enum CardBaseAttribute {
    Bleed = 'bleed',
    Stealth = 'stealth',
    Intercept = 'intercept',
    Strength = 'strength',
    Hunt = 'hunt',
    Vote = 'vote',
    Ballot = 'ballot',
}

/** Action state **/

export enum ActionProperty {
    Stealth = CardBaseAttribute.Stealth,
    Intercept = CardBaseAttribute.Intercept,
    Bleed = CardBaseAttribute.Bleed,
    Hunt = CardBaseAttribute.Hunt,
}

// A single player's block decision : either a minion attempting the block, or
// NO_BLOCK when they decline. Several players may decide on the same action
// ( e.g. on an undirected action, prey declines while predator blocks ).
export type BlockingDecision = {
    player: Player
    block: Minion | typeof NO_BLOCK
}

// An effect of a trigger that waits for a later event, with the minion it is about
export type DeferredTriggerEffect = { effect: TriggerEffect; minion: Minion }

// A trigger armed by a played card: it lives with the action. Plain data ( the catalog trigger is
// copied by value ), so it survives the serialization of the state.
export type ArmedTrigger = {
    trigger: Trigger
    deferred: DeferredTriggerEffect[]
}

// An optional trigger whose controller has not decided yet ( use it or not ): it is a decision
// of the controller, before anything else goes on. `index` is the position of the trigger in the
// triggers of the card.
export type PendingTrigger = { source: Minion; index: number }

export type ActionState = {
    minionAction: MinionAction
    blockingDecisions: BlockingDecision[]
    // Minions that attempted a block during this action. Unlike blockingDecisions
    // it survives a failed block, so the referee can avoid offering a retry.
    blockAttempters: Minion[]
    // Minions woken by a card: they ignore the requirement to be unlocked to block and to react,
    // until the end of the action
    awakeMinions: Minion[]
    // The minions that played a card giving a maneuver in the combat resulting from their block
    // ( one entry per card played )
    blockManeuvers: Minion[]
    // The triggers armed by the cards played in this action, for the rest of it
    armedTriggers: ArmedTrigger[]
    // The modifiers and reactions each minion played (krcgId): a minion plays a given card once per action
    playedCards: { minion: Minion; krcgId: string }[]
    // The minion whose block was resolved as a success: the action is no longer open to modifiers
    // and reactions, it only waits for the combat of the block ( if any ) and for the cards made
    // for this window ( the post block window: Cats' Guidance ), a decision of a bot only. Then
    // the action ends, unsuccessful.
    blockResolved: Minion | null
    stealth: number
    intercept: number
    bleed: number
    hunt: number
    impulsePlayer: Player
    // Everything the others need to react is known. True at once for a bot and for the built-in
    // actions; a human's action card turns it true with the "Declare" button of its usage box.
    declared: boolean
    // Everybody who could react passed on the action of a human, who has the impulse back to end it
    // by hand. Nothing is left to pass until something new happens (see regainImpulse).
    reactionsPassed: boolean
}

/** Referendum state **/

export enum VoteSide {
    InFavour = 'InFavour',
    Against = 'Against',
}

// Both sides, to iterate over a VoteCount
export const VOTE_SIDES = [VoteSide.InFavour, VoteSide.Against] as const

/**
 * The votes a single vampire brings to a referendum.
 *
 * `side` is null while the vampire has not picked a side yet. Such a vote is
 * still kept ( so a tweaked amount survives ) but it is not tallied.
 */
export type CastVote = {
    side: VoteSide | null
    amount: number
}

// A number of votes on each side : a player's extra votes, or a whole tally
export type VoteCount = Record<VoteSide, number>

export type ReferendumState = {
    // CardOid of the voting vampire ==> the votes it casts
    votes: Record<CardOid, CastVote>
    /**
     * CardOid of a ballot-bearing vampire ( a priscus ) ==> the ballots it casts
     * in the priscii subreferendum. Priscii bring ballots instead of votes : the
     * subreferendum is tallied on its own, and its winning side then grants a
     * fixed number of votes to the main referendum ( none on a tie ).
     */
    ballots: Record<CardOid, CastVote>
    /**
     * PlayerOid ==> the votes that player brings without a vampire behind them :
     * burning the edge, discarding a political card, activating a card in play...
     *
     * We deliberately don't model where they come from, only how many go to each
     * side : the sources are too varied to enumerate, and the referendum
     * interface tallies what players announce rather than deriving it. One
     * counter per side, because a player may split them in opposite directions.
     */
    playerVotes: Record<PlayerOid, VoteCount>
    // Author's Date.now() when the last call countdown started ( null = no last call pending )
    lastCallStartTime: number | null
}

/** Combat state **/

// The steps of a combat round, in order. The strike and damage resolution steps are repeated for
// each pair of strikes: after the pairs, a window to gain additional strikes
export enum CombatStep {
    BeforeRange = 'BeforeRange',
    DetermineRange = 'DetermineRange',
    BeforeStrikes = 'BeforeStrikes',
    Strike = 'Strike',
    DamageResolution = 'DamageResolution',
    AdditionalStrikes = 'AdditionalStrikes',
    Press = 'Press',
    EndOfRound = 'EndOfRound',
}

export enum CombatRange {
    Close = 'Close',
    Long = 'Long',
}

// What a minion does in the strike step: a hand strike, or whatever a card, a
// weapon or an ability gives. A dodge is a strike that deals nothing.
export type CombatStrike = {
    name: string
    // The card providing the strike, null for a hand strike
    source: Card | null
    damage: number
    aggravated: boolean
    // Usable at long range ( "R" damage or a ranged strike )
    ranged: boolean
    dodge: boolean
    // A strike that is a hand strike, whatever its damage ( the grapple only allows these )
    isHand: boolean
    // The opposing dodge does not protect from it
    undodgeable: boolean
    combatEnds: boolean
    firstStrike: boolean
    // Blood ( or life ) moved from the opposing minion to the striking one
    stealBlood: number
    // A retainer of the opposing minion the strike is aimed at, instead of the minion
    retainer?: Card
}

export type PendingDamage = {
    regular: number
    aggravated: number
}

export type CombatantMinion = {
    minion: Minion
    strength: number
    strike: CombatStrike | null
    // Damage inflicted by the strikes just resolved, not yet mended
    pendingDamage: PendingDamage
    // Blood burned to damage this round ( the amount that Taste of Vitae gives back )
    bloodLost: number
    // Additional strikes gained and not used yet, and whether a limited card gave one this round
    additionalStrikes: number
    limitedAdditionalGained: boolean
    // Chooses a strike in the current pair ( always in the first one )
    strikesInPair: boolean
    // Presses given by a card played this round and not used yet
    pressesGranted: number
    // A strength bonus the combatant can take before the range of the first round ( Show of Force )
    strengthBonus: number
    // Maneuvers the combatant can play without a card ( given by a reaction when it blocked )
    freeManeuvers: number
    // Regular damage the combatant takes each round from the combat cards played against it
    // ( Carrion Crows ), on top of what the retainers of the opposing minion inflict
    environmentalDamage: number
}

export type CombatState = {
    acting: CombatantMinion
    defending: CombatantMinion
    round: number
    step: CombatStep
    range: CombatRange
    // Who may act in the current window of the current step
    impulsePlayer: Player
    // Maneuver and press windows: who played the last maneuver / press there.
    // A minion cannot play two in a row.
    lastPlayedBy: Player | null
    // A press to continue is standing
    pressed: boolean
    // Strikes of tiers up to this one are resolved ( see combatState.ts )
    resolvedStrikeTier: number
    // 0 for the normal pair of strikes, then 1 for each pair of additional strikes
    strikePair: number
    // Only hand strikes can be used this round ( grapple )
    handStrikesOnly: boolean
    // The next round is at close range and skips the determine range step
    closeNextRound: boolean
    // The krcgIds of the combat cards each minion ( by oid ) played this round
    playedThisRound: Record<string, string[]>
    // Same for the whole combat
    playedThisCombat: Record<string, string[]>
    // The environmental damage of the round is inflicted ( once per round, with the normal strikes )
    environmentalApplied: boolean
    // The oids of the weapons that gave their maneuver in this combat ( once per combat, even if
    // the bearer changes )
    weaponManeuvers: string[]
    // The oids of the attached cards that prevented damage in this combat ( once per combat )
    attachedPreventions: string[]
    // The combat ends after the end of round step
    isOver: boolean
}

/** Minion Actions **/

export enum MinionActionType {
    Bleed = 'Bleed',
    Hunt = 'Hunt',
    LeaveTorpor = 'LeaveTorpor',
    RescueFromTorpor = 'RescueFromTorpor',
    Diablerize = 'Diablerize',
    BecomeAnarch = 'BecomeAnarch',
    EnterCombat = 'EnterCombat',
    ActionCardFromHand = 'ActionCardFromHand',
    ActionInPlay = 'ActionInPlay',
}
export const ActionModifierType = 'ActionModifier'
export const ReactionType = 'Reaction'
export type DeclarationType = MinionActionType | typeof ActionModifierType | typeof ReactionType

export const MinionActionNames = {
    Bleed: 'Bleed',
    Hunt: 'Hunt',
    LeaveTorpor: 'Leave torpor',
    RescueFromTorpor: 'Rescue from torpor',
    Diablerize: 'Diablerize',
    BecomeAnarch: 'Become anarch',
    EnterCombat: 'Enter combat',
    ActionCardFromHand: 'Action Card From Hand',
    ActionInPlay: 'Action In Play',
}

// A single discipline used at a given level to play a card, e.g. Potence at
// inferior. Derived from the card text's bracket codes ( [pot] / [POT] ).
export type DisciplineUse = {
    discipline: Discipline
    level: DisciplineLevel
}

// How a card is played : the discipline(s) the player declares using ( most
// cards need a single choice, a few allow several at once ) and the target of a
// directed action. Both are optional : declaration is non-blocking, so a usage
// may be filled in ( or amended ) after the action is declared, or left empty.
export type LibraryCardUsage = {
    disciplines?: DisciplineUse[]
    target?: Card | Player
    // The chosen value of a variable "X" cost ( blood or pool ) when the card's
    // cost is "X". Undefined means "not declared yet", like target / disciplines.
    x?: number
}

export type Declaration = {
    type: DeclarationType
}

export type BaseMinionAction = Declaration & {
    type: MinionActionType
    actingMinion: Minion
    target?: Card | Player
}

export type BleedAction = BaseMinionAction & {
    type: MinionActionType.Bleed
    target: Player
}

export type HuntAction = BaseMinionAction & {
    type: MinionActionType.Hunt
}

export type BecomeAnarchAction = BaseMinionAction & {
    type: MinionActionType.BecomeAnarch
}

// A minion that can enter combat with a minion of another Methuselah ( Theo Bell )
export type EnterCombatAction = BaseMinionAction & {
    type: MinionActionType.EnterCombat
    target: Minion
}

export type LeaveTorporAction = BaseMinionAction & {
    type: MinionActionType.LeaveTorpor
}

export type RescueFromTorporAction = BaseMinionAction & {
    type: MinionActionType.RescueFromTorpor
    target: Minion
    bloodPaidByActingMinion?: number
    bloodPaidByRescuedMinion?: number
}

export type DiablerizeAction = BaseMinionAction & {
    type: MinionActionType.Diablerize
    target: Minion
}

export type ActionCardFromHandAction = BaseMinionAction & {
    type: MinionActionType.ActionCardFromHand
    card: LibraryCard
    usage: LibraryCardUsage
}

export type ActionInPlayAction = BaseMinionAction & {
    type: MinionActionType.ActionInPlay
    card: Card
}

export type MinionAction =
    | BleedAction
    | HuntAction
    | LeaveTorporAction
    | RescueFromTorporAction
    | DiablerizeAction
    | BecomeAnarchAction
    | EnterCombatAction
    | ActionCardFromHandAction
    | ActionInPlayAction

export type ActionModifier = Declaration & {
    type: typeof ActionModifierType
    card: LibraryCard
    usage: LibraryCardUsage
    // The minion playing the card, when it is not the acting minion ( a few cards allow it )
    by?: Minion
}

export type Reaction = Declaration & {
    type: typeof ReactionType
    card: LibraryCard
    usage: LibraryCardUsage
}

/** Card Visibility **/

/**
 *  Cards known by a service ( client or server )
 */
export type KnownCards = Record<CardOid, KrcgId>

/**
 * Store which player can or cannot see a given card.
 * Also store a "public" visibility for spectators.
 */
export type PlayerVision = {
    public: boolean
    [key: PlayerOid]: boolean
}

/** Card Revelation **/

export const ALL_PLAYERS = 'all'
export type CardRevelationTarget = Card | AnyCardRegion
export type CardRevelationTargetOid = CardOid | CardRegionOid
export type CardRevelationViewer = typeof ALL_PLAYERS | Player
export type CardRevelation = {
    all: boolean
    [key: PlayerOid]: boolean // One PlayerOid for each Player
}

export function getViewerKey(viewer: CardRevelationViewer) {
    return viewer == ALL_PLAYERS ? ALL_PLAYERS : viewer.oid
}

/** Target Declaration ( Arrow ) **/

export type TargetDeclaration = {
    originOid: CardOid
    targetOid: CardOid | PlayerOid
}

export type Arrow = {
    from: Point2D
    to: Point2D
}

/** Alignment guides **/

export const GUIDE_VERTICAL = 'vertical'
export const GUIDE_HORIZONTAL = 'horizontal'

export interface AlignmentGuide {
    type: typeof GUIDE_VERTICAL | typeof GUIDE_HORIZONTAL
    dragX: number
    dragY: number
    scale: number
    withCards: Card[]
    // Owner-facing rotation shared by every card this guide compares against
    // ( 0 outside Free Table ). The guide's own geometry is built in
    // unrotated table space, so RegionGO.vue must apply this when rendering
    // it to match the ( rotated ) cards it aligns with.
    rotation: number
}

/** Helper for caching model object locations **/

export type LocationIndex = {
    players: Record<PlayerOid, Player>
    table: AnyCardRegion | null
    regions: Map<CardOid, AnyCardRegion>
}
