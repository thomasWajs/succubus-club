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

async function updateDeck(dbDeck: DbDeck, deck: Deck) {
    await db.decks.update(dbDeck.id, { cards: deck.cards })
    const updatedDeck = await DbDeck.get(dbDeck.id)
    if (!updatedDeck) {
        throw new Error('Error while refreshing the deck')
    }
    return updatedDeck
}

// An deck already existing in the db is always re-imported, to avoid stale states.
export async function importDeck(
    source: DeckSource,
    sourceId: string,
    importer: () => Promise<Deck>,
) {
    const deck = await importer()
    const dbDeck = await db.decks
        .filter(deck => deck.source === source && deck.sourceValue === sourceId)
        .first()
    return dbDeck ?
            await updateDeck(dbDeck, deck)
        :   await DbDeck.create(deck.name, deck.cards, source, sourceId)
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
    const dbDeck = await importDeck(deckSource, url, () => fetchFromDeckBuilder(krcgEndpoint, url))
    await selectDeck(dbDeck)
}

export async function getOrImportText(deckText: string) {
    const dbDeck = await importDeck(DeckSource.Text, deckText, () => importTextDeck(deckText))
    await selectDeck(dbDeck)
}

export async function getOrImportPrecon(fullPreconId: string, name: string, cards: DeckList) {
    const dbDeck = await importDeck(DeckSource.Precon, fullPreconId, () =>
        Promise.resolve({ name, cards }),
    )
    await selectDeck(dbDeck)
}

export async function refreshUrlDeck(deck: DbDeck) {
    if (!isUrlDeck(deck.source)) {
        throw new Error(`"${deck.source}" is not an url source`)
    }

    const krcgEndpoint = URL_DECK_ENDPOINTS[deck.source]
    const freshDeck = await fetchFromDeckBuilder(krcgEndpoint, deck.sourceValue)
    const updatedDeck = await updateDeck(deck, freshDeck)
    await selectDeck(updatedDeck)
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
