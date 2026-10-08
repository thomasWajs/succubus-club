/**
 * The personality of a utility bot: every number the scorer reads that is not a rule of the game.
 * Two bots with the same deck and different profiles are the A/B test of Phase 3. Only the
 * fields the planners already use are here: the rest comes with the step that needs it.
 */
export type BotProfile = {
    name: string
    // Temperature of the softmax pick among the scored options, 0 = always the best one
    noise: number
    // Only the starting point of how much a point of pool of a Methuselah is worth to me, by its place
    // in the ring: the table assessment moves it with what each deck and board show (its danger to me,
    // what it does for me), so it is neither fixed nor ordered prey > predator > others
    ringPrior: { prey: number; predator: number; other: number }
}

export const DEFAULT_PROFILE: BotProfile = {
    name: 'default',
    noise: 0,
    ringPrior: { prey: 1, predator: 0.5, other: 0.25 },
}
