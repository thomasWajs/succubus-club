import { Deck, DeckList } from '@/gateway/deck.ts'

type KrcgDeck = {
    name: string
    crypt: {
        cards: Array<{ id: number; count: number }>
    }
    library: {
        cards: Array<{ cards: Array<{ id: number; count: number }> }>
    }
}

const KRCG_API_ENDPOINTS = {
    convert: 'https://api.krcg.org/convert/json',
    vdb: 'https://api.krcg.org/vdb',
}

function convertKrcgToDeck(krcgDeck: KrcgDeck): Deck {
    const deckList = {} as DeckList

    for (const cryptCard of krcgDeck.crypt.cards) {
        deckList[cryptCard.id.toString()] = cryptCard.count
    }

    for (const cardGroup of krcgDeck.library.cards) {
        for (const libCard of cardGroup.cards) {
            deckList[libCard.id.toString()] = libCard.count
        }
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
    if (!krcgDeck.crypt) throw new Error('KRCG API returned an empty crypt')
    if (!krcgDeck.library) throw new Error('KRCG API returned an empty library')

    return krcgDeck as KrcgDeck
}

export async function fetchVdb(vdbDeckUrl: string): Promise<Deck> {
    const response = await fetch(KRCG_API_ENDPOINTS.vdb, {
        method: 'POST',
        body: JSON.stringify({ url: vdbDeckUrl }),
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
