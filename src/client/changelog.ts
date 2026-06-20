import { CURRENT_VERSION } from '@/shared/version.mjs'

export const latestChangelog = {
    version: CURRENT_VERSION,
    date: '2026-06-20',
    features: [
        'Save/Reload games in SCS ( with anti-cheat )',
        'Delete saved games. Alert on obsolete saved gamed.',
        'Suggest become a vampire on embraces-like',
        'Show/Hide hour in logs',
        'Detect and warn when WebGL is unavailable',
    ],
    bugfixes: [
        'Correctly determine next player after an oust',
        'Fix orange counter key binding display',
        'Fix a lot of corner-case invisible bug',
    ],
}
