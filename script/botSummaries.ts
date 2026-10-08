// What the utility bot reads of the cards: the play summaries ( src/shared/bot/utility/summaries.ts ),
// derived from the catalog and never from a card id. Run from the repo root:
//   npm run bot:summaries                  the role coverage report of each bot deck
//   npm run bot:summaries -- --deck brujah only that deck ( govern, malkav, brujah, nosferatu )
//   npm run bot:summaries -- --cards       the summary of every catalogued card, to review
//   npm run bot:summaries -- --cards lost  only the cards whose name contains the text
//   npm run bot:summaries -- --check       the checks of bot:check ( exits with code 1 on a failure )

import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setGameResources } from '@/shared/registries.ts'
import { CARD_DEFS } from '@/shared/cardImpl/catalog/index.ts'
import { BrujahDeck, GovernDeck, MalkavDeck, NosferatuDeck } from '@/shared/bot/decks.ts'
import {
    CardSummary,
    describeEffect,
    describePlay,
    Effect,
    EffectType,
    getCryptDisciplines,
    Role,
    ROLES,
    summarizeCardId,
    waysUsableBy,
} from '@/shared/bot/utility/summaries.ts'
import { DeckList } from '@/shared/types/gateway.ts'

const ROOT = resolve(fileURLToPath(import.meta.url), '../..')
setGameResources(
    'cardbase',
    JSON.parse(readFileSync(resolve(ROOT, 'public/assets/cardbase.json'), 'utf-8')),
)

const DECKS: Record<string, DeckList> = {
    govern: GovernDeck,
    malkav: MalkavDeck,
    brujah: BrujahDeck,
    nosferatu: NosferatuDeck,
}

