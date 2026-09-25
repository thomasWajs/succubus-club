import { CURRENT_VERSION } from '@/shared/version.mjs'

export const latestChangelog = {
    version: CURRENT_VERSION,
    date: '2026-09-25',
    features: [
        'Free-Form Table Mode',
        'Access the main chat from a game room ( in addition to the room chat )',
        'Automatically delete lapsed availability slots.',
    ],
    bugfixes: [
        'Prevent role flickering in the game rooms',
        'Bugfixes and improvements on the Player Availability calendar',
        'Bot: Prevent double-play of the same action modifier',
    ],
}
