import { CryptCard, LibraryCard, Minion, Vampire } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { CombatStrike, Invalid, LibraryCardUsage, VALID, Validity } from '@/shared/types/state.ts'
import { DisciplineLevel } from '@/shared/const/model.ts'

export type CryptCardImplementation = {
    // Changes the attributes of the card itself
    adapt?: (card: CryptCard) => void
    // Added to the hand size of the controller while the vampire is ready
    handSizeBonus?: number
    // The vampire can enter combat with a minion of another Methuselah as a directed action
    canEnterCombat?: boolean
    // Added to the stealth of the actions that are not directed at another Methuselah
    undirectedStealth?: number
    // Must bleed in the minion phase while the Methuselah controls a locked minion
    mustBleedWhileMinionLocked?: boolean
}

// The play context shared by the action, action modifier and combat cards: the
// minion the card is played by ( or for ) and how the card is used.
export abstract class CardImplementation {
    constructor(
        public minion: Minion,
        public usage: LibraryCardUsage,
    ) {}

    get player() {
        return this.minion.controller
    }

    // Convenience for single-discipline cards : the level of the ( first )
    // declared discipline use, if any.
    get level(): DisciplineLevel | undefined {
        return this.usage.disciplines?.[0]?.level
    }
}

export abstract class ActionCardImplementation extends CardImplementation {
    // The targets worth trying for a bot, at the declared level ( usage.target is
    // not set yet ). Each one is still checked by canDeclare. The default covers the
    // targets of directed cards : nobody, another player, an own uncontrolled vampire.
    // A card aiming elsewhere ( an ally, a retainer... ) overrides it.
    getTargets(): LibraryCardUsage['target'][] {
        const others = this.player.gameState.competingPlayers.filter(other => other != this.player)
        return [undefined, ...others, ...this.player.vampiresInUncontrolled]
    }

    abstract canDeclare(): Validity

    // What the card does as soon as it is declared ( a bleed amount ). Most have nothing.
    declare(): void {}

    abstract resolve(): void

    abstract getStealth(): number

    // The strength the acting minion can gain in the first round if the action is blocked
    get blockedStrengthBonus(): number {
        return 0
    }

    get isBleed() {
        return false
    }

    get isHunt() {
        return false
    }
}

// What a combat card gives to the minion playing it. The card itself is
// attached by the caller ( the strike's source, the cost to pay ).
export type CombatCardEffect =
    // An additional strike can come with the strike card
    | { type: 'strike'; strike: CombatStrike; additional?: { limited: boolean } }
    // A maneuver, with the strike it also chooses when it comes from a strike card
    | { type: 'maneuver'; strike?: CombatStrike }
    | { type: 'press' }
    | { type: 'prevent'; amount: number; aggravated: boolean }
    // The strength of the minion for the rest of the combat
    | { type: 'setStrength'; amount: number }
    // Played in the window after a pair of strikes
    | { type: 'additionalStrike'; limited: boolean }
    | { type: 'grapple'; press: boolean; closeNextRound: boolean }
    | { type: 'gainBlood'; amount: number }

export abstract class CombatCardImplementation extends CardImplementation {
    get combat() {
        return this.player.gameState.combat
    }

    // The effects the card could give right now ( at the declared level ). It checks the
    // conditions of the card ( "first round only" ) ; the step it is played in is checked
    // by the combat engine, from the kind of effect.
    abstract getEffects(): CombatCardEffect[]
}

// What a reaction card does to the action in progress, once played by a reacting minion
export type ReactionCardEffect =
    // A bounce: the new target of the action ( who gets a new chance to block and react ).
    // The reacting minion is locked when the card says so.
    | { type: 'changeTarget'; target: Player; lockMinion: boolean }
    // More intercept for the block attempt of the reacting player
    | { type: 'intercept'; amount: number }
    // The reacting minion wakes: it may block and react while locked, until the end of the action
    | { type: 'wake' }
    // A locked minion is unlocked and attempts to block, with more intercept
    | { type: 'unlockBlock'; target: Minion; intercept: number }

export abstract class ReactionCardImplementation extends CardImplementation {
    // A locked minion that is not awake may play the card ( "only usable by a locked minion" )
    get usableWhileLocked(): boolean {
        return false
    }

    // The minion can play this card only once between its unlock phases
    get oncePerUnlock(): boolean {
        return false
    }

    // The effects the card could have right now ( at the declared level ). It checks the
    // conditions of the card ( "only usable if a minion is bleeding you" ).
    abstract getEffects(): ReactionCardEffect[]
}

export abstract class ActionModifierCardImplementation extends CardImplementation {
    // Whether the modifier can be played at the declared level in the action in progress
    canPlay(): Validity {
        return VALID
    }

    abstract apply(): void
}

// A master card is played by a Methuselah, not by a minion : no usage, no discipline
export abstract class MasterCardImplementation {
    constructor(
        public player: Player,
        public card: LibraryCard,
    ) {}

    // Locations and "Put this card in play" cards stay in play ; the others go to the ash heap
    abstract get staysInPlay(): boolean

    // Added to the hand size of the controller while the card is in play
    get handSizeBonus(): number {
        return 0
    }

    // The vampires the effect of the card on play can be aimed at ( "add 1 blood to a ready
    // vampire" ), or null when the card has no targeted effect on play. With no vampire to aim
    // at, the card is not worth playing.
    getPlayTargets(): Vampire[] | null {
        return null
    }

    applyPlayEffect(_vampire: Vampire): Validity {
        return Invalid('The card has no effect on play')
    }

    // "You can lock this card to discard a card from your hand": whether the card can be used now
    // ( it is unlocked ). Usable at any time: the bot looks at it in its master and discard phases.
    hasLockAbility(): boolean {
        return false
    }

    // Locks the card and discards the card of the hand ( the caller draws back up )
    applyLockEffect(_discarded: LibraryCard): Validity {
        return Invalid('The card has no lock ability')
    }

    // The ways to use the abilities paid with transfers ( influence phase ): the index of the
    // ability, and the uncontrolled card removed from the game when the ability does that
    getTransferOptions(): { ability: number; removed?: CryptCard }[] {
        return []
    }

    applyTransferEffect(_ability: number, _removed?: CryptCard): Validity {
        return Invalid('The card has no ability paid with transfers')
    }

    // The vampires the card can be used on during its controller's unlock phase, once the
    // cards are unlocked ( "a ready vampire you control can gain 1 blood" ). Used at most once
    // per turn: the caller checks it.
    getUnlockEffectTargets(): Vampire[] {
        return []
    }

    applyUnlockEffect(_vampire: Vampire): Validity {
        return Invalid('The card has no unlock effect')
    }
}
