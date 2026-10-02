import { CURRENT_VERSION } from '@/shared/version.mjs'

export const latestChangelog = {
    version: CURRENT_VERSION,
    date: '2026-10-02',
    features: [
        "Everything's stable enough to leave beta status !",
        'SCS: Prevent looking at an ousted player cards',
        'Change card depth behaviour',
    ],
    bugfixes: [
        'Improve roles & game rooms stability in the Lobby',
        'Add scrollbar in the lobby chat within a game room',
    ],
}
