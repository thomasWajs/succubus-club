import { LOST_IN_CROWDS_ID } from '@/shared/cardImpl/cardIds.ts'
import {
    armTrigger,
    bleed,
    bleedX,
    defineCard,
    discipline,
    duringBleed,
    lockAt,
    stealth,
    targetPoolAtMost,
} from '@/shared/cardImpl/catalog/builders.ts'

export const MODIFIER_CARDS = [
    defineCard(LOST_IN_CROWDS_ID, 'Lost in Crowds', [
        { kind: 'modifier', requires: discipline('obf', 'inferior'), effects: [stealth(1)] },
        { kind: 'modifier', requires: discipline('obf', 'superior'), effects: [stealth(2)] },
    ]),
    defineCard('100401', 'Conditioning', [
        {
            kind: 'modifier',
            requires: discipline('dom', 'inferior'),
            when: [duringBleed],
            effects: [bleed(2, { limited: true })],
        },
        {
            kind: 'modifier',
            requires: discipline('dom', 'superior'),
            when: [duringBleed],
            effects: [bleed(3, { limited: true })],
        },
    ]),
    defineCard('100236', 'Bonding', [
        {
            kind: 'modifier',
            requires: discipline('dom', 'inferior'),
            when: [duringBleed],
            effects: [bleed(1, { limited: true })],
        },
        {
            kind: 'modifier',
            requires: discipline('dom', 'superior'),
            when: [duringBleed],
            effects: [stealth(1), bleed(1, { limited: true })],
        },
    ]),
    defineCard('100687', 'Faceless Night', [
        { kind: 'modifier', requires: discipline('obf', 'inferior'), effects: [stealth(1)] },
        {
            kind: 'modifier',
            requires: discipline('obf', 'superior'),
            effects: [
                stealth(1),
                armTrigger({
                    on: 'blockFailed',
                    mode: 'auto',
                    effects: [lockAt('actionResolving', 'eventBlocker')],
                }),
            ],
        },
    ]),
    // Superior: another ready vampire of the acting player plays it ( a locked one can )
    defineCard('100362', 'Cloak the Gathering', [
        { kind: 'modifier', requires: discipline('obf', 'inferior'), effects: [stealth(1)] },
        {
            kind: 'modifier',
            requires: discipline('obf', 'superior'),
            by: 'otherThanActing',
            effects: [stealth(1)],
        },
    ]),
    // Superior: the bonus is only worth playing while the target has 9 pool or less. The rulings
    // allow playing it anyway, with a lingering effect, which a bot never wants.
    defineCard('100765', 'Foreshadowing Destruction', [
        {
            kind: 'modifier',
            requires: discipline('dom', 'inferior'),
            when: [duringBleed],
            effects: [bleed(1, { limited: true })],
        },
        {
            kind: 'modifier',
            requires: discipline('dom', 'superior'),
            when: [duringBleed, targetPoolAtMost(9)],
            effects: [bleed(3, { limited: true })],
        },
    ]),
    // Requires an Anarch ( the cardbase says it )
    defineCard('101239', 'Monkey Wrench', [
        {
            kind: 'modifier',
            when: [duringBleed],
            x: { min: 1, max: 3 },
            effects: [bleedX({ limited: true })],
        },
    ]),
]
