import { GOVERN_ID } from '@/shared/cardImpl/cardIds.ts'
import {
    all,
    bleed,
    bleedAction,
    defineCard,
    discipline,
    enterCombat,
    gainBlood,
    stealPool,
    stealth,
    strengthIfBlocked,
} from '@/shared/cardImpl/catalog/builders.ts'

export const ACTION_CARDS = [
    defineCard(GOVERN_ID, 'Govern the Unaligned', [
        {
            kind: 'action',
            requires: discipline('dom', 'inferior'),
            target: 'player',
            effects: [bleedAction, bleed(2)],
        },
        {
            kind: 'action',
            requires: discipline('dom', 'superior'),
            target: 'youngerUncontrolledVampire',
            effects: [stealth(1), gainBlood(3)],
        },
    ]),
    // Requires an Anarch ( the cardbase says it )
    defineCard('102229', 'Line Brawl', [
        {
            kind: 'action',
            requires: discipline('cel', 'inferior'),
            target: 'player',
            effects: [stealPool(1)],
        },
        {
            kind: 'action',
            requires: discipline('pot', 'inferior'),
            target: 'minionOfOtherMethuselah',
            effects: [enterCombat],
        },
        {
            kind: 'action',
            requires: discipline('pre', 'inferior'),
            target: 'player',
            effects: [bleedAction, bleed(1)],
        },
    ]),
    defineCard('101772', 'Show of Force', [
        {
            kind: 'action',
            requires: all(discipline('pot', 'inferior'), discipline('pre', 'inferior')),
            target: 'player',
            effects: [bleedAction, bleed(1), strengthIfBlocked(1)],
        },
        {
            kind: 'action',
            requires: all(discipline('pot', 'superior'), discipline('pre', 'superior')),
            target: 'player',
            effects: [bleedAction, bleed(2), strengthIfBlocked(2)],
        },
    ]),
    defineCard('100640', 'Enchant Kindred', [
        {
            kind: 'action',
            requires: discipline('pre', 'inferior'),
            target: 'player',
            effects: [bleedAction, bleed(1)],
        },
        {
            kind: 'action',
            requires: discipline('pre', 'superior'),
            target: 'youngerUncontrolledVampire',
            effects: [stealth(1), gainBlood(2)],
        },
    ]),
]
