import {
    attachToMinion,
    defineCard,
    discipline,
    environmentalDamage,
    intercept,
    life,
} from '@/shared/cardImpl/catalog/builders.ts'

export const RETAINERS_CARDS = [
    // Animal. [ani] The employer gets +1 intercept, with 1 life. [ANI] As above, with 2 life.
    defineCard('101550', 'Raven Spy', [
        attachToMinion([life(1), intercept(1)], discipline('ani', 'inferior')),
        attachToMinion([life(2), intercept(1)], discipline('ani', 'superior')),
    ]),
    // Animal. Inflicts 1R damage on the opposing minion each round of combat, 1 life ( [ANI]: 2 )
    defineCard('101254', 'Murder of Crows', [
        attachToMinion([life(1), environmentalDamage(1)], discipline('ani', 'inferior')),
        attachToMinion([life(2), environmentalDamage(1)], discipline('ani', 'superior')),
    ]),
]
