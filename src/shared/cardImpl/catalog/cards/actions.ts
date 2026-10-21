import {
    all,
    attachToMinion,
    bleed,
    bleedAction,
    burnEquipmentStrike,
    burnInTorpor,
    cannotPlay,
    defineCard,
    discipline,
    enterCombat,
    enterCombatTargetActs,
    gainBlood,
    lockTarget,
    steal,
    stealPool,
    stealth,
    strength,
    strengthIfBlocked,
    weaponStrike,
} from '@/shared/cardImpl/catalog/builders.ts'

export const ACTION_CARDS = [
    // The Nosferatu requirement is the cardbase's. X is the number of copies in play ( the first costs 0 ).
    // The prey burns the pool in the unlock phase of the controller, and any minion can burn the card
    defineCard('102213', 'Creeping Sabotage', [
        {
            kind: 'action',
            target: 'none',
            staysInPlay: 'standalone',
            xIsCopies: true,
            burnable: true,
            whileInPlay: [{ type: 'preyBurnsPool', amount: 1 }],
            effects: [stealth(1)],
        },
    ]),
    defineCard('100845', 'Govern the Unaligned', [
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
    // Put on the acting vampire ( one per vampire ), burned when it is in torpor. Gives a strike that
    // burns an equipment. Superior: +2 strength and a 2R strike
    defineCard('100913', 'Heroic Might', [
        attachToMinion(
            [strength(1), burnEquipmentStrike, burnInTorpor],
            discipline('pot', 'inferior'),
            { effects: [stealth(3)], onePerMinion: true },
        ),
        attachToMinion(
            [strength(2), burnEquipmentStrike, weaponStrike(2, { ranged: true }), burnInTorpor],
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
    // Inferior steals a retainer, superior an ally: the cards controlled by the other Methuselahs
    defineCard('100703', 'Far Mastery', [
        {
            kind: 'action',
            requires: discipline('dom', 'inferior'),
            target: 'retainerOfOtherMethuselah',
            effects: [stealth(1), steal],
        },
        {
            kind: 'action',
            requires: discipline('dom', 'superior'),
            target: 'allyOfOtherMethuselah',
            effects: [stealth(1), steal],
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
