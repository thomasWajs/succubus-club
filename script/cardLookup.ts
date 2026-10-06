// Look up cards in public/assets/cardbase.json by krcgId or by name.
//
// CLI:    npm run card -- "far mastery" 100620 "deflection" [--json] [--partial]
// Import: import { findCards } from './cardLookup.ts'
//
// A name matches when, once lowercased and stripped of accents and punctuation, it equals the query
// ( or, with --partial / partial: true, contains it ). The same name can match several cards
// ( crypt cards exist in several groups, advanced vampires ), so lookups return arrays.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface CardbaseEntry {
    id: number
    name: string
    // Library cards
    type?: string
    clan?: string
    discipline?: string
    blood?: number | string
    pool?: number | string
    requirement?: string
    // Crypt cards
    capacity?: number
    group?: string
    sect?: string
    title?: string
    adv?: string
    disciplines?: Record<string, number>
    text: string
    rulings: { text: string; refs: Record<string, string> }[]
}

const CARDBASE_PATH = resolve(fileURLToPath(import.meta.url), '../../public/assets/cardbase.json')

let cardbase: Record<string, CardbaseEntry> | undefined
const normalizedNames = new Map<string, CardbaseEntry[]>()

export function normalizeName(name: string): string {
    return name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
}

export function loadCardbase(): Record<string, CardbaseEntry> {
    if (!cardbase) {
        cardbase = JSON.parse(readFileSync(CARDBASE_PATH, 'utf-8')) as Record<string, CardbaseEntry>
        for (const card of Object.values(cardbase)) {
            const key = normalizeName(card.name)
            const same = normalizedNames.get(key)
            if (same) {
                same.push(card)
            } else {
                normalizedNames.set(key, [card])
            }
        }
    }
    return cardbase
}

export function getCardById(id: number | string): CardbaseEntry | undefined {
    return loadCardbase()[String(id)]
}

export function findCards(
    query: number | string,
    options: { partial?: boolean } = {},
): CardbaseEntry[] {
    const base = loadCardbase()
    const text = String(query).trim()
    if (/^\d+$/.test(text)) {
        const byId = base[text]
        return byId ? [byId] : []
    }

    const key = normalizeName(text)
    const exact = normalizedNames.get(key)
    if (exact || !options.partial) {
        return exact ?? []
    }
    return [...normalizedNames.entries()]
        .filter(([name]) => name.includes(key))
        .flatMap(([, cards]) => cards)
}

export function formatCard(card: CardbaseEntry): string {
    const isCrypt = card.capacity !== undefined
    const header =
        isCrypt ?
            [
                `${card.name}${card.adv ? ' (ADV)' : ''}`,
                `crypt G${card.group}`,
                `capacity ${card.capacity}`,
                card.clan,
                [card.sect, card.title].filter(Boolean).join(' '),
            ]
        :   [
                card.name,
                card.type,
                card.clan ? `clan ${card.clan}` : '',
                card.discipline ? `disc ${card.discipline}` : '',
                card.blood ? `blood ${card.blood}` : '',
                card.pool ? `pool ${card.pool}` : '',
                card.requirement ? `req ${card.requirement}` : '',
            ]
    const lines = [`[${card.id}] ${header.filter(Boolean).join(' | ')}`]
    if (card.disciplines) {
        lines.push(
            `  ${Object.entries(card.disciplines)
                .map(([name, level]) => `${name}:${level}`)
                .join(' ')}`,
        )
    }
    lines.push(...card.text.split('\n').map(line => `  ${line}`))
    for (const ruling of card.rulings) {
        lines.push(`  ruling: ${ruling.text}`)
    }
    return lines.join('\n')
}

function main(args: string[]) {
    const asJson = args.includes('--json')
    const partial = args.includes('--partial')
    const queries = args.filter(arg => !arg.startsWith('--'))
    if (queries.length == 0) {
        console.error('Usage: npm run card -- <name or id>... [--partial] [--json]')
        process.exit(2)
    }

    let missing = 0
    const results = queries.map(query => {
        const cards = findCards(query, { partial })
        if (cards.length == 0) {
            missing++
        }
        return { query, cards }
    })

    if (asJson) {
        console.log(JSON.stringify(results, null, 2))
    } else {
        for (const { query, cards } of results) {
            if (cards.length == 0) {
                console.log(`${query}: not found${partial ? '' : ' (try --partial)'}`)
            } else {
                console.log(cards.map(formatCard).join('\n\n'))
            }
            console.log()
        }
    }
    process.exit(missing > 0 ? 1 : 0)
}

if (process.argv[1] && resolve(process.argv[1]) == fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2))
}
