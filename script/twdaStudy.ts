// What the tournament decks say about the capability table of the opponent model
// ( src/shared/bot/utility/capabilities.ts ), with no engine. Run from the repo root:
//   npx tsx script/twdaStudy.ts                the three reports
//   npx tsx script/twdaStudy.ts --table        only the table against the decks
//   npx tsx script/twdaStudy.ts --converge     only the speed at which a profile emerges
//   npx tsx script/twdaStudy.ts --fit          a data-fitted table against the current one, on held-out decks
//   npx tsx script/twdaStudy.ts --classes      the role classifier on a sample of cards, to review
// The roles of a library card are read from its text by a few rules: they are approximate, enough to
// compare shares of a library, not to play a card.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DisciplineLevel } from '@/shared/const/model.ts'
import { CAPABILITY_TABLE, roleDensities } from '@/shared/bot/utility/capabilities.ts'
import { DEFAULT_PROFILE } from '@/shared/bot/utility/profile.ts'
import { Role } from '@/shared/bot/utility/summaries.ts'
import { Disciplines } from '@/shared/types/resources.ts'

type LibraryCard = { id: number; name: string; type: string; text: string; discipline: string }
type CryptCard = { id: number; name: string; disciplines: Record<string, number>; title: string }
type Deck = {
    deckid: string
    cards: Record<string, number>
    crypt_total: number
    library_total: number
    tags: { superior: string[]; base: string[] }
    creation_date: string
}

// Same cutoff as RECENT_CARDS_DATE_CUTOFF in const.py: the decks of today
const RECENT_DECKS_DATE_CUTOFF = '2020-01-01'

const dir = resolve(fileURLToPath(import.meta.url), '..', 'resources')
const read = <T>(file: string): T => JSON.parse(readFileSync(resolve(dir, file), 'utf8')) as T
const library = read<Record<string, LibraryCard>>('cardbase_lib.json')
const crypt = read<Record<string, CryptCard>>('cardbase_crypt.json')
const decks = Object.values(read<Record<string, Deck>>('twdDecks.json')).filter(
    deck =>
        deck.creation_date >= RECENT_DECKS_DATE_CUTOFF &&
        deck.crypt_total >= 4 &&
        deck.library_total >= 60 &&
        deck.library_total <= 90,
)

const STUDIED: Role[] = [
    'stealth',
    'bleedBonus',
    'intercept',
    'wake',
    'bounce',
    'unlock',
    'strike',
    'additionalStrike',
    'dodge',
    'maneuver',
    'prevention',
]

type Rule = { roles: Role; types?: RegExp; text: RegExp }

const RULES: Rule[] = [
    { roles: 'stealth', types: /modifier|combat/i, text: /\+\d+ stealth(?! action)/ },
    { roles: 'bleedBonus', types: /modifier/i, text: /\+\d+ bleed/ },
    { roles: 'intercept', types: /reaction/i, text: /\+\d+ intercept/ },
    { roles: 'wake', types: /reaction/i, text: /usable by a locked (vampire|minion)|\bwake\b/ },
    {
        roles: 'bounce',
        types: /reaction/i,
        text: /change the target of the bleed|is now bleeding your predator|bleeding your predator's/,
    },
    {
        roles: 'unlock',
        types: /modifier|combat|reaction/i,
        text: /unlock (this|the acting) (minion|vampire)|unlock them at the end|unlocks at the end/,
    },
    { roles: 'strike', types: /combat/i, text: /\bstrike: (?!dodge|combat ends)/ },
    { roles: 'additionalStrike', types: /combat/i, text: /additional strike/ },
    { roles: 'dodge', types: /combat/i, text: /\bstrike: dodge|dodge,/ },
    { roles: 'maneuver', types: /combat/i, text: /\bmaneuver\b/ },
    { roles: 'prevention', types: /combat/i, text: /prevent .*damage/ },
]

