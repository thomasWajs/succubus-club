import { CryptCard, Minion } from '@/shared/model/Card.ts'
import { LibraryCardUsage, Validity } from '@/shared/types/state.ts'
import { DisciplineLevel } from '@/shared/const/model.ts'
import { Player } from '@/shared/model/Player.ts'

export type CryptCardImplementation = {
    adapt: (card: CryptCard) => void
}

export abstract class ActionCardImplementation {
    constructor(
        public player: Player,
        public usage: LibraryCardUsage,
    ) {}

    // Convenience for single-discipline cards : the level of the ( first )
    // declared discipline use, if any.
    get level(): DisciplineLevel | undefined {
        return this.usage.disciplines?.[0]?.level
    }

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

    // Convenience for single-discipline cards : the level of the ( first )
    // declared discipline use, if any.
    get level(): DisciplineLevel | undefined {
        return this.usage.disciplines?.[0]?.level
    }

    abstract apply(): void
}
