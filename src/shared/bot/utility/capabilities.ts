import { Discipline, DisciplineLevel } from '@/shared/const/model.ts'
import { Disciplines } from '@/shared/types/resources.ts'
import { OpponentPrior } from '@/shared/bot/utility/profile.ts'
import { Role } from '@/shared/bot/utility/summaries.ts'

/**
 * Disciplines as evidence of what a Methuselah can hold ( .claude/docs/bot-ai-phase3.md, section 3b
 * point 4 ). A vampire in play with a discipline says which cards its deck plausibly has: a few rows
 * of hand-written data, not a tag per card. A row gives, for a deck that has a vampire with the
 * discipline at that level, the share of its library that carries each role.
 *
 * THE NUMBERS ARE A DRAFT for the author to check ( then validated against the cardbase and the TWDA,
 * step 3.7 ): they are orders of magnitude from the strategy primers, not measures.
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
    { discipline: Discipline.Obfuscate, level: INF, density: { stealth: 0.1 } },
    { discipline: Discipline.Obfuscate, level: SUP, density: { stealth: 0.16 } },
    { discipline: Discipline.Celerity, level: INF, density: { strike: 0.06, stealth: 0.04 } },
    {
        discipline: Discipline.Celerity,
        level: SUP,
        density: { strike: 0.1, additionalStrike: 0.06, stealth: 0.06, unlock: 0.03 },
    },
    // Intercept and wake
    { discipline: Discipline.Auspex, level: INF, density: { intercept: 0.06, wake: 0.05 } },
    {
        discipline: Discipline.Auspex,
        level: SUP,
        density: { intercept: 0.1, wake: 0.08, bounce: 0.04 },
    },
    // Big bleeds and bounces
    {
        discipline: Discipline.Dominate,
        level: INF,
        density: { bounce: 0.05, bleedBonus: 0.06 },
    },
    {
        discipline: Discipline.Dominate,
        level: SUP,
        density: { bounce: 0.08, bleedBonus: 0.1 },
    },
    // Defence: dodge, and the combat ends strikes the roles do not name yet
    { discipline: Discipline.Presence, level: INF, density: { dodge: 0.06 } },
    { discipline: Discipline.Presence, level: SUP, density: { dodge: 0.1, unlock: 0.03 } },
    // Unlock cards ( Freak Drive, Forced March ): a minion acts again, or acts then blocks
    { discipline: Discipline.Fortitude, level: INF, density: { prevention: 0.06, unlock: 0.03 } },
    { discipline: Discipline.Fortitude, level: SUP, density: { prevention: 0.1, unlock: 0.05 } },
    // Damage
    { discipline: Discipline.Potence, level: INF, density: { strike: 0.1 } },
    { discipline: Discipline.Potence, level: SUP, density: { strike: 0.16 } },
    { discipline: Discipline.Quietus, level: INF, density: { strike: 0.08 } },
    { discipline: Discipline.Quietus, level: SUP, density: { strike: 0.12 } },
    {
        discipline: Discipline.Protean,
        level: INF,
        density: { strike: 0.06, maneuver: 0.05, unlock: 0.02 },
    },
    {
        discipline: Discipline.Protean,
        level: SUP,
        density: { strike: 0.1, maneuver: 0.08, unlock: 0.04 },
    },
    { discipline: Discipline.Vicissitude, level: INF, density: { strike: 0.08 } },
    { discipline: Discipline.Vicissitude, level: SUP, density: { strike: 0.14 } },
    // Versatile
    { discipline: Discipline.Animalism, level: INF, density: { maneuver: 0.04, wake: 0.04 } },
    { discipline: Discipline.Animalism, level: SUP, density: { maneuver: 0.06, wake: 0.06 } },
]

// A title is evidence too: some cards need a titled vampire ( Bait and Switch, a bounce, a baron ). Draft
// numbers like the rest of the table.
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
