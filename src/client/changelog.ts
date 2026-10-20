import { CURRENT_VERSION } from '@/shared/version.mjs'

export const latestChangelog = {
    version: CURRENT_VERSION,
    date: '2026-10-20',
    features: [
        'In SCS, give control of a stack to another player ( 👉 Shroud of Decay )',
        'Shuffle a subset of stacks ( 👉 Anatole, Prophet of Gehenna )',
        'Always re-import a stored deck to avoid stale deck lists.',
    ],
    bugfixes: ['Retry card images that fail to load', 'Detection of multiple-type cards'],
}
