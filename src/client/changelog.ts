import { CURRENT_VERSION } from '@/shared/version.mjs'

export const latestChangelog = {
    version: CURRENT_VERSION,
    date: '2026-07-20',
    features: [
        'From the log, browse unlocked cards during an unlock all',
        'A card dropped from hand outside of any play area is now considered played',
    ],
    bugfixes: [
        'Fix black rectangles replacing cards on lower-end hardware',
        'Prevent incorrect counters positionning',
        "Lot of subtle fixes on drag'n'drop",
    ],
}
