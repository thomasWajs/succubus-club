import { attachToMinion, defineCard, weaponStrike } from '@/shared/cardImpl/catalog/builders.ts'

export const EQUIPMENTS_CARDS = [
    // Weapon: gun. Strike: 2R damage, with 1 optional maneuver each combat.
    defineCard('100001', '.44 Magnum', [
        attachToMinion([weaponStrike(2, { ranged: true, maneuver: true })]),
    ]),
]
