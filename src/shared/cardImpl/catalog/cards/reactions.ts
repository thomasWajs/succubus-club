import { DEFLECTION_ID } from '@/shared/cardImpl/cardIds.ts'
import {
    actionTargetsYou,
    afterBlocksDeclined,
    changeTarget,
    defineCard,
    discipline,
    duringBleed,
    intercept,
    minionLocked,
    onlyIf,
    unlockAndBlock,
    usableWhileLocked,
    yourAnarchBlockStands,
    oncePerUnlock,
    reactorIsVampire,
    wake,
    yourBlockStands,
} from '@/shared/cardImpl/catalog/builders.ts'

// A bounce: the bleed is aimed at you, the blocks are declined
const BOUNCE_WHEN = [duringBleed, actionTargetsYou, afterBlocksDeclined, reactorIsVampire]

export const REACTION_CARDS = [
    defineCard(DEFLECTION_ID, 'Deflection', [
        {
            kind: 'reaction',
            requires: discipline('dom', 'inferior'),
            when: BOUNCE_WHEN,
            effects: [changeTarget({ lockReactor: true })],
        },
        {
            kind: 'reaction',
            requires: discipline('dom', 'superior'),
            when: BOUNCE_WHEN,
            effects: [changeTarget({ lockReactor: false })],
        },
    ]),
    // The ally clause of On the Qui Vive ( no unlock at the next unlock phase ) is not modelled
    defineCard('101321', 'On the Qui Vive', [
        { kind: 'reaction', when: [minionLocked, oncePerUnlock], effects: [wake] },
    ]),
    // Inferior: also only worth playing once a block attempt stands ( a later attempt overwrites
    // the intercept of the action )
    defineCard('100680', 'Eyes of Argus', [
        {
            kind: 'reaction',
            requires: discipline('aus', 'inferior'),
            when: [actionTargetsYou, yourBlockStands],
            effects: [intercept(2)],
        },
        {
            kind: 'reaction',
            requires: discipline('aus', 'superior'),
            when: [minionLocked, reactorIsVampire],
            effects: [wake],
        },
    ]),
    // Requires a baron: the reacting vampire ( the cardbase says it )
    defineCard('102218', 'Bait and Switch', [
        { kind: 'reaction', when: BOUNCE_WHEN, effects: [changeTarget({ lockReactor: true })] },
    ]),
    // Requires a baron, locked or not ( the cardbase says it ): +1 intercept for an Anarch whose block
    // attempt stands, or unlock an Anarch which attempts to block with +1 intercept
    defineCard('102230', 'Organized Resistance', [
        {
            kind: 'reaction',
            when: [usableWhileLocked, actionTargetsYou],
            effects: [
                onlyIf(intercept(1), yourAnarchBlockStands),
                unlockAndBlock({ intercept: 1 }),
            ],
        },
    ]),
    defineCard('101949', 'Telepathic Misdirection', [
        {
            kind: 'reaction',
            requires: discipline('aus', 'inferior'),
            when: [yourBlockStands],
            effects: [intercept(1)],
        },
        {
            kind: 'reaction',
            requires: discipline('aus', 'superior'),
            when: BOUNCE_WHEN,
            effects: [changeTarget({ lockReactor: true })],
        },
    ]),
]
