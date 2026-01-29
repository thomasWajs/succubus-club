import { CryptCardImplementation } from '@/shared/cardImpl/base.ts'
import { CryptCard } from '@/shared/model/Card.ts'

export const JasonSonNewberryG6: CryptCardImplementation = {
    adapt(card: CryptCard) {
        card.minionAttrs.bleed = 2
    },
}
