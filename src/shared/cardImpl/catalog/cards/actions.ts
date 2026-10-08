import { GOVERN_ID } from '@/shared/cardImpl/cardIds.ts'
import {
    all,
    attachToMinion,
    bleed,
    bleedAction,
    burnInTorpor,
    cannotPlay,
    defineCard,
    discipline,
    enterCombat,
    enterCombatTargetActs,
    gainBlood,
    lockTarget,
    stealPool,
    stealth,
    strength,
    strengthIfBlocked,
    weaponStrike,
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
    // Put on the acting vampire, which gets more strength ( one per vampire, and no Torn Signpost )
    defineCard('101483', 'Preternatural Strength', [
        attachToMinion([strength(1), cannotPlay('Torn Signpost')], discipline('pot', 'inferior'), {
            effects: [stealth(2)],
            onePerMinion: true,
        }),
        attachToMinion([strength(2), cannotPlay('Torn Signpost')], discipline('pot', 'superior'), {
            effects: [stealth(2)],
            onePerMinion: true,
        }),
    ]),
    // Put on the acting vampire ( one per vampire ), burned when it is in torpor. The strike that
    // burns an equipment is not modelled. Superior: +2 strength and a 2R strike
    defineCard('100913', 'Heroic Might', [
        attachToMinion([strength(1), burnInTorpor], discipline('pot', 'inferior'), {
            effects: [stealth(3)],
            onePerMinion: true,
        }),
        attachToMinion(
            [strength(2), weaponStrike(2, { ranged: true }), burnInTorpor],
            discipline('pot', 'superior'),
            { effects: [stealth(3)], onePerMinion: true },
        ),
    ]),
    // Superior: the target is the acting minion of the combat, it plays first
    defineCard('100515', 'Deep Song', [
        {
            kind: 'action',
            requires: discipline('ani', 'inferior'),
            target: 'player',
            effects: [bleedAction, bleed(1)],
        },
        {
            kind: 'action',
            requires: discipline('ani', 'superior'),
            target: 'vampireOfOtherMethuselah',
            effects: [lockTarget, enterCombatTargetActs],
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
