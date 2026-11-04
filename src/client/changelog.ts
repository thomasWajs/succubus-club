import { CURRENT_VERSION } from '@/shared/version.mjs'

export const latestChangelog = {
    version: CURRENT_VERSION,
    date: '2026-11-04',
    features: [
        'Add "All In favor" and "All Against" in referendum interface',
        'From a multiplayer game, a button to start a new table',
        'Enable selection area within stacks',
    ],
    bugfixes: [
        'Improve text sharpness',
        'Improve play area rendering with non-grey tabletop background',
        'Use a more visible "The Edge" placeholder for various backgrounds',
        'Fix card reordering in a stack ( porto de santos )',
        'Fix embrace-like "become a vampire" floating action',
        'Maintain card spacing of dropped cards between regions',
    ],
}
