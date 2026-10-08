import { ASYLUM_HUNTING_GROUND_ID, ELDER_LIBRARY_ID } from '@/shared/cardImpl/cardIds.ts'
import {
    aVampire,
    bleedIntercept,
    burnInTorpor,
    burnSelf,
    defineCard,
    discardFromHand,
    drawCryptRemoveUncontrolled,
    gainPool,
    gainBlood,
    handSize,
    moveBlood,
    preventDamage,
    putOnMinion,
    stealth,
} from '@/shared/cardImpl/catalog/builders.ts'

export const MASTER_CARDS = [
    defineCard(ELDER_LIBRARY_ID, 'Elder Library', [
        { kind: 'master', staysInPlay: 'standalone', effects: [handSize(1)] },
    ]),
    defineCard('100135', 'Barrens, The', [
        {
            kind: 'master',
            staysInPlay: 'standalone',
            abilities: [{ activate: 'lock', effects: [discardFromHand] }],
        },
    ]),
    // The Trifle keyword is not modelled yet: played as a normal master card
    defineCard('102180', 'Wider View', [
        {
            kind: 'master',
            staysInPlay: 'standalone',
            abilities: [
                { activate: 'transfer', transfers: 1, effects: [drawCryptRemoveUncontrolled] },
                { activate: 'transfer', transfers: 4, effects: [burnSelf, gainPool(2)] },
            ],
        },
    ]),
    defineCard('101104', 'Life in the City', [
        {
            kind: 'master',
            onPlay: { target: 'readyVampireBelowCapacity', effects: [gainBlood(1)] },
        },
    ]),
    // The hunting ground rule ( one hunting ground per vampire ) is ignored
    defineCard(ASYLUM_HUNTING_GROUND_ID, 'Asylum Hunting Ground', [
        {
            kind: 'master',
            staysInPlay: 'standalone',
            abilities: [
                {
                    activate: 'unlock',
                    target: 'readyVampireBelowCapacity',
                    effects: [gainBlood(1)],
                },
            ],
        },
    ]),
    // The second blood for another Anarch when a baron is ready is not modelled
    defineCard('100297', 'Carfax Abbey', [
        {
            kind: 'master',
            staysInPlay: 'standalone',
            abilities: [
                {
                    activate: 'unlock',
                    target: 'readyVampireBelowCapacity',
                    sect: 'Anarch',
                    effects: [gainBlood(1)],
                },
            ],
        },
    ]),
    // Put on a vampire, in torpor too. The master phase ability is used once per turn
    defineCard('100199', 'Blood Doll', [putOnMinion(aVampire(), [moveBlood(1)])]),
    // The Blood Doll that can be burned when it is played and a vampire of another Methuselah as
    // the host are not modelled. The ability is used once per turn, in the unlock phase
    defineCard('102113', 'Vessel', [putOnMinion(aVampire(), [moveBlood(1, { phase: 'unlock' })])]),
    // A Nosferatu antitribu is not a Nosferatu. The clan requirement of the card is the cardbase's
    defineCard('101070', 'Labyrinth, The', [
        {
            kind: 'master',
            staysInPlay: 'standalone',
            abilities: [
                {
                    activate: 'lockForAction',
                    minion: aVampire({ clan: 'Nosferatu' }),
                    effects: [stealth(1)],
                },
            ],
        },
    ]),
    // On a ready vampire you control. The bleed intercept only counts for the bleeds directed at its
    // controller, the prevention is once per combat and the card burns once the vampire is in torpor
    defineCard('100866', 'Guardian Angel', [
        putOnMinion(aVampire({ ready: true }), [bleedIntercept(1), preventDamage(1), burnInTorpor]),
    ]),
    // The hunting ground rule ( one hunting ground per vampire ) is ignored. The clan requirement
    // is the cardbase's
    defineCard('101808', 'Slum Hunting Ground', [
        {
            kind: 'master',
            staysInPlay: 'standalone',
            abilities: [
                {
                    activate: 'unlock',
                    target: 'readyVampireBelowCapacity',
                    effects: [gainBlood(1)],
                },
            ],
        },
    ]),
    defineCard('102150', 'Warzone Hunting Ground', [
        {
            kind: 'master',
            staysInPlay: 'standalone',
            abilities: [
                {
                    activate: 'unlock',
                    target: 'readyVampireBelowCapacity',
                    effects: [gainBlood(1)],
                },
            ],
        },
    ]),
]
