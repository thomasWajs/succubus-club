// Source: https://github.com/smeea/vdb/blob/master/frontend/src/utils/importDeck.js
// Thanks to smeea for the authorized use of this code.

import unidecode from 'unidecode'
import { DeckList } from '@/shared/types/gateway.ts'
import { gameResources } from '@/shared/registries.ts'
import { isCryptId } from '@/shared/model/Card.ts'
import { CryptCardResource } from '@/shared/types/resources.ts'

const ADV = 'adv'
const AUTHOR = 'author'
const BAD_CARDS = 'badCards'
const BASE = 'base'
const CRYPT = 'crypt'
const DESCRIPTION = 'description'
const GROUP = 'group'
const ID = 'id'
const LIBRARY = 'library'
const NAME = 'name'

type ImportCardBase = {
    [name: string]: {
        base: number
        adv?: number
        groups: Record<string, number>
    }
}

async function vdbImportDeck(deckText: string) {
    const importCardbase: ImportCardBase = {}

    for (const card of Object.values(gameResources.cardbase)) {
        const name = unidecode(card.name).toLowerCase().replace(/\W/g, '')

        if (isCryptId(card.id)) {
            const cryptCard = card as CryptCardResource
            const adv = !!cryptCard?.[ADV][0]

            if (!Object.keys(importCardbase).includes(name)) {
                importCardbase[name] = { base: card[ID], groups: { [cryptCard[GROUP]]: card[ID] } }
            } else if (adv) {
                importCardbase[name][ADV] = card[ID]
            } else {
                importCardbase[name].groups[cryptCard[GROUP]] = card[ID]
            }
        } else {
            importCardbase[name] = { base: card[ID], groups: {} }
        }
    }

    const minifyCardName = (name: string) => {
        let minified = unidecode(name).toLowerCase()
        if (minified.startsWith('the ')) {
            minified = `${minified.replace(/^the /, '')}, the`
        }
        return minified.replace(/--.*$/, '').replace(/\W/g, '')
    }

    const parseCard = (line: string) => {
        let id = 0
        let quantity = 0

        if (line.includes('ADV')) {
            const regexp = /^([0-9]+) ?x?\s*(.*?)\s\(?ADV\)?.*/
            const match = line.match(regexp)

            if (match) {
                quantity = Number.parseInt(match[1])
                let cardname = match[2]
                cardname = minifyCardName(cardname)

                if (Object.keys(importCardbase).includes(cardname)) {
                    id = importCardbase[cardname][ADV] ?? 0
                }
            }
        } else if (line.includes(' (G')) {
            const regexp = /^\s*([0-9]+) ?x?\s*(.*)\s\(G(.*)\)/
            const match = line.match(regexp)

            if (match) {
                quantity = Number.parseInt(match[1])
                const cardname = minifyCardName(match[2])
                const group = match[3]
                if (Object.keys(importCardbase).includes(cardname)) {
                    if (Object.keys(importCardbase[cardname].groups).includes(group)) {
                        id = importCardbase[cardname].groups[group]
                    }
                }
            }
        } else {
            let regexp = /^\s*([0-9]+) ?x?\s+(.*?)(\s+\d+.*):(.*)/
            let match = line.match(regexp)
            if (match) {
                quantity = Number.parseInt(match[1])
                const cardname = minifyCardName(match[2])
                const group = match[4].toLowerCase()
                if (Object.keys(importCardbase).includes(cardname)) {
                    if (Object.keys(importCardbase[cardname].groups).includes(group)) {
                        id = importCardbase[cardname].groups[group]
                    }
                }
            } else {
                regexp = /^\s*([0-9]+) ?x?\s*(.*)/
                match = line.match(regexp)
                if (match) {
                    quantity = Number.parseInt(match[1])
                    const cardname = minifyCardName(match[2])
                    if (Object.keys(importCardbase).includes(cardname)) {
                        id = importCardbase[cardname][BASE]
                    }
                }
            }
        }

        return [id, quantity]
    }

    const deck = {
        [NAME]: 'New deck',
        [AUTHOR]: '',
        [DESCRIPTION]: '',
        [CRYPT]: {} as Record<number, { c: unknown; q: number }>,
        [LIBRARY]: {} as Record<number, { c: unknown; q: number }>,
        [BAD_CARDS]: [] as string[],
    }

    const deckArray = deckText.split(/\n/)
    deckArray.forEach(rawLine => {
        const line = rawLine.trim()
        if (line.startsWith('Deck Name: ')) {
            deck[NAME] = line.replace('Deck Name: ', '')
            return
        }
        if (line.startsWith('Author: ')) {
            deck[AUTHOR] = line.replace('Author: ', '')
            return
        }
        if (line.startsWith('Description: ')) {
            deck[DESCRIPTION] = line.replace('Description: ', '')
            return
        }
        if (!line || line.match(/^\D/)) {
            return
        }

        const [id, quantity] = parseCard(line)

        if (id && quantity) {
            if (isCryptId(id)) {
                deck[CRYPT][id] = {
                    c: gameResources.cardbase[id],
                    q: quantity,
                }
            } else {
                deck[LIBRARY][id] = {
                    c: gameResources.cardbase[id],
                    q: quantity,
                }
            }
        } else {
            deck[BAD_CARDS].push(line)
        }
    })

    return deck
}

export async function importTextDeck(deckText: string) {
    const vdbDeck = await vdbImportDeck(deckText)

    const deckList = {} as DeckList

    for (const [id, cryptCard] of Object.entries(vdbDeck.crypt)) {
        deckList[id.toString()] = cryptCard.q
    }
    for (const [id, libCard] of Object.entries(vdbDeck.library)) {
        deckList[id.toString()] = libCard.q
    }

    return {
        name: vdbDeck.name,
        cards: deckList,
    }
}
