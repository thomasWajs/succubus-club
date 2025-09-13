import { Player } from '@/model/Player.ts'
import { Card, CryptCard, Minion } from '@/model/Card.ts'
import { DisciplineLevel } from '@/model/const.ts'
import { Validity } from '@/state/types.ts'

// Needs to be evolved to account for multi-discipline cards and multi-type cards
export interface ActionCardUsage {
    level?: DisciplineLevel
    target?: Card | Minion | Player
}

export interface ActionModifierUsage {
    level?: DisciplineLevel
}

export abstract class CryptCardImplementation {
    abstract adapt(card: CryptCard): void
}

export abstract class ActionCardImplementation {
    constructor(public usage: ActionCardUsage) {}

    abstract canDeclare(actingMinion: Minion): Validity

    abstract declare(): void

    abstract resolve(): void

    abstract getStealth(): number

    get isBleed() {
        return false
    }

    get isHunt() {
        return false
    }
}

export abstract class ActionModifierCardImplementation {
    constructor(public usage: ActionModifierUsage) {}

    abstract apply(): void
}
