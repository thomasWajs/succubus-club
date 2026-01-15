import { Player } from '@/model/Player.ts'
import { Card, CryptCard, Minion } from '@/model/Card.ts'
import { DisciplineLevel } from '@/model/const.ts'
import { Validity } from '@/state/types.ts'

// Needs to be evolved to account for multi-discipline cards and multi-type cards
export type LibraryCardUsage = {
    level?: DisciplineLevel
    target?: Card | Player
}

export type CryptCardImplementation = {
    adapt: (card: CryptCard) => void
}

export abstract class ActionCardImplementation {
    constructor(public usage: LibraryCardUsage) {}

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
    constructor(public usage: LibraryCardUsage) {}
    abstract apply(): void
}
