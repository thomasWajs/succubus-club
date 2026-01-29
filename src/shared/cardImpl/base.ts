import { CryptCard, Minion } from '@/shared/model/Card.ts'
import { LibraryCardUsage, Validity } from '@/shared/types/state.ts'
import { Player } from '@/shared/model/Player.ts'

export type CryptCardImplementation = {
    adapt: (card: CryptCard) => void
}

export abstract class ActionCardImplementation {
    constructor(
        public player: Player,
        public usage: LibraryCardUsage,
    ) {}

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
    constructor(
        public player: Player,
        public usage: LibraryCardUsage,
    ) {}
    abstract apply(): void
}
