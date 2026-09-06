/** Game types **/
import { Player } from '@/shared/model/Player.ts'
import { Card, LibraryCard, Minion } from '@/shared/model/Card.ts'
import { DisciplineLevel } from '@/shared/const/model.ts'
import { AnyCardRegion, CardOid, CardRegionOid, PlayerOid, Point2D } from '@/shared/types/model.ts'
import { KrcgId } from '@/shared/types/gateway.ts'

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
 * Flags for Conductor
 */
export const NO_BLOCK = 'NO_BLOCK' as const // No block for this impulse
export const NO_ACTION_MODIFIER = 'NO_ACTION_MODIFIER' as const // No action modifier for this impulse
export const NO_COMBAT = 'NO_COMBAT' as const // No combat card for this impulse
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

export type ActionState = {
    minionAction: MinionAction
    blockingDecision: Minion | typeof NO_BLOCK | null
    stealth: number
    intercept: number
    bleed: number
    hunt: number
    impulsePlayer: Player
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
export type CombatantMinion = {
    minion: Minion
    strength: number
    strike: null
}

export type CombatState = {
    acting: CombatantMinion
    defending: CombatantMinion
    impulsePlayer: Player
    range: null
    pressed: null
}

/** Minion Actions **/

export enum MinionActionType {
    Bleed = 'Bleed',
    Hunt = 'Hunt',
    LeaveTorpor = 'LeaveTorpor',
    RescueFromTorpor = 'RescueFromTorpor',
    Diablerize = 'Diablerize',
    BecomeAnarch = 'BecomeAnarch',
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
    ActionCardFromHand: 'Action Card From Hand',
    ActionInPlay: 'Action In Play',
}

// Needs to be evolved to account for multi-discipline cards and multi-type cards
export type LibraryCardUsage = {
    level?: DisciplineLevel
    target?: Card | Player
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
    | ActionCardFromHandAction
    | ActionInPlayAction

export type ActionModifier = Declaration & {
    type: typeof ActionModifierType
    card: LibraryCard
    usage: LibraryCardUsage
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
}
