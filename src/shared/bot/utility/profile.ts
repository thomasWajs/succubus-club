import type { Role } from '@/shared/bot/utility/summaries.ts'

/**
 * The personality of a utility bot: every number the scorer reads that is not a rule of the game.
 * Two bots with the same deck and different profiles are the A/B test of Phase 3. Only the
 * fields the planners already use are here: the rest comes with the step that needs it.
 */

// What a Methuselah is assumed to hold when the table shows nothing ( the neutral prior of the risk model )
export type OpponentPrior = {
    // The share of the cards of a deck that have each role. The disciplines of the minions it has in
    // play and the cards it played raise it ( capabilities.ts )
    density: Partial<Record<Role, number>>
    // A library holds only so many cards that do something against the others: the shares of the
    // roles together are brought down to this, when the evidence makes them add up to more
    budget: number
    // Stealth points a stealth card adds to an action, bleed points a bleed modifier adds
    stealthPerCard: number
    bonusPerCard: number
    reserve: ReservePrior
}

// How many minions a Methuselah is assumed to keep unlocked at the end of its turn, to defend itself
// ( assessment.ts ). A pool that is far from zero is not a reason to stay open: a bleed that lands
// weakens it for the rest of the game, and a blocker also stops the strong action that is not a bleed
// ( an equipment, an ally ). It keeps a minion back while that is worth more than the bleed it would
// do instead. Draft numbers
export type ReservePrior = {
    // How many points of its own pool are worth a point it drains from its prey: what it loses defends
    // more than what it takes attacks ( it plays for the whole game )
    caution: number
    // What a minion kept unlocked is worth per turn against the actions that are not bleeds, in pool
    guard: number
    // What a minion does with its turn if it does not bleed ( hunts, equips ), in pool: a minion stays
    // home only when that is worth more than this and than the bleed it would do
    action: number
    // Above this chance of being ousted by its predator it keeps a minion that lowers it by at least
    // `ousterGain`, whatever the bleed that minion would do
    tolerance: number
    ousterGain: number
    // It sends everything when that has this chance to oust its prey: the pool and the victory point win
    // against any defence
    allIn: number
}

// How the stakes of a Methuselah move with what the table shows ( assessment.ts )
export type StakesWeights = {
    // The share of my pool it can take next turn counts this many times
    dangerGain: number
    // How much a Methuselah is stronger than the average of the table
    leaderGain: number
    // How much it is worth to me that it keeps my predator ( or my prey's prey ) busy
    usefulGain: number
    // The weight of a Methuselah never goes below this share of its ring prior
    floor: number
}

// How the Methuselahs that are neither the prey nor the predator of a Methuselah treat it ( rescue.ts )
export type HelpersPrior = {
    // The chance, each turn, that one of them with a minion able to pay rescues a given torpid vampire
    // of that Methuselah. Its prey and its predator never do. Draft number, the ledger replaces it in 3.7
    rescueChance: number
}

export type BotProfile = {
    name: string
    // Temperature of the softmax pick among the scored options, 0 = always the best one
    noise: number
    // Only the starting point of how much a point of pool of a Methuselah is worth to me, by its place
    // in the ring: the table assessment moves it with what each deck and board show (its danger to me,
    // what it does for me), so it is neither fixed nor ordered prey > predator > others
    ringPrior: { prey: number; predator: number; other: number }
    opponentPrior: OpponentPrior
    helpers: HelpersPrior
    stakes: StakesWeights
    // A victory point, in pool
    vpValue: number
    // The pool a combat that is fully lost on every axis costs per turn ( the combat axis of the threat )
    combatPool: number
}

export const DEFAULT_PROFILE: BotProfile = {
    name: 'default',
    noise: 0,
    ringPrior: { prey: 1, predator: 0.5, other: 0.25 },
    opponentPrior: {
        density: { stealth: 0.08, bleedBonus: 0.06, wake: 0.04, bounce: 0.04, unlock: 0.03 },
        budget: 0.7,
        stealthPerCard: 1,
        bonusPerCard: 1.5,
        reserve: {
            caution: 1,
            guard: 0.3,
            action: 1.5,
            tolerance: 0.1,
            ousterGain: 0.1,
            allIn: 0.25,
        },
    },
    helpers: { rescueChance: 0.3 },
    stakes: { dangerGain: 3, leaderGain: 1, usefulGain: 1, floor: 0.2 },
    vpValue: 10,
    combatPool: 3,
}
