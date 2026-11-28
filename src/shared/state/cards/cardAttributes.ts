import { Card, UNKNOWN_MINION_ATTRS, UNKNOWN_VAMPIRE_ATTRS } from '@/shared/model/Card.ts'
import { CardBaseAttribute } from '@/shared/types/state.ts'

/**
 * Read / write the base numeric attributes a player can adjust by hand : a
 * minion's bleed, stealth, intercept and strength, a vampire's hunt, votes and
 * ballots. A lookup says which attribute bag each one lives on, so both
 * accessors stay a single keyed read / write.
 */

const VAMPIRE_CARD_ATTRIBUTES = [
    CardBaseAttribute.Hunt,
    CardBaseAttribute.Vote,
    CardBaseAttribute.Ballot,
]

// The bag holding a given attribute, or null when the card doesn't carry it.
// Both bags expose their numeric attributes under the CardBaseAttribute key
// names, so the same keyed read / write works through either.
function cardAttributeBag(
    card: Card,
    attribute: CardBaseAttribute,
): Partial<Record<CardBaseAttribute, number>> | null {
    if (VAMPIRE_CARD_ATTRIBUTES.includes(attribute)) {
        const attrs = card.vampireAttrs
        return attrs && attrs != UNKNOWN_VAMPIRE_ATTRS ? attrs : null
    } else {
        const attrs = card.minionAttrs
        return attrs && attrs != UNKNOWN_MINION_ATTRS ? attrs : null
    }
}

export function getCardAttribute(card: Card, attribute: CardBaseAttribute): number | null {
    return cardAttributeBag(card, attribute)?.[attribute] ?? null
}

export function setCardAttribute(card: Card, attribute: CardBaseAttribute, value: number): void {
    const bag = cardAttributeBag(card, attribute)
    if (bag) {
        bag[attribute] = value
    }
}
