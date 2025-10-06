import { CryptCardImplementation } from '@/resources/cardImpl/base.ts'
import { CryptCard } from '@/model/Card.ts'

export class JasonSonNewberryG6 extends CryptCardImplementation {
    adapt(card: CryptCard) {
        card.minionAttrs.bleed = 2
    }
}
