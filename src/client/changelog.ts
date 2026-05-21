import { CURRENT_VERSION } from '@/shared/version.mjs'

export const latestChangelog = {
    version: CURRENT_VERSION,
    date: '2026-05-21',
    features: [
        'Add orange counter to manage 2 sources of counters',
        'SCS has tighter rules in place on the allowed author of actions',
        'Hide play area of ousted players',
        'Textual decklists are now imported in-house, which avoids the krcg API roundtrip',
        'Suggest page reloading when the browser version is not up to date',
    ],
    bugfixes: [
        'Fix errors araising at end of games because of long history',
        'Correctly load multiple precon with the same name',
        'Fix edge-case bugs where the bot could not resume saved games',
    ],
}
