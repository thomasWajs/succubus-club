import { ASYLUM_HUNTING_GROUND_ID, ELDER_LIBRARY_ID } from '@/shared/cardImpl/cardIds.ts'
import {
    burnSelf,
    defineCard,
    discardFromHand,
    drawCryptRemoveUncontrolled,
    gainPool,
    gainBlood,
    handSize,
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
