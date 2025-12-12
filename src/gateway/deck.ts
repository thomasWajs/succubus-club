import { db, DbDeck, DeckSource } from '@/gateway/db.ts'
import { isCryptId, KrcgId } from '@/resources/cards.ts'
import { useCoreStore } from '@/store/core.ts'
import { convertFromText, fetchAmaranth, fetchVdb } from '@/resources/krcg.ts'
import { MAX_LIB_SIZE, MIN_CRYPT_SIZE, MIN_LIB_SIZE } from '@/model/const.ts'

// A deck list in a simple format {KrcgId: nbOccurence}
export type DeckList = Record<KrcgId, number>

export type Deck = {
    name: string
    cards: DeckList
}

export async function getOrImportDeck(
    source: DeckSource,
    sourceId: string,
    importer: () => Promise<Deck>,
    forceReimport = false,
) {
    let dbDeck = await db.decks
        .filter(deck => deck.source === source && deck.sourceValue === sourceId)
        .first()

    if (forceReimport && dbDeck) {
        dbDeck.delete()
        dbDeck = undefined
    }

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
    const dbDeck = await getOrImportDeck(
        DeckSource.Vdb,
        vdbDeckUrl,
        () => fetchVdb(vdbDeckUrl),
        true,
    )
    await selectDeck(dbDeck)
}

export async function getOrImportAmaranth(amaranthDeckUrl: string) {
    const dbDeck = await getOrImportDeck(
        DeckSource.Amaranth,
        amaranthDeckUrl,
        () => fetchAmaranth(amaranthDeckUrl),
        true,
    )
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

export function countCards(deckList: DeckList) {
    const counter = {
        lib: 0,
        crypt: 0,
    }
    for (const [krcgId, quantity] of Object.entries(deckList)) {
        if (isCryptId(krcgId)) {
            counter.crypt += quantity
        } else {
            counter.lib += quantity
        }
    }
    return counter
}

export function validateDeckList(deckList: DeckList) {
    const counter = countCards(deckList)
    const warnings = []
    if (counter.crypt < MIN_CRYPT_SIZE) {
        warnings.push(`Crypt size must be at least ${MIN_CRYPT_SIZE} (got ${counter.crypt})`)
    }
    if (counter.lib < MIN_LIB_SIZE) {
        warnings.push(`Library size must be at least ${MIN_LIB_SIZE} (got ${counter.lib})`)
    }
    if (counter.lib > MAX_LIB_SIZE) {
        warnings.push(`Library size must be at most ${MAX_LIB_SIZE} (got ${counter.lib})`)
    }
    return warnings
}
