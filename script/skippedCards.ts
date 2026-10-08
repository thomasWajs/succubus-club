// The cards analysed and rejected for the bot catalog ( class 4 of the /add-card triage ), kept in
// .claude/cards/skipped.json so they are not read and judged again. `npm run card` flags them.
//
// CLI:  npm run card:skip -- <category> "<name or id>" "<reason>"    record a card
//       npm run card:skip -- --remove "<name or id>"                 forget it ( the card was done after all )
//       npm run card:skip -- --list [category]                       list the recorded cards
//       npm run card:skip -- --categories                            list the categories

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findCards } from './cardLookup.ts'

export const SKIPPED_PATH = resolve(
    fileURLToPath(import.meta.url),
    process.env.CARDS_SKIPPED_PATH ?? 'skipped.json',
)

export interface SkippedCard {
    id: string
    name: string
    category: string
    reason: string
}

interface SkippedFile {
    categories: Record<string, string>
    cards: SkippedCard[]
}

const DEFAULT_CATEGORIES: Record<string, string> = {
    politics: 'Needs referendums, votes, titles or other political machinery',
    ally: 'Needs allies (mortal or not) as minions',
    imbued: 'Needs imbued minions or their rules',
    'engine-feature': 'Blocked by another missing engine feature (named in the reason)',
    'too-complicated':
        'Expressible in principle but needs a lot of machinery for one card, or rewrites how an action or combat resolves',
}

function loadFile(): SkippedFile {
    if (!existsSync(SKIPPED_PATH)) {
        return { categories: { ...DEFAULT_CATEGORIES }, cards: [] }
    }
    return JSON.parse(readFileSync(SKIPPED_PATH, 'utf-8')) as SkippedFile
}

function saveFile(file: SkippedFile): void {
    file.cards.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    mkdirSync(dirname(SKIPPED_PATH), { recursive: true })
    writeFileSync(SKIPPED_PATH, `${JSON.stringify(file, null, 2)}\n`)
}

export function getSkippedCards(): Map<string, SkippedCard> {
    return new Map(loadFile().cards.map(card => [card.id, card]))
}

export function getSkipCategories(): Record<string, string> {
    return loadFile().categories
}

function resolveCard(query: string): { id: string; name: string } {
    const cards = findCards(query)
    const distinct = new Map(cards.map(card => [String(card.id), card.name]))
    if (distinct.size == 0) {
        throw new Error(`Card not found: ${query}`)
    }
    if (distinct.size > 1) {
        const list = [...distinct].map(([id, name]) => `${id} ${name}`).join(', ')
        throw new Error(`"${query}" matches several cards, give the id: ${list}`)
    }
    const [[id, name]] = [...distinct]
    return { id, name }
}

// Several cards with the same name in the cardbase ( crypt groups ) are each recorded by id
export function skipCard(category: string, query: string, reason: string): SkippedCard {
    const file = loadFile()
    if (!(category in file.categories)) {
        throw new Error(
            `Unknown category "${category}", use one of: ${Object.keys(file.categories).join(', ')}`,
        )
    }
    if (reason.trim().length == 0) {
        throw new Error('A reason is required')
    }
    const { id, name } = resolveCard(query)
    const entry = { id, name, category, reason: reason.trim() }
    file.cards = [...file.cards.filter(card => card.id != id), entry]
    saveFile(file)
    return entry
}

export function unskipCard(query: string): SkippedCard | undefined {
    const file = loadFile()
    const { id } = resolveCard(query)
    const removed = file.cards.find(card => card.id == id)
    file.cards = file.cards.filter(card => card.id != id)
    saveFile(file)
    return removed
}

function main(args: string[]): void {
    try {
        if (args[0] == '--categories') {
            for (const [name, description] of Object.entries(getSkipCategories())) {
                console.log(`${name}: ${description}`)
            }
        } else if (args[0] == '--list') {
            const cards = [...getSkippedCards().values()].filter(
                card => !args[1] || card.category == args[1],
            )
            for (const card of cards) {
                console.log(`[${card.id}] ${card.name} | ${card.category} | ${card.reason}`)
            }
            console.log(`${cards.length} cards`)
        } else if (args[0] == '--remove') {
            const removed = args[1] ? unskipCard(args[1]) : undefined
            console.log(removed ? `Removed ${removed.name}` : 'Not in the skipped list')
        } else if (args.length == 3) {
            const entry = skipCard(args[0], args[1], args[2])
            console.log(`Recorded [${entry.id}] ${entry.name}: ${entry.category}`)
        } else {
            console.error(
                'Usage: npm run card:skip -- <category> "<name or id>" "<reason>" | --remove <card> | --list [category] | --categories',
            )
            process.exit(2)
        }
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error))
        process.exit(1)
    }
}

if (process.argv[1] && resolve(process.argv[1]) == fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2))
}
