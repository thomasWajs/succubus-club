// Checks that the cards described in src/shared/cardImpl/catalog agree with the printed cards
// of the cardbase: the name, the type of the card against the kinds of its plays, and the
// requirements of the plays against the disciplines in the card text ( parseCardUsage ).
// Run from the repo root: npm run catalog:check

import { CARD_DEFS } from '@/shared/cardImpl/catalog/index.ts'
import { expandRequirement, usageOptionKey } from '@/shared/cardImpl/catalog/requirements.ts'
import { CardKind } from '@/shared/cardImpl/catalog/types.ts'
import { ACTION_TYPES, LibraryCardType } from '@/shared/const/model.ts'
import { parseCardUsage } from '@/shared/state/usageParsing.ts'
import { getCardById } from './cardLookup.ts'

const KIND_OF_TYPE: Record<string, CardKind> = {
    [LibraryCardType.ActionModifier]: 'modifier',
    [LibraryCardType.Combat]: 'combat',
    [LibraryCardType.Reaction]: 'reaction',
    [LibraryCardType.Master]: 'master',
    ...Object.fromEntries(ACTION_TYPES.map(type => [type, 'action' as const])),
}

const failures: string[] = []

for (const def of CARD_DEFS) {
    const fail = (reason: string) => failures.push(`${def.name} (${def.id}): ${reason}`)
    const card = getCardById(def.id)
    if (!card) {
        fail('not in the cardbase')
        continue
    }
    if (card.name != def.name) {
        fail(`named '${card.name}' in the cardbase`)
    }

    if (def.crypt) {
        if (card.capacity === undefined) {
            fail('described as a crypt card but it is not one')
        }
        continue
    }
    if (card.capacity !== undefined) {
        fail('a crypt card with plays')
        continue
    }

    const wantedKinds = new Set((card.type ?? '').split('/').map(type => KIND_OF_TYPE[type]))
    const kinds = new Set(def.plays.map(play => play.kind))
    for (const kind of kinds) {
        if (!wantedKinds.has(kind)) {
            fail(`has a ${kind} play but its type is '${card.type}'`)
        }
    }
    for (const kind of wantedKinds) {
        if (!kinds.has(kind)) {
            fail(`type '${card.type}' has no ${kind} play`)
        }
    }

    const declared = new Set(
        def.plays
            .flatMap(play => expandRequirement(play.requires))
            .filter(option => option.length > 0)
            .map(usageOptionKey),
    )
    const printed = new Set(
        parseCardUsage(card.text)
            .options.filter(option => option.length > 0)
            .map(usageOptionKey),
    )
    for (const key of declared) {
        if (!printed.has(key)) {
            fail(`requires ${key}, which the card text does not print`)
        }
    }
    for (const key of printed) {
        if (!declared.has(key)) {
            fail(`the card text prints ${key}, which no play requires`)
        }
    }
}

for (const failure of failures) {
    console.log(`FAIL ${failure}`)
}
console.log(`${CARD_DEFS.length} cards checked, ${failures.length} failures`)
process.exit(failures.length > 0 ? 1 : 0)
