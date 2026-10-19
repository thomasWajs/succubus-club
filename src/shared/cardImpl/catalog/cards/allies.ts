import { AllyAbility } from '@/shared/cardImpl/catalog/types.ts'
import {
    defineCard,
    discipline,
    dodgeOnce,
    recruitAlly,
    vampireIntercept,
    weaponStrike,
} from '@/shared/cardImpl/catalog/builders.ts'

const STRAY_ABILITIES: AllyAbility[] = [
    { activate: 'burnLifeForPress', life: 1 },
    {
        activate: 'burnInReaction',
        against: 'actionAtYou',
        effect: { type: 'unlockMinion' },
    },
]

// The ally cards. The numbers of the first line of the text ( life, strength, bleed ) are read from the cardbase,
// a play only says what its version changes.
export const ALLIES_CARDS = [
    // Unique mortal with 2 life. Can strike: 1R damage. Once each combat, can strike: dodge. +1 intercept against
    // vampires. During your discard phase, burn him to burn a vampire who committed diablerie since your last turn
    // ( not modelled: diablerie is not )
    defineCard('100298', 'Carlton Van Wyk', [
        recruitAlly(
            undefined,
            {},
            { attached: [weaponStrike(1, { ranged: true }), dodgeOnce, vampireIntercept(1)] },
        ),
    ]),
    // Unique mortal with 2 life, 1 strength. You can burn him to reduce a bleed against you by 3.
    defineCard('102217', '47th Street Royals', [
        recruitAlly(
            undefined,
            {},
            {
                abilities: [
                    {
                        activate: 'burnInReaction',
                        against: 'bleedAtYou',
                        effect: { type: 'reduceBleed', amount: 3 },
                    },
                ],
            },
        ),
    ]),
    // Animal with 1 life, 0 strength. [ani] Can burn 1 life to give a minion you control 1 press; during an action
    // directed at you it can be burned, if not blocking, to unlock a ready minion you control. [ANI] 2 life, 1 strength.
    defineCard('102065', 'Underbridge Stray', [
        recruitAlly(discipline('ani', 'inferior'), {}, { abilities: STRAY_ABILITIES }),
        recruitAlly(
            discipline('ani', 'superior'),
            { life: 2, strength: 1 },
            { abilities: STRAY_ABILITIES },
        ),
    ]),
]
