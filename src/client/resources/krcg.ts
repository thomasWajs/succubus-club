import { Deck, DeckList } from '@/shared/types/gateway.ts'
import { KrcgDeck } from '@/shared/types/resources.ts'

export const KRCG_API_ENDPOINTS = {
    convert: 'https://v4.api.krcg.org/convert/json',
    vdb: 'https://v4.api.krcg.org/vdb',
    vtesdecks: 'https://v4.api.krcg.org/vtesdecks',
    amaranth: 'https://v4.api.krcg.org/amaranth',
}

function convertKrcgToDeck(krcgDeck: KrcgDeck): Deck {
    const deckList = {} as DeckList

    for (const card of krcgDeck.cards) {
        deckList[card.id.toString()] = card.count
    }

    return {
        name: krcgDeck.name,
        cards: deckList,
    }
}

async function checkKrcgResponse(response: Response): Promise<KrcgDeck> {
    let krcgDeck
    try {
        krcgDeck = await response.json()
    } catch (_) {
        throw new Error('KRCG API returned an invalid response.')
    }

    if (!krcgDeck) throw new Error('KRCG API returned an empty response.')
    if (!krcgDeck.cards) throw new Error('KRCG API returned an empty deck')

    return krcgDeck as KrcgDeck
}

export async function fetchFromDeckBuilder(endpoint: string, url: string): Promise<Deck> {
    const response = await fetch(endpoint, {
        method: 'POST',
        body: JSON.stringify({ url }),
        headers: {
            'Content-Type': 'application/json',
        },
    })

    const krcgDeck = await checkKrcgResponse(response)
    return convertKrcgToDeck(krcgDeck)
}

export async function convertFromText(deckText: string): Promise<Deck> {
    const response = await fetch(KRCG_API_ENDPOINTS.convert, {
        method: 'POST',
        body: deckText,
        headers: {
            'Content-Type': 'text/plain',
        },
    })

    const krcgDeck = await checkKrcgResponse(response)
    return convertKrcgToDeck(krcgDeck)
}
