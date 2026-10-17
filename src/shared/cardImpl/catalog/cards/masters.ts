import {
    aMinion,
    aVampire,
    bleedIntercept,
    bloodToPool,
    bloodToPoolBetween,
    burnInTorpor,
    burnSelf,
    defineCard,
    discardFromHand,
    drawCryptRemoveUncontrolled,
    gainPool,
    gainBlood,
    handSize,
    intercept,
    moveBlood,
    preventDamage,
    putOnMinion,
    raisePlayCost,
    stealth,
} from '@/shared/cardImpl/catalog/builders.ts'

export const MASTER_CARDS = [
    defineCard('100620', 'Elder Library', [
        { kind: 'master', staysInPlay: 'standalone', effects: [handSize(1)] },
    ]),
    defineCard('100135', 'Barrens, The', [
        {
            kind: 'master',
            staysInPlay: 'standalone',
            abilities: [{ activate: 'lock', effects: [discardFromHand] }],
        },
    ]),
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
    defineCard('100108', 'Asylum Hunting Ground', [
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
    // Any amount of blood of a vampire you control, in torpor too. The +1 pool for each Villein on the target
    // comes from the Villein
    defineCard('101217', 'Minion Tap', [
        { kind: 'master', onPlay: { target: 'vampireWithBlood', effects: [bloodToPool] } },
    ]),
    // Put on a vampire that holds blood ( in torpor too ), 2 to 5 blood of it become pool. The cost of +1 pool
    // is for each Villein already on the vampire, and for a Minion Tap played on it. A vampire with 0 blood
    // is a legal target of the card but never worth it: it is not offered
    defineCard('102121', 'Villein', [
        {
            ...putOnMinion(aVampire(), [raisePlayCost(1, '101217', '102121')]),
            onPlay: { target: 'vampireWithBlood', effects: [bloodToPoolBetween(2, 5)] },
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
    // Only the first ability is modelled: the minion is one of the Methuselah's own. The second one ( lock
    // and burn 1 pool to give a minion of another Methuselah +1 intercept ) is not
    defineCard('101067', 'KRCG News Radio', [
        {
            kind: 'master',
            staysInPlay: 'standalone',
            abilities: [
                { activate: 'lockForReaction', minion: aMinion(), effects: [intercept(1)] },
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
