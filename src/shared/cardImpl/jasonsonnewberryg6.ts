import { CryptCardImplementation } from '@/shared/cardImpl/base.ts'
import { CryptCard, UNKNOWN_MINION_ATTRS } from '@/shared/model/Card.ts'

export const JasonSonNewberryG6: CryptCardImplementation = {
    adapt(card: CryptCard) {
        if (card.minionAttrs != UNKNOWN_MINION_ATTRS) {
            card.minionAttrs.bleed = 2
        }
    },
}