const rolesCache = new Map<number, Set<Role>>()

function rolesOf(card: LibraryCard): Set<Role> {
    const cached = rolesCache.get(card.id)
    if (cached) {
        return cached
    }
    const text = card.text.toLowerCase()
    const roles = new Set<Role>()
    for (const rule of RULES) {
        if (rule.types && !rule.types.test(card.type)) {
            continue
        }
        if (rule.text.test(text)) {
            roles.add(rule.roles)
        }
    }
    rolesCache.set(card.id, roles)
    return roles
}

type DeckFacts = {
    deck: Deck
    minions: Partial<Disciplines>[]
    cards: { card: LibraryCard; count: number }[]
    density: Partial<Record<Role, number>>
}

function factsOf(deck: Deck): DeckFacts {
    const minions: Partial<Disciplines>[] = []
    const cards: { card: LibraryCard; count: number }[] = []
    for (const [id, count] of Object.entries(deck.cards)) {
        const vampire = crypt[id]
        if (vampire) {
            for (let copy = 0; copy < count; copy++) {
                minions.push(vampire.disciplines as Partial<Disciplines>)
            }
            continue
        }
        const card = library[id]
        if (card) {
            cards.push({ card, count })
        }
    }
    const total = cards.reduce((sum, entry) => sum + entry.count, 0)
    const density: Partial<Record<Role, number>> = {}
    for (const role of STUDIED) {
        const having = cards
            .filter(entry => rolesOf(entry.card).has(role))
            .reduce((sum, entry) => sum + entry.count, 0)
        density[role] = total == 0 ? 0 : having / total
    }
    return { deck, minions, cards, density }
}

const facts = decks.map(factsOf).filter(entry => entry.minions.length >= 4)

const mean = (values: number[]) =>
    values.length == 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
const fixed = (value: number) => value.toFixed(3)

function tableReport() {
    const prior = DEFAULT_PROFILE.opponentPrior
    console.log(`${facts.length} decks with 4+ vampires and a 60-90 card library`)
    console.log('\nPrior against the whole set ( share of the library with the role )')
    for (const role of STUDIED) {
        const measured = mean(facts.map(entry => entry.density[role] ?? 0))
        console.log(
            `  ${role.padEnd(18)} prior ${fixed(prior.density[role] ?? 0)}   decks ${fixed(measured)}`,
        )
    }
    console.log(
        '\nCapability table: for each row, the share of the library with the role in decks that have\n' +
            'a vampire with the discipline at that level, against the decks with no vampire of it.\n' +
            'The table promises the density of a deck WITH the vampire ( one vampire, all of them for\n' +
            'the half-doubt weight ), `lift` is what the vampire really adds.',
    )
    for (const row of CAPABILITY_TABLE) {
        const level = (disciplines: Partial<Disciplines>) => disciplines[row.discipline] ?? 0
        const with_ = facts.filter(entry =>
            entry.minions.some(disciplines => level(disciplines) >= row.level),
        )
        const without = facts.filter(entry => entry.minions.every(m => level(m) == 0))
        for (const role of Object.keys(row.density) as Role[]) {
            const a = mean(with_.map(entry => entry.density[role] ?? 0))
            const b = mean(without.map(entry => entry.density[role] ?? 0))
            console.log(
                `  ${row.discipline.padEnd(11)} ${row.level == DisciplineLevel.SUPERIOR ? 'sup' : 'inf'} ${role.padEnd(18)} table ${fixed(row.density[role] ?? 0)}   with ${fixed(a)} ( ${with_.length} )   without ${fixed(b)} ( ${without.length} )   lift ${fixed(a - b)}`,
            )
        }
    }
}

function randomOf(seed: number) {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6d2b79f5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function shuffled<T>(items: T[], random: () => number): T[] {
    const result = [...items]
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1))
        const held = result[i]
        result[i] = result[j]
        result[j] = held
    }
    return result
}

