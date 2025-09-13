import { GOVERN_ID, LOST_IN_CROWDS_ID } from '@/resources/cardImpl/cardIds.ts'
import { KrcgId } from '@/resources/cards.ts'
import {
    ActionCardImplementation,
    ActionCardUsage,
    ActionModifierCardImplementation,
    ActionModifierUsage,
    CryptCardImplementation,
} from '@/resources/cardImpl/base.ts'
import { JasonSonNewberryG6 } from '@/resources/cardImpl/jasonsonnewberryg6.ts'
import { GovernTheUnaligned } from '@/resources/cardImpl/governtheunaligned.ts'
import { LostInCrowds } from '@/resources/cardImpl/lostincrowds.ts'

export type ActionCardImplementationConstructor = new (
    usage: ActionCardUsage,
) => ActionCardImplementation
export type ActionModifierCardImplementationConstructor = new (
    usage: ActionModifierUsage,
) => ActionModifierCardImplementation

export const CRYPT_CARD_IMPLEMENTATIONS: Record<KrcgId, CryptCardImplementation> = {
    '201628': new JasonSonNewberryG6(),
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

export type AllImplementationsType =
    | ActionCardImplementationConstructor
    | ActionModifierCardImplementationConstructor

export const LIB_CARD_IMPLEMENTATIONS: Record<KrcgId, AllImplementationsType> = {
    ...ACTION_CARD_IMPLEMENTATIONS,
    ...ACTION_MODIFIER_CARD_IMPLEMENTATIONS,
}