// What the agent must never contain: a card id, or a way to get them
const AGENT_SOURCES = [
    'src/shared/bot/agents/utilityAgent.ts',
    ...readdirSync(resolve(ROOT, 'src/shared/bot/utility'))
        .filter(file => file.endsWith('.ts'))
        .map(file => `src/shared/bot/utility/${file}`),
]
const CARD_ID_LITERAL = /['"`]\d{5,6}['"`]/
const CARD_IDS_IMPORT = /cardImpl\/cardIds\.ts/

// The effects the summaries keep as facts without making a role of them
const FACTS_WITHOUT_ROLE: EffectType[] = [
    'lockTarget',
    'restrictPlay',
    'burnsInTorpor',
    'burnSelf',
    'mustBleedWhileMinionLocked',
]

// What the engine cannot offer to a bot yet, as far as the catalog and the referee go. These are not
// derived: they are the gaps the author is told about ( bot-ai-phase3.md, section 4b )
const ENGINE_GAPS = [
    'A standing ability usable in a reaction window ( +1 intercept for a block attempt that stands, as KRCG News Radio ): no ability kind in the catalog, no option in the referee ( E1, due before step 3.5 )',
    'Combat ends ( "the combat ends" ): no combat effect in the catalog, so no dodge-or-end card of that kind is valued',
    'Damage prevention as a combat card ( Fortitude ): only attached preventDamage exists',
    'Aggravated damage from a hand strike, press other than grapple, burning or stealing equipment: no effect in the catalog',
    "Abilities of the opponents' cards in play that a human uses by hand leave no declaration: the bot only sees their lock state",
]

function allEffects(summary: CardSummary): Effect[] {
    const effects: Effect[] = [...summary.cryptEffects]
    for (const play of summary.plays) {
        effects.push(...play.effects, ...play.attached)
        for (const ability of play.abilities) {
            effects.push(...ability.effects)
        }
    }
    return effects
}

function runChecks(): number {
    const failures: string[] = []
    let plays = 0
    for (const def of CARD_DEFS) {
        const summary = summarizeCardId(def.id)
        const fail = (reason: string) => failures.push(`${def.name} ( ${def.id} ): ${reason}`)
        if (!summary) {
            fail('no summary: not in the cardbase')
            continue
        }
        if (!summary.catalogued) {
            fail('not catalogued')
        }
        if (summary.isCrypt && def.plays.length > 0) {
            fail('a crypt card with plays')
        }
        for (const [index, play] of summary.plays.entries()) {
            plays++
            if (play.roles.length == 0) {
                fail(
                    `play ${index} ( ${play.kind} ) has no role: add the role, or explain why it is not valued`,
                )
            }
            if (play.ways.length == 0) {
                fail(`play ${index} ( ${play.kind} ) has no way to be declared`)
            }
        }
    }

    for (const file of AGENT_SOURCES) {
        const text = readFileSync(resolve(ROOT, file), 'utf-8')
        if (CARD_ID_LITERAL.test(text)) {
            failures.push(`${file}: a card id literal. The agent reads the summaries, never a card`)
        }
        if (CARD_IDS_IMPORT.test(text)) {
            failures.push(`${file}: imports the card ids`)
        }
    }

    for (const failure of failures) {
        console.log(`FAIL ${failure}`)
    }
    console.log(
        `${CARD_DEFS.length} cards checked ( ${plays} plays summarised, ${AGENT_SOURCES.length} agent files without a card id ), ${failures.length} failures`,
    )
    return failures.length
}

function printCards(filter: string): void {
    const wanted = filter.toLowerCase()
    const summaries = CARD_DEFS.flatMap(def => summarizeCardId(def.id) ?? [])
        .filter(summary => summary.name.toLowerCase().includes(wanted))
        .sort((a, b) => a.name.localeCompare(b.name))
    for (const summary of summaries) {
        const cost =
            summary.isCrypt ? 'crypt' : (
                `${summary.type}, pool ${summary.pool}, blood ${summary.blood}`
            )
        console.log(`\n${summary.name} ( ${summary.id} ) ${cost}`)
        for (const play of summary.plays) {
            console.log(`    ${describePlay(play)}`)
        }
        if (summary.isCrypt) {
            console.log(
                `    ${summary.cryptEffects.map(describeEffect).join('; ') || 'vanilla: nothing to add to the cardbase'} => ${summary.roles.join(', ') || 'no role'}`,
            )
        }
    }
    console.log(`\n${summaries.length} cards`)
}

type RoleCount = { copies: number; playable: number; cards: Set<string> }

function printCoverage(name: string, deck: DeckList): void {
    const cards = Object.entries(deck).flatMap(([id, copies]) => {
        const summary = summarizeCardId(id)
        return summary ? [{ summary, copies }] : []
    })
    const crypt = cards.filter(({ summary }) => summary.isCrypt)
    const library = cards.filter(({ summary }) => !summary.isCrypt)
    const vampires = crypt.flatMap(({ summary, copies }) => {
        const disciplines = getCryptDisciplines(summary.id)
        return disciplines ? [{ disciplines, copies }] : []
    })
    const copiesOf = (list: typeof cards) => list.reduce((sum, { copies }) => sum + copies, 0)

    console.log(
        `\n== ${name}: ${copiesOf(library)} library cards ( ${library.length} distinct ), ${copiesOf(crypt)} crypt cards ( ${crypt.length} distinct ) ==`,
    )
    const unknown = library.filter(({ summary }) => !summary.catalogued)
    if (unknown.length > 0) {
        console.log(
            `  not catalogued ( the bot knows nothing of them ): ${unknown.map(({ summary, copies }) => `${copies} ${summary.name}`).join(', ')}`,
        )
    }
    const plainCrypt = crypt.filter(({ summary }) => !summary.catalogued)
    if (plainCrypt.length > 0) {
        console.log(
            `  crypt not catalogued ( played on their base stats ): ${plainCrypt.map(({ summary }) => summary.name).join(', ')}`,
        )
    }

    // A role is playable when a vampire of the crypt can declare one of the plays that give it
    const counts = new Map<Role, RoleCount>()
    const ableVampires = new Map<Role, Set<number>>()
    for (const { summary, copies } of library) {
        const playable = new Set<Role>()
        for (const play of summary.plays) {
            vampires.forEach(({ disciplines }, index) => {
                if (waysUsableBy(play.ways, disciplines).length > 0) {
                    for (const role of play.roles) {
                        playable.add(role)
                        ableVampires.set(role, (ableVampires.get(role) ?? new Set()).add(index))
                    }
                }
            })
        }
        for (const role of summary.roles) {
            const count = counts.get(role) ?? { copies: 0, playable: 0, cards: new Set() }
            count.copies += copies
            count.playable += playable.has(role) ? copies : 0
            count.cards.add(summary.name)
            counts.set(role, count)
        }
    }
    const totalVampires = copiesOf(crypt)
    console.log(
        `  ${'role'.padEnd(18)}${'copies'.padStart(7)}${'playable'.padStart(10)}${'vampires'.padStart(10)}  cards`,
    )
    for (const role of ROLES) {
        const count = counts.get(role)
        if (!count) {
            continue
        }
        const able = [...(ableVampires.get(role) ?? [])].reduce(
            (sum, index) => sum + vampires[index].copies,
            0,
        )
        console.log(
            `  ${role.padEnd(18)}${String(count.copies).padStart(7)}${String(count.playable).padStart(10)}${`${able}/${totalVampires}`.padStart(10)}  ${[...count.cards].join(', ')}`,
        )
    }
    const missing = ROLES.filter(role => !counts.has(role))
    console.log(`  no card of the deck for: ${missing.join(', ')}`)
}

function printReport(only: string | null): void {
    for (const [name, deck] of Object.entries(DECKS)) {
        if (!only || only == name) {
            printCoverage(name, deck)
        }
    }

    const inCatalog = new Map<Role, number>()
    const withoutRole = new Map<EffectType, Set<string>>()
    for (const def of CARD_DEFS) {
        const summary = summarizeCardId(def.id)
        if (!summary) {
            continue
        }
        summary.roles.forEach(role => inCatalog.set(role, (inCatalog.get(role) ?? 0) + 1))
        for (const effect of allEffects(summary)) {
            if (FACTS_WITHOUT_ROLE.includes(effect.type)) {
                withoutRole.set(
                    effect.type,
                    (withoutRole.get(effect.type) ?? new Set()).add(summary.name),
                )
            }
        }
    }
    console.log(`\n== The catalog ( ${CARD_DEFS.length} cards ) ==`)
    console.log(
        `  cards by role: ${ROLES.map(role => `${role} ${inCatalog.get(role) ?? 0}`).join(', ')}`,
    )
    console.log(
        `  roles no catalogued card gives: ${ROLES.filter(role => !inCatalog.has(role)).join(', ') || 'none'}`,
    )
    console.log('  effects kept as facts, without a role ( not valued yet ):')
    for (const [type, names] of withoutRole) {
        console.log(`    ${type}: ${[...names].join(', ')}`)
    }
    console.log('\n== What the engine cannot offer to a bot yet ==')
    for (const gap of ENGINE_GAPS) {
        console.log(`  - ${gap}`)
    }
}

const args = process.argv.slice(2)
if (args.includes('--check')) {
    process.exit(runChecks() > 0 ? 1 : 0)
} else if (args.includes('--cards')) {
    printCards(args.filter(arg => !arg.startsWith('--')).join(' '))
} else {
    const deckIndex = args.indexOf('--deck')
    const only = deckIndex >= 0 ? args[deckIndex + 1] : null
    if (only && !DECKS[only]) {
        console.error(`Unknown deck '${only}' ( ${Object.keys(DECKS).join(', ')} )`)
        process.exit(1)
    }
    printReport(only)
}