function convergeReport() {
    const prior = DEFAULT_PROFILE.opponentPrior
    const random = randomOf(7)
    const revealed = [0, 1, 2, 4, 6]
    const played = [0, 4, 8, 16]
    console.log(
        `Mean absolute error of the density, over the studied roles, against the real deck ( ${facts.length} decks, 3 draws each ).\n` +
            `Rows: vampires revealed. Columns: library cards seen on the ash heap. Prior only: ${fixed(
                mean(
                    facts.flatMap(entry =>
                        STUDIED.map(role =>
                            Math.abs((prior.density[role] ?? 0) - (entry.density[role] ?? 0)),
                        ),
                    ),
                ),
            )}`,
    )
    console.log(`        ${played.map(count => String(count).padStart(7)).join('')}`)
    for (const vampires of revealed) {
        const cells: string[] = []
        for (const count of played) {
            const errors: number[] = []
            for (const entry of facts) {
                for (let draw = 0; draw < 3; draw++) {
                    const minions = shuffled(entry.minions, random).slice(0, vampires)
                    const pool = entry.cards.flatMap(item =>
                        Array.from({ length: item.count }, () => item.card),
                    )
                    const seenRoles: Partial<Record<Role, number>> = {}
                    for (const card of shuffled(pool, random).slice(0, count)) {
                        for (const role of rolesOf(card)) {
                            seenRoles[role] = (seenRoles[role] ?? 0) + 1
                        }
                    }
                    const estimate = roleDensities(minions, seenRoles, prior)
                    for (const role of STUDIED) {
                        errors.push(Math.abs((estimate[role] ?? 0) - (entry.density[role] ?? 0)))
                    }
                }
            }
            cells.push(fixed(mean(errors)).padStart(7))
        }
        console.log(`${String(vampires).padStart(7)} ${cells.join('')}`)
    }
}

// Least squares with a small ridge: solves ( X'X + lambda I ) w = X'y by Gaussian elimination
function ridge(rows: number[][], targets: number[], lambda: number): number[] {
    const size = rows[0].length
    const matrix = Array.from({ length: size }, (_, i) =>
        Array.from({ length: size + 1 }, (_, j) => (i == j && i > 0 ? lambda : 0)),
    )
    rows.forEach((row, index) => {
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                matrix[i][j] += row[i] * row[j]
            }
            matrix[i][size] += row[i] * targets[index]
        }
    })
    for (let i = 0; i < size; i++) {
        let pivot = i
        for (let r = i + 1; r < size; r++) {
            if (Math.abs(matrix[r][i]) > Math.abs(matrix[pivot][i])) {
                pivot = r
            }
        }
        ;[matrix[i], matrix[pivot]] = [matrix[pivot], matrix[i]]
        for (let r = 0; r < size; r++) {
            if (r != i && matrix[i][i] != 0) {
                const factor = matrix[r][i] / matrix[i][i]
                for (let c = i; c <= size; c++) {
                    matrix[r][c] -= factor * matrix[i][c]
                }
            }
        }
    }
    return matrix.map((row, i) => (row[i] == 0 ? 0 : row[size] / row[i]))
}

function correlation(a: number[], b: number[]): number {
    const ma = mean(a)
    const mb = mean(b)
    let covariance = 0
    let va = 0
    let vb = 0
    for (let i = 0; i < a.length; i++) {
        covariance += (a[i] - ma) * (b[i] - mb)
        va += (a[i] - ma) ** 2
        vb += (b[i] - mb) ** 2
    }
    return va == 0 || vb == 0 ? 0 : covariance / Math.sqrt(va * vb)
}

const FITTED = [
    'Auspex',
    'Animalism',
    'Celerity',
    'Dominate',
    'Fortitude',
    'Obfuscate',
    'Potence',
    'Presence',
    'Protean',
    'Quietus',
    'Vicissitude',
]

