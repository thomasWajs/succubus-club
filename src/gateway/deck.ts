import { db, DbDeck, DeckSource } from '@/gateway/db.ts'
import { KrcgId } from '@/resources/cards.ts'
import { useCoreStore } from '@/store/core.ts'
import { convertFromText, fetchVdb } from '@/resources/krcg.ts'

// A deck list in a simple format {KrcgId: nbOccurence}
export type DeckList = Record<KrcgId, number>

export interface Deck {
    name: string
    cards: DeckList
}

export async function getOrImportDeck(
    source: DeckSource,
    sourceId: string,
    importer: () => Promise<Deck>,
) {
    let dbDeck = await db.decks
        .filter(deck => deck.source === source && deck.sourceValue === sourceId)
        .first()
    if (!dbDeck) {
        const deck = await importer()
        dbDeck = await DbDeck.create(deck.name, deck.cards, source, sourceId)
    }
    return dbDeck
}

export async function selectDeck(deck: DbDeck) {
    const core = useCoreStore()
    await db.decks.update(deck.id, { lastUsed: new Date() })
    core.userProfile.lastDeckId = deck.id
    await core.userProfile.save()
    core.selfDeck = deck
}

export async function getOrImportVdb(vdbDeckUrl: string) {
    const dbDeck = await getOrImportDeck(DeckSource.Vdb, vdbDeckUrl, () => fetchVdb(vdbDeckUrl))
    await selectDeck(dbDeck)
}

export async function getOrImportText(deckText: string) {
    const dbDeck = await getOrImportDeck(DeckSource.Text, deckText, () => convertFromText(deckText))
    await selectDeck(dbDeck)
}

export async function getOrImportPrecon(name: string, cards: DeckList) {
    const dbDeck = await getOrImportDeck(DeckSource.Precon, name, () =>
        Promise.resolve({ name, cards }),
    )
    await selectDeck(dbDeck)
}
