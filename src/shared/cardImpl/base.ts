import { CryptCard, Minion } from '@/shared/model/Card.ts'
import { CombatStrike, LibraryCardUsage, Validity } from '@/shared/types/state.ts'
import { DisciplineLevel } from '@/shared/const/model.ts'

export type CryptCardImplementation = {
    adapt: (card: CryptCard) => void
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
    | { type: 'strike'; strike: CombatStrike }
    // A maneuver, with the strike it also chooses when it comes from a strike card
    | { type: 'maneuver'; strike?: CombatStrike }
    | { type: 'press' }
    | { type: 'prevent'; amount: number; aggravated: boolean }

export abstract class CombatCardImplementation extends CardImplementation {
    get combat() {
        return this.player.gameState.combat
    }

    // The effects the card could give right now ( at the declared level ). It checks the
    // conditions of the card ( "first round only" ) ; the step it is played in is checked
    // by the combat engine, from the kind of effect.
    abstract getEffects(): CombatCardEffect[]
}

export abstract class ActionModifierCardImplementation extends CardImplementation {
    abstract apply(): void
}
