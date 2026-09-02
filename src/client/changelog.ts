import { CURRENT_VERSION } from '@/shared/version.mjs'

export const latestChangelog = {
    version: CURRENT_VERSION,
    date: '2026-09-02',
    features: [
        'Migrated SCS to a new home with hopefully 100% uptime',
        'New judge role with full visibility over the cards',
        'New aid : display total vote/ballot count near player names.',
        'Keep minion cards visible in the uncontrolled region',
        'Refresh an iimported deck',
    ],
    bugfixes: [
        'Better stability when the lobby is crowded',
        "In pupeteer mode, deduplicate the opponent's hand in duel",
        'Lot of small bugfixes',
    ],
}
