import { db, DbDeck, DeckSource } from '@/client/gateway/db.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { fetchFromDeckBuilder, KRCG_API_ENDPOINTS } from '@/client/resources/krcg.ts'
import { MAX_LIB_SIZE, MIN_CRYPT_SIZE, MIN_LIB_SIZE } from '@/shared/const/model.ts'
import { Deck, DeckList } from '@/shared/types/gateway.ts'
import { isCryptId } from '@/shared/model/Card.ts'
import { importTextDeck } from '@/client/gateway/importTextDeck.ts'

type UrlDeckSource =
    | typeof DeckSource.Vdb
    | typeof DeckSource.VtesDecks
    | typeof DeckSource.Amaranth

const URL_DECK_ENDPOINTS: Record<UrlDeckSource, string> = {
    [DeckSource.Vdb]: KRCG_API_ENDPOINTS.vdb,
    [DeckSource.VtesDecks]: KRCG_API_ENDPOINTS.vtesdecks,
    [DeckSource.Amaranth]: KRCG_API_ENDPOINTS.amaranth,
}

export function isUrlDeck(source: DeckSource): source is UrlDeckSource {
    return source in URL_DECK_ENDPOINTS
}

async function updateUrlDeck(deck: DbDeck) {
    if (!isUrlDeck(deck.source)) {
        throw new Error(`Deck source "${deck.source}" cannot be updated`)
    }
    const krcgEndpoint = URL_DECK_ENDPOINTS[deck.source]

    const freshDeck = await fetchFromDeckBuilder(krcgEndpoint, deck.sourceValue)
    await db.decks.update(deck.id, { cards: freshDeck.cards })
    const updatedDeck = await DbDeck.get(deck.id)
    if (!updatedDeck) {
        throw new Error('Error while refreshing the deck')
    }
    return updatedDeck
}

export async function getOrImportDeck(
    source: DeckSource,
    sourceId: string,
    importer: () => Promise<Deck>,
) {
    let dbDeck = await db.decks
        .filter(deck => deck.source === source && deck.sourceValue === sourceId)
        .first()

    if (dbDeck && isUrlDeck(source)) {
        return await updateUrlDeck(dbDeck)
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

export async function getOrImportFromDeckBuilder(deckSource: UrlDeckSource, url: string) {
    const krcgEndpoint = URL_DECK_ENDPOINTS[deckSource]
    const dbDeck = await getOrImportDeck(deckSource, url, () =>
        fetchFromDeckBuilder(krcgEndpoint, url),
    )
    await selectDeck(dbDeck)
}

export async function refreshDeck(deck: DbDeck) {
    const updatedDeck = await updateUrlDeck(deck)
    await selectDeck(updatedDeck)
}

export async function getOrImportText(deckText: string) {
    const dbDeck = await getOrImportDeck(DeckSource.Text, deckText, () => importTextDeck(deckText))
    await selectDeck(dbDeck)
}

export async function getOrImportPrecon(fullPreconId: string, name: string, cards: DeckList) {
    const dbDeck = await getOrImportDeck(DeckSource.Precon, fullPreconId, () =>
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
