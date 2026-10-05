import { Card } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { Discipline, DisciplineLevel } from '@/shared/const/model.ts'
import { LibraryCardUsage } from '@/shared/types/state.ts'

// A usage built from a single discipline at a single level ( with an optional
// target ). Covers the common case where a card is played with just one
// discipline, sparing callers the nested disciplines array.
export function singleDisciplineUsage(
    discipline: Discipline,
    level: DisciplineLevel,
    target?: Card | Player,
): LibraryCardUsage {
    return { disciplines: [{ discipline, level }], target }
}

// The " X=n " fragment appended to usage log lines, or an empty string when no X
// value has been declared.
export function usageXLog(usage: LibraryCardUsage): string {
    return usage.x !== undefined ? ` X=${usage.x}` : ''
}

// Whether two usages declare the same set of discipline uses ( order-independent ),
// ignoring the target. Used to skip no-op usage updates in the log.
export function sameDisciplineUses(a: LibraryCardUsage, b: LibraryCardUsage): boolean {
    const key = (usage: LibraryCardUsage) =>
        (usage.disciplines ?? [])
            .map(use => `${use.discipline}:${use.level}`)
            .sort()
            .join('|')
    return key(a) == key(b)
}
