import { CURRENT_VERSION } from '@/shared/version.mjs'

export const latestChangelog = {
    version: CURRENT_VERSION,
    date: '2026-09-11',
    features: [
        'Play minion cards by dropping them on a minion ( actions, modifiers, reaction, combat )',
        'Action Declaration, with stealth/intercept helpers',
        'Usage Declaration ( Discipline, Target, X cost )',
        'Block Declaration',
        'Referendum interface with vote casting, tallying, and a last call',
        'Adjust a minion base attributes ( stealth, intercept, bleed, votes )',
        'Automatic cost payment ( experimental, opt-in )',
        'Chose/Reveal a secret ( 👉 Game of Malkav, Malkavian Prank, Malkavian Game, Cracking the Wall )',
        'More shortcuts on cards in the stack viewer',
        'Option to hide bleed auto target',
    ],
    bugfixes: ['Improve SCS stability', 'Hide "Unlock ALl" for spectators'],
}
