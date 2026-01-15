import { CryptCardImplementation } from '@/resources/cardImpl/base.ts'
import { CryptCard } from '@/model/Card.ts'

export const JasonSonNewberryG6: CryptCardImplementation = {
    adapt(card: CryptCard) {
        card.minionAttrs.bleed = 2
    },
}