// One feature per discipline and level: the share of the revealed vampires that have it at that level
function featuresOf(minions: Partial<Disciplines>[]): number[] {
    const result = [1]
    for (const name of FITTED) {
        for (const level of [1, 2]) {
            const having = minions.filter(
                disciplines => (disciplines as Record<string, number>)[name] >= level,
            ).length
            result.push(minions.length == 0 ? 0 : having / minions.length)
        }
    }
    return result
}

function fitReport() {
    const random = randomOf(11)
    const train = facts.filter((_, index) => index % 2 == 0)
    const test = facts.filter((_, index) => index % 2 == 1)
    const prior = DEFAULT_PROFILE.opponentPrior
    const weights = new Map<Role, number[]>()
    for (const role of STUDIED) {
        weights.set(
            role,
            ridge(
                train.map(entry => featuresOf(entry.minions)),
                train.map(entry => entry.density[role] ?? 0),
                3,
            ),
        )
    }
    console.log(
        'Fitted lift per discipline ( ridge regression of the library share of the role on the share of the\n' +
            'vampires that have each discipline at each level, trained on half of the decks ):',
    )
    console.log(
        `  ${'role'.padEnd(18)} base   ${FITTED.map(name => name.slice(0, 4).padStart(15)).join('')}`,
    )
    for (const role of STUDIED) {
        const w = weights.get(role) ?? []
        const cells = FITTED.map((_, index) =>
            `${fixed(w[1 + 2 * index])}/${fixed(w[2 + 2 * index])}`.padStart(15),
        )
        console.log(`  ${role.padEnd(18)} ${fixed(w[0])}${cells.join('')}`)
    }
    console.log(
        '  ( each cell: level-1 weight / level-2 weight, added for a crypt made only of such vampires )',
    )
    console.log(
        '\nTest decks, 4 vampires revealed: mean absolute error and correlation with the real density, per role.\n' +
            'prior = the neutral prior alone, table = the current capability table, fit = the fitted model',
    )
    console.log(`  ${'role'.padEnd(18)}    prior                table                fit`)
    const reveals = test.map(entry => shuffled(entry.minions, random).slice(0, 4))
    for (const role of STUDIED) {
        const real = test.map(entry => entry.density[role] ?? 0)
        const table = reveals.map(minions => roleDensities(minions, {}, prior)[role] ?? 0)
        const flat = real.map(() => prior.density[role] ?? 0)
        const w = weights.get(role) ?? []
        const fitted = reveals.map(minions =>
            Math.max(
                0,
                featuresOf(minions).reduce((sum, value, index) => sum + value * w[index], 0),
            ),
        )
        const cell = (estimate: number[]) =>
            `${fixed(mean(estimate.map((value, index) => Math.abs(value - real[index]))))}  r ${fixed(correlation(estimate, real))}`
        console.log(
            `  ${role.padEnd(18)} ${cell(flat).padEnd(19)}  ${cell(table).padEnd(19)}  ${cell(fitted)}`,
        )
    }
}

function classesReport() {
    const names = Object.values(library)
        .filter(card => rolesOf(card).size > 0)
        .toSorted((a, b) => a.name.localeCompare(b.name))
    for (const role of STUDIED) {
        const matching = names.filter(card => rolesOf(card).has(role))
        console.log(`\n${role}: ${matching.length} cards`)
        for (const card of matching.filter(
            (_, index) => index % Math.ceil(matching.length / 12) == 0,
        )) {
            console.log(
                `  ${card.name} ( ${card.type} ): ${card.text.slice(0, 110).replace(/\n/g, ' ')}`,
            )
        }
    }
}

const argument = process.argv[2] ?? ''
if (argument == '--classes') {
    classesReport()
} else if (argument == '--fit') {
    fitReport()
} else {
    if (argument != '--converge') {
        tableReport()
    }
    if (argument != '--table') {
        console.log('')
        convergeReport()
    }
}
