export const NB_BOTS = 4
export const BOT_NAME = 'Bot'
export const BOT_PERM_ID = 'Bot'

// Small pause between bot decisions to let the human player look at what happens
export const BOT_PAUSE_TIME = 125

/**
 * Flags for Conductor
 */
export const NEXT_PHASE = 'NEXT_PHASE' as const // Go forward to the next turn phase
export const NEXT_TURN = 'NEXT_TURN' as const // Go forward to the next turn ( end current turn )
