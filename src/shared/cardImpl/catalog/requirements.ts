import { Minion } from '@/shared/model/Card.ts'
import { DisciplineUse, LibraryCardUsage } from '@/shared/types/state.ts'
import {
    CardDef,
    CardKind,
    Play,
    PlayOfKind,
    Requirement,
} from '@/shared/cardImpl/catalog/types.ts'

/**
 * What a play requires, as the ways of declaring it. A way is the list of discipline uses a
 * player announces together ( the same shape as parseCardUsage in usageParsing.ts ).
 */

export type UsageOption = DisciplineUse[]

export function expandRequirement(requirement: Requirement | undefined): UsageOption[] {
    if (!requirement) {
        return [[]]
    }
    switch (requirement.type) {
        case 'none':
            return [[]]
        case 'discipline':
            return [[{ discipline: requirement.discipline, level: requirement.level }]]
        case 'any':
            return requirement.of.flatMap(expandRequirement)
        case 'all':
            return requirement.of.reduce<UsageOption[]>(
                (options, part) =>
                    options.flatMap(option =>
                        expandRequirement(part).map(extra => [...option, ...extra]),
                    ),
                [[]],
            )
    }
}

export function usageOptionKey(option: UsageOption): string {
    return option
        .map(use => `${use.discipline}:${use.level}`)
        .sort()
        .join('|')
}

// A minion has a discipline at a level when it has it at that level or above
export function minionCanUse(minion: Minion, option: UsageOption): boolean {
    return option.every(use => minion.hasDiscipline(use.discipline, use.level))
}

export function playsOfKind<K extends CardKind>(def: CardDef, kind: K): PlayOfKind<K>[] {
    return def.plays.filter((play: Play): play is PlayOfKind<K> => play.kind == kind)
}

// The play of the kind that the way the card is declared corresponds to
export function findPlay<K extends CardKind>(
    def: CardDef,
    kind: K,
    usage: LibraryCardUsage,
): PlayOfKind<K> | undefined {
    const declared = usageOptionKey(usage.disciplines ?? [])
    return playsOfKind(def, kind).find(play =>
        expandRequirement(play.requires).some(option => usageOptionKey(option) == declared),
    )
}

// Every way the minion can play the card as the kind, without duplicates
export function getUsageOptions(minion: Minion, def: CardDef, kind: CardKind): UsageOption[] {
    const seen = new Set<string>()
    const options: UsageOption[] = []
    for (const play of playsOfKind(def, kind)) {
        for (const option of expandRequirement(play.requires)) {
            const key = usageOptionKey(option)
            if (!seen.has(key) && minionCanUse(minion, option)) {
                seen.add(key)
                options.push(option)
            }
        }
    }
    return options
}
