import { CURRENT_VERSION } from '@/shared/version.mjs'

export const latestChangelog = {
    version: CURRENT_VERSION,
    date: '2026-07-14',
    features: [
        'New Puppeteer mode : load 5 decks and manage each player in turn',
        'Flip a coin & roll a d6 ( 👉 Malkav cards )',
        'Quick move from Ash Heap ( 👉 Ashur Tablets )',
        'Visual notification when passing turn',
        'Configure a custom tabletop background',
        'Support VTESDeck import',
    ],
    bugfixes: ['Arrows are redrawn properly when switching focus mode on/off'],
}
