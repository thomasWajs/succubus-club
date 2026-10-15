import { Discipline, DisciplineLevel } from '@/shared/const/model.ts'
import { Disciplines } from '@/shared/types/resources.ts'
import { OpponentPrior } from '@/shared/bot/utility/profile.ts'
import { Role } from '@/shared/bot/utility/summaries.ts'

/**
 * Disciplines as evidence of what a Methuselah can hold. A vampire in play with a discipline says
 * which cards its deck plausibly has: a few rows of data, not a tag per card. A row gives, for a deck
 * that has a vampire with the discipline at that level, how much its library share of each role
 * rises ABOVE the prior ( a lift ), measured on the tournament decks since 2020. A lift of 0.005 only says that the
 * discipline can play a card of the role ( combat cards need it ), not that it raises the share.
 */

type CapabilityRow = {
    discipline: Discipline
    level: DisciplineLevel
    density: Partial<Record<Role, number>>
}

const INF = DisciplineLevel.INFERIOR
const SUP = DisciplineLevel.SUPERIOR

export const CAPABILITY_TABLE: CapabilityRow[] = [
    // Stealth
    { discipline: Discipline.Obfuscate, level: INF, density: { stealth: 0.08 } },
    { discipline: Discipline.Obfuscate, level: SUP, density: { stealth: 0.115 } },
    { discipline: Discipline.Celerity, level: INF, density: { strike: 0.005, stealth: 0.005 } },
    {
        discipline: Discipline.Celerity,
        level: SUP,
        density: { strike: 0.005, additionalStrike: 0.045, stealth: 0.005, unlock: 0.012 },
    },
    // Intercept and wake
    { discipline: Discipline.Auspex, level: INF, density: { intercept: 0.005, wake: 0.018 } },
    {
        discipline: Discipline.Auspex,
        level: SUP,
        density: { intercept: 0.023, wake: 0.035, bounce: 0.035 },
    },
    // Big bleeds and bounces
    {
        discipline: Discipline.Dominate,
        level: INF,
        density: { bounce: 0.038, bleedBonus: 0.01 },
    },
    {
        discipline: Discipline.Dominate,
        level: SUP,
        density: { bounce: 0.045, bleedBonus: 0.012 },
    },
    // Dodge: the cards that a Presence vampire plays do not raise the share
    { discipline: Discipline.Presence, level: INF, density: { dodge: 0.005 } },
    { discipline: Discipline.Presence, level: SUP, density: { dodge: 0.005, unlock: 0.008 } },
    // Unlock cards ( Freak Drive, Forced March ): a minion acts again, or acts then blocks
    { discipline: Discipline.Fortitude, level: INF, density: { prevention: 0.015, unlock: 0.021 } },
    { discipline: Discipline.Fortitude, level: SUP, density: { prevention: 0.024, unlock: 0.037 } },
    // Damage
    { discipline: Discipline.Potence, level: INF, density: { strike: 0.01 } },
    { discipline: Discipline.Potence, level: SUP, density: { strike: 0.02 } },
    { discipline: Discipline.Quietus, level: INF, density: { strike: 0.005 } },
    { discipline: Discipline.Quietus, level: SUP, density: { strike: 0.005 } },
    {
        discipline: Discipline.Protean,
        level: INF,
        density: { strike: 0.005, maneuver: 0.005, unlock: 0.027 },
    },
    {
        discipline: Discipline.Protean,
        level: SUP,
        density: { strike: 0.005, maneuver: 0.005, unlock: 0.04 },
    },
    { discipline: Discipline.Vicissitude, level: INF, density: { strike: 0.01 } },
    { discipline: Discipline.Vicissitude, level: SUP, density: { strike: 0.01 } },
    // Versatile
    { discipline: Discipline.Animalism, level: INF, density: { maneuver: 0.005, wake: 0.016 } },
    { discipline: Discipline.Animalism, level: SUP, density: { maneuver: 0.005, wake: 0.022 } },
]

// A title is evidence too: some cards need a titled vampire ( Bait and Switch, a bounce, a baron ). Not
// measured, a guess like the rest of the roles that no discipline shows
export const TITLE_TABLE: Record<string, Partial<Record<Role, number>>> = {
    baron: { bounce: 0.04 },
}

