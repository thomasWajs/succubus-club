import { GOVERN_ID, LOST_IN_CROWDS_ID } from '@/shared/cardImpl/cardIds.ts'
import {
    ActionCardImplementation,
    ActionModifierCardImplementation,
    CryptCardImplementation,
} from '@/shared/cardImpl/base.ts'
import { JasonSonNewberryG6 } from '@/shared/cardImpl/jasonsonnewberryg6.ts'
import { GovernTheUnaligned } from '@/shared/cardImpl/governtheunaligned.ts'
import { LostInCrowds } from '@/shared/cardImpl/lostincrowds.ts'
import { LibraryCardUsage } from '@/shared/types/state.ts'
import { KrcgId } from '@/shared/types/gateway.ts'
import { Player } from '@/shared/model/Player.ts'

export type ActionCardImplementationConstructor = new (
    owner: Player,
    usage: LibraryCardUsage,
) => ActionCardImplementation

export type ActionModifierCardImplementationConstructor = new (
    owner: Player,
    usage: LibraryCardUsage,
) => ActionModifierCardImplementation

export const CRYPT_CARD_IMPLEMENTATIONS: Record<KrcgId, CryptCardImplementation> = {
    '201628': JasonSonNewberryG6,
}

export const ACTION_CARD_IMPLEMENTATIONS: Record<KrcgId, ActionCardImplementationConstructor> = {
    [GOVERN_ID]: GovernTheUnaligned,
}

export const ACTION_MODIFIER_CARD_IMPLEMENTATIONS: Record<
    KrcgId,
    ActionModifierCardImplementationConstructor
> = {
    [LOST_IN_CROWDS_ID]: LostInCrowds,
}
