import { CURRENT_VERSION } from '@/shared/version.mjs'

export const latestChangelog = {
    version: CURRENT_VERSION,
    date: '2026-09-17',
    features: [
        'Social feature : Chat in the main lobby and the game room',
        'Social feature : Player Availability',
        '"Aids" renamed to a casual / competitive terminology',
    ],
    bugfixes: [
        'Improve vote casting overlapping when minions are too close',
        'Disable residual glow in casual mode',
        'Hide redundant separators in ActonUsageEditor',
    ],
}