function rowsOf(discipline: Discipline): CapabilityRow[] {
    return CAPABILITY_TABLE.filter(row => row.discipline == discipline)
}

// What a minion with these disciplines ( and this title ) can plausibly use: the best level it has of each
// discipline
export function capabilitiesOf(
    disciplines: Partial<Disciplines>,
    title = '',
): Partial<Record<Role, number>> {
    const result: Partial<Record<Role, number>> = {}
    const add = (density: Partial<Record<Role, number>>) => {
        for (const [role, value] of Object.entries(density) as [Role, number][]) {
            result[role] = Math.max(result[role] ?? 0, value)
        }
    }
    for (const [name, level] of Object.entries(disciplines) as [Discipline, DisciplineLevel][]) {
        add(
            rowsOf(name)
                .filter(candidate => candidate.level <= level)
                .toSorted((a, b) => b.level - a.level)[0]?.density ?? {},
        )
    }
    add(TITLE_TABLE[title] ?? {})
    return result
}

// The best level at which the disciplines can play a card of the role ( 0 when they cannot )
export function levelFor(disciplines: Partial<Disciplines>, role: Role): number {
    return CAPABILITY_TABLE.reduce(
        (best, row) =>
            (row.density[role] ?? 0) > 0 && (disciplines[row.discipline] ?? 0) >= row.level ?
                Math.max(best, row.level)
            :   best,
        0,
    )
}

// Can a minion with these disciplines ( and this title ) plausibly use a card of the role
export function mayUseRole(disciplines: Partial<Disciplines>, role: Role, title = ''): boolean {
    return (capabilitiesOf(disciplines, title)[role] ?? 0) > 0
}

// Several minions with the same discipline make it a safer bet: half the doubt is lifted by each
export function evidenceWeight(minions: number): number {
    return 1 - 0.5 ** minions
}

// How much a role is seen on the cards a Methuselah played: each one raises the share a little
const SEEN_BOOST = 0.03

/**
 * The share of the library of a Methuselah that has each role, from the neutral prior, the
 * disciplines of the minions it has in play and the roles of the cards on its ash heap. Evidence only
 * adds: with nothing on the table it is the prior.
 */
export function roleDensities(
    minions: Partial<Disciplines>[],
    seenRoles: Partial<Record<Role, number>>,
    prior: OpponentPrior,
    titles: string[] = [],
): Partial<Record<Role, number>> {
    const roles = new Set<Role>(Object.keys(prior.density) as Role[])
    for (const role of Object.keys(seenRoles) as Role[]) {
        roles.add(role)
    }
    const evidence = [
        ...minions.map(disciplines => capabilitiesOf(disciplines)),
        ...titles.map(title => capabilitiesOf({}, title)),
    ]
    for (const capability of evidence) {
        for (const role of Object.keys(capability) as Role[]) {
            roles.add(role)
        }
    }

    const result: Partial<Record<Role, number>> = {}
    for (const role of roles) {
        let missing = 1 - (prior.density[role] ?? 0)
        // Each discipline counts once, as many times as the minions that have it, in the weight
        for (const discipline of Object.values(Discipline)) {
            const having = minions.filter(disciplines => (disciplines[discipline] ?? 0) > 0)
            if (having.length == 0) {
                continue
            }
            const best = having
                .map(
                    disciplines =>
                        capabilitiesOf({ [discipline]: disciplines[discipline] })[role] ?? 0,
                )
                .reduce((max, density) => Math.max(max, density), 0)
            missing *= 1 - best * evidenceWeight(having.length)
        }
        // A title counts like a discipline: once, as many times as the minions that have it
        for (const title of new Set(titles.filter(name => name != ''))) {
            const having = titles.filter(name => name == title).length
            missing *= 1 - (TITLE_TABLE[title]?.[role] ?? 0) * evidenceWeight(having)
        }
        missing *= (1 - SEEN_BOOST) ** (seenRoles[role] ?? 0)
        result[role] = 1 - missing
    }
    const total = Object.values(result).reduce((sum, density) => sum + density, 0)
    if (total > prior.budget) {
        for (const role of roles) {
            result[role] = (result[role] ?? 0) * (prior.budget / total)
        }
    }
    return result
}
