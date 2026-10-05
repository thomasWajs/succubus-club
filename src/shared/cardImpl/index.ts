import {
    BEHIND_YOU_ID,
    FAR_MASTERY_ID,
    GOVERN_ID,
    LOST_IN_CROWDS_ID,
} from '@/shared/cardImpl/cardIds.ts'
import {
    ActionCardImplementation,
    ActionModifierCardImplementation,
    CardImplementation,
    CombatCardImplementation,
    CryptCardImplementation,
} from '@/shared/cardImpl/base.ts'
import { BehindYou } from '@/shared/cardImpl/behindyou.ts'
import { FarMastery } from '@/shared/cardImpl/farmastery.ts'
import { JasonSonNewberryG6 } from '@/shared/cardImpl/jasonsonnewberryg6.ts'
import { GovernTheUnaligned } from '@/shared/cardImpl/governtheunaligned.ts'
import { LostInCrowds } from '@/shared/cardImpl/lostincrowds.ts'
import { LibraryCardUsage } from '@/shared/types/state.ts'
import { KrcgId } from '@/shared/types/gateway.ts'
import { LibraryCard, Minion } from '@/shared/model/Card.ts'

export type CardImplementationConstructor<T extends CardImplementation> = new (
    minion: Minion,
    usage: LibraryCardUsage,
) => T

export type CardImplementationRegistry<T extends CardImplementation> = Record<
    KrcgId,
    CardImplementationConstructor<T>
>

export const CRYPT_CARD_IMPLEMENTATIONS: Record<KrcgId, CryptCardImplementation> = {
    '201628': JasonSonNewberryG6,
}

export const ACTION_CARD_IMPLEMENTATIONS: CardImplementationRegistry<ActionCardImplementation> = {
    [FAR_MASTERY_ID]: FarMastery,
    [GOVERN_ID]: GovernTheUnaligned,
}

export const ACTION_MODIFIER_CARD_IMPLEMENTATIONS: CardImplementationRegistry<ActionModifierCardImplementation> =
    {
        [LOST_IN_CROWDS_ID]: LostInCrowds,
    }

export const COMBAT_CARD_IMPLEMENTATIONS: CardImplementationRegistry<CombatCardImplementation> = {
    [BEHIND_YOU_ID]: BehindYou,
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
