import { CURRENT_VERSION } from '@/shared/version.mjs'

export const latestChangelog = {
    version: CURRENT_VERSION,
    date: '2026-11-23',
    features: [
        'New theme : dark mode, which become the default. Legacy still exists as light mode. Can follow the system setting.',
        'Use svg icons instead of emoji characters',
        'Filter preco on actually playable ones',
        'Add a purple counter',
    ],
    bugfixes: [
        'Pinging a card no longer blur it',
        'In the logs, a counter on ally is now "life" instead of "blood"',
    ],
}
