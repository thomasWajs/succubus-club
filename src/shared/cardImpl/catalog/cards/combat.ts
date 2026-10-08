import { BEHIND_YOU_ID } from '@/shared/cardImpl/cardIds.ts'
import {
    additionalStrike,
    beforeRange,
    beforeStrikes,
    closeRange,
    endOfRound,
    environmentalDamage,
    gainBloodFromDamage,
    grapple,
    oncePerCombat,
    oncePerRound,
    opposingIsVampire,
    combatRound,
    defineCard,
    discipline,
    dodge,
    handStrike,
    maneuver,
    maneuverToClose,
    setStrength,
} from '@/shared/cardImpl/catalog/builders.ts'

export const COMBAT_CARDS = [
    defineCard(BEHIND_YOU_ID, 'Behind You!', [
        {
            kind: 'combat',
            requires: discipline('obf', 'inferior'),
            when: [combatRound(1)],
            effects: [maneuver],
        },
        {
            kind: 'combat',
            requires: discipline('obf', 'superior'),
            when: [combatRound(1)],
            effects: [dodge],
        },
    ]),
    defineCard('102215', 'Roundhouse', [
        { kind: 'combat', requires: discipline('pot', 'inferior'), effects: [handStrike(2)] },
        { kind: 'combat', requires: discipline('pot', 'superior'), effects: [handStrike(3)] },
    ]),
    // Superior: the optional maneuver only gets to close range ( the strike comes with it )
    defineCard('101798', 'Slam', [
        { kind: 'combat', requires: discipline('pot', 'inferior'), effects: [handStrike(2)] },
        {
            kind: 'combat',
            requires: discipline('pot', 'superior'),
            effects: [handStrike(2), maneuverToClose],
        },
    ]),
    defineCard('101993', 'Torn Signpost', [
        {
            kind: 'combat',
            requires: discipline('pot', 'inferior'),
            when: [beforeRange],
            effects: [setStrength(2)],
        },
        {
            kind: 'combat',
            requires: discipline('pot', 'superior'),
            when: [beforeRange],
            effects: [setStrength(3)],
        },
    ]),
    // A vampire plays only one per combat
    defineCard('100301', 'Carrion Crows', [
        {
            kind: 'combat',
            requires: discipline('ani', 'inferior'),
            when: [beforeRange, oncePerCombat],
            effects: [environmentalDamage(1)],
        },
        {
            kind: 'combat',
            requires: discipline('ani', 'superior'),
            when: [beforeRange, oncePerCombat],
            effects: [environmentalDamage(2)],
        },
    ]),
    defineCard('101532', 'Quickness', [
        {
            kind: 'combat',
            requires: discipline('cel', 'inferior'),
            when: [oncePerRound],
            effects: [additionalStrike({ limited: true })],
        },
        {
            kind: 'combat',
            requires: discipline('cel', 'superior'),
            when: [oncePerRound],
            effects: [additionalStrike({ limited: false })],
        },
    ]),
    defineCard('101523', 'Pursuit', [
        { kind: 'combat', requires: discipline('cel', 'inferior'), effects: [maneuver] },
        {
            kind: 'combat',
            requires: discipline('cel', 'superior'),
            effects: [additionalStrike({ limited: true })],
        },
    ]),
    // Requires an Anarch ( the cardbase says it )
    defineCard('100597', 'Dust Up', [
        {
            kind: 'combat',
            requires: discipline('ani', 'inferior'),
            effects: [handStrike(1, { undodgeable: true })],
        },
        {
            kind: 'combat',
            requires: discipline('cel', 'inferior'),
            effects: [dodge, additionalStrike({ limited: true })],
        },
        { kind: 'combat', requires: discipline('pot', 'inferior'), effects: [handStrike(2)] },
    ]),
    // The strikes that are not hand strikes are refused by the combat engine for the round
    defineCard('100959', 'Immortal Grapple', [
        {
            kind: 'combat',
            requires: discipline('pot', 'inferior'),
            when: [beforeStrikes, closeRange, oncePerRound],
            effects: [grapple({ press: false, closeNextRound: false })],
        },
        {
            kind: 'combat',
            requires: discipline('pot', 'superior'),
            when: [beforeStrikes, closeRange, oncePerRound],
            effects: [grapple({ press: true, closeNextRound: true })],
        },
    ]),
    defineCard('101945', 'Taste of Vitae', [
        {
            kind: 'combat',
            when: [endOfRound, oncePerRound, opposingIsVampire],
            effects: [gainBloodFromDamage],
        },
    ]),
]
