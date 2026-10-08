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
    defineCrypt('201555', 'Lenny Burkhead', { bleed: 1 }),
    // +1 intercept during directed actions ( when she attempts to block one )
    defineCrypt('201545', 'Dowager, The', { directedIntercept: 1 }),
    // Larissa Moreira ( discard an [ani] card for +1 bleed ) is not modelled
    // Vanilla vampires: nothing to add to the cardbase
    defineCrypt('201537', 'Belinde', {}),
    defineCrypt('201549', 'Horace Radcliffe', {}),
    defineCrypt('201573', 'Wauneka', {}),
    defineCrypt('201534', 'Aunt Linda', {}),
    defineCrypt('201568', 'Ryan', {}),
    defineCrypt('201536', 'Baixinho', {}),
    defineCrypt('201532', 'Andi Liu', {}),
    defineCrypt('201533', 'Ashley', {}),
    defineCrypt('201543', 'Colette', {}),
    defineCrypt('201544', 'Donny Kowalczyk', {}),
    defineCrypt('201546', 'Dr. Stephen Norton', {}),
    defineCrypt('201548', 'Gelasia Fotiou', {}),
    defineCrypt('201559', 'Meaghan', {}),
    defineCrypt('201569', 'Sully', {}),
    defineCrypt('201579', 'Atiena', {}),
    defineCrypt('201581', 'Brandon Grime', {}),
    defineCrypt('201609', 'Octane', {}),
    defineCrypt('201610', 'Rayne', {}),
    defineCrypt('201612', 'Siarhei Levchenko', {}),
    // The burn of 1 blood to vote against his referendums is not modelled ( politics )
    defineCrypt('201530', 'Alexander Silverson', {}),
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
