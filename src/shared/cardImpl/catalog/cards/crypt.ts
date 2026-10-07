import { ABRAHAM_MELLON_ID } from '@/shared/cardImpl/cardIds.ts'
import {
    actionSuccessful,
    actorIs,
    burnBlood,
    defineCrypt,
    unlockSelf,
} from '@/shared/cardImpl/catalog/builders.ts'

export const CRYPT_CARDS = [
    defineCrypt('201628', 'Jason "Son" Newberry', { bleed: 1 }),
    defineCrypt(ABRAHAM_MELLON_ID, 'Abraham Mellon', { handSize: 1 }),
    defineCrypt('201614', 'Valeriya Zinovieva', { strength: 1 }),
    defineCrypt('201613', 'Theo Bell', { strength: 1, canEnterCombat: true }),
    defineCrypt('200132', 'Ariane', { undirectedStealth: -1 }),
    defineCrypt('201585', 'Elen Kamjian', { mustBleedWhileMinionLocked: true }),
    // Once each turn, burn 1 blood to unlock after another Anarch you control performs a
    // successful action ( not blocked ). Usable in torpor.
    defineCrypt('201576', 'Aline Gädeke', {
        triggers: [
            {
                on: 'actionResolved',
                mode: 'optional',
                when: [
                    actionSuccessful,
                    actorIs({ other: true, controller: 'self', sect: 'Anarch' }),
                ],
                cost: burnBlood(1),
                limit: 'oncePerTurn',
                sourceIn: ['ready', 'torpor'],
                effects: [unlockSelf],
            },
        ],
    }),
]
