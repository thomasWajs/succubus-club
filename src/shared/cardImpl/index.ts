import { FAR_MASTERY_ID } from '@/shared/cardImpl/cardIds.ts'
import {
    ActionCardImplementation,
    ActionModifierCardImplementation,
    CardImplementation,
    CombatCardImplementation,
    CryptCardImplementation,
    MasterCardImplementation,
    ReactionCardImplementation,
} from '@/shared/cardImpl/base.ts'
import { CARD_DEFS } from '@/shared/cardImpl/catalog/index.ts'
import {
    actionImplementation,
    combatImplementation,
    cryptImplementation,
    masterImplementation,
    modifierImplementation,
    reactionImplementation,
} from '@/shared/cardImpl/catalog/interpreter.ts'
import { CardDef, CardKind } from '@/shared/cardImpl/catalog/types.ts'
import { FarMastery } from '@/shared/cardImpl/farmastery.ts'
import { LibraryCardUsage } from '@/shared/types/state.ts'
import { KrcgId } from '@/shared/types/gateway.ts'
import { Card, LibraryCard, Minion } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'

/**
 * The registries, one per kind of card. Most of their entries are built from the catalog of
 * cards described as data ( cardImpl/catalog ); a card the data cannot express is a hand-written
 * class listed here.
 */

export type CardImplementationConstructor<T extends CardImplementation> = new (
    minion: Minion,
    usage: LibraryCardUsage,
) => T

export type CardImplementationRegistry<T extends CardImplementation> = Record<
    KrcgId,
    CardImplementationConstructor<T>
>

export type MasterCardImplementationConstructor = new (
    player: Player,
    card: LibraryCard,
) => MasterCardImplementation

// Everything the catalog describes with at least one play of the kind
function fromCatalog<T>(kind: CardKind, build: (def: CardDef) => T): Record<KrcgId, T> {
    const registry: Record<KrcgId, T> = {}
    for (const def of CARD_DEFS) {
        if (def.plays.some(play => play.kind == kind)) {
            registry[def.id] = build(def)
        }
    }
    return registry
}

export const CRYPT_CARD_IMPLEMENTATIONS: Record<KrcgId, CryptCardImplementation> = {}
for (const def of CARD_DEFS) {
    if (def.crypt) {
        CRYPT_CARD_IMPLEMENTATIONS[def.id] = cryptImplementation(def)
    }
}

export const ACTION_CARD_IMPLEMENTATIONS: CardImplementationRegistry<ActionCardImplementation> = {
    ...fromCatalog('action', actionImplementation),
    [FAR_MASTERY_ID]: FarMastery,
}

export const ACTION_MODIFIER_CARD_IMPLEMENTATIONS: CardImplementationRegistry<ActionModifierCardImplementation> =
    fromCatalog('modifier', modifierImplementation)

export const COMBAT_CARD_IMPLEMENTATIONS: CardImplementationRegistry<CombatCardImplementation> =
    fromCatalog('combat', combatImplementation)

export const REACTION_CARD_IMPLEMENTATIONS: CardImplementationRegistry<ReactionCardImplementation> =
    fromCatalog('reaction', reactionImplementation)

export const MASTER_CARD_IMPLEMENTATIONS: Record<KrcgId, MasterCardImplementationConstructor> =
    fromCatalog('master', masterImplementation)

// The implementation of a master card, or null when the card has none
export function getMasterImplementation(
    card: LibraryCard,
    player: Player,
): MasterCardImplementation | null {
    const Implementation = card.krcgId ? MASTER_CARD_IMPLEMENTATIONS[card.krcgId] : undefined
    return Implementation ? new Implementation(player, card) : null
}

// The crypt implementation of a minion ( an ally has none )
export function getCryptImplementation(minion: Minion): CryptCardImplementation | undefined {
    return minion.krcgId ? CRYPT_CARD_IMPLEMENTATIONS[minion.krcgId] : undefined
}

// What a card in play adds to the hand size of its controller ( the caller checks that it is in play )
export function getHandSizeBonus(card: Card): number {
    if (!card.krcgId) {
        return 0
    }
    if (card instanceof LibraryCard) {
        return getMasterImplementation(card, card.controller)?.handSizeBonus ?? 0
    }
    return CRYPT_CARD_IMPLEMENTATIONS[card.krcgId]?.handSizeBonus ?? 0
}

export function hasImplementation<T extends CardImplementation>(
    registry: CardImplementationRegistry<T>,
    card: LibraryCard,
): boolean {
    return !!card.krcgId && !!registry[card.krcgId]
}

// The implementation of a card, or null when the card has none. Only a handful of
// cards are implemented: a human can play any of the ~4000 cards.
export function getImplementation<T extends CardImplementation>(
    registry: CardImplementationRegistry<T>,
    card: LibraryCard,
    minion: Minion,
    usage: LibraryCardUsage,
): T | null {
    if (!card.krcgId) {
        return null
    }
    const Implementation = registry[card.krcgId]
    return Implementation ? new Implementation(minion, usage) : null
}
