import { defineCard, discipline, maneuver, stealth } from '@/shared/cardImpl/catalog/builders.ts'

// Cards whose plays are of several kinds
export const MULTI_KIND_CARDS = [
    defineCard('101913', 'Swallowed by the Night', [
        { kind: 'modifier', requires: discipline('obf', 'inferior'), effects: [stealth(1)] },
        { kind: 'combat', requires: discipline('obf', 'superior'), effects: [maneuver] },
    ]),
]
