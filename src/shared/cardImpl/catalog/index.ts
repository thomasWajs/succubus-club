import { Card, LibraryCard } from '@/shared/model/Card.ts'
import { KrcgId } from '@/shared/types/gateway.ts'
import { ACTION_CARDS } from '@/shared/cardImpl/catalog/cards/actions.ts'
import { COMBAT_CARDS } from '@/shared/cardImpl/catalog/cards/combat.ts'
import { CRYPT_CARDS } from '@/shared/cardImpl/catalog/cards/crypt.ts'
import { MASTER_CARDS } from '@/shared/cardImpl/catalog/cards/masters.ts'
import { MODIFIER_CARDS } from '@/shared/cardImpl/catalog/cards/modifiers.ts'
import { MULTI_KIND_CARDS } from '@/shared/cardImpl/catalog/cards/multi.ts'
import { REACTION_CARDS } from '@/shared/cardImpl/catalog/cards/reactions.ts'
import { CardDef, CardKind } from '@/shared/cardImpl/catalog/types.ts'

/**
 * The catalog of the cards described as data. One entry per card, whatever the kinds of its
 * plays: the registries of cardImpl/index.ts are built from it, one per kind.
 */

export const CARD_DEFS: CardDef[] = [
    ...ACTION_CARDS,
    ...MODIFIER_CARDS,
    ...COMBAT_CARDS,
    ...REACTION_CARDS,
    ...MASTER_CARDS,
    ...MULTI_KIND_CARDS,
    ...CRYPT_CARDS,
]

const CATALOG: Record<KrcgId, CardDef> = {}
for (const def of CARD_DEFS) {
    if (CATALOG[def.id]) {
        throw new Error(`Card ${def.id} ( ${def.name} ) is defined twice in the catalog`)
    }
    CATALOG[def.id] = def
}

export function getCardDef(card: Card): CardDef | undefined {
    return card.krcgId ? CATALOG[card.krcgId] : undefined
}

// The kinds the card has a play for, in the catalog
export function getPlayKinds(def: CardDef): CardKind[] {
    return [...new Set(def.plays.map(play => play.kind))]
}

export function hasPlayOfKind(card: LibraryCard, kind: CardKind): boolean {
    const def = getCardDef(card)
    return !!def && def.plays.some(play => play.kind == kind)
}
