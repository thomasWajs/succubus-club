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
    // What a vampire back from torpor is worth, on top of its drain, as a share of it: a full vampire
    // ( blood over capacity ) adds `bloodStay`, each card attached to it ( up to `equipmentMax` ) adds
    // `equipmentStay` ( flat, until the combat model of 3.4 prices weapons ). Draft numbers
    bloodStay: number
    equipmentStay: number
    equipmentMax: number
    // The share of its drain that a vampire back with no blood keeps: it must hunt before it acts
    hungryShare: number
}

// How the bot weighs its own turn, in pool ( turnPlan.ts, equity.ts ). Draft numbers
export type PlanWeights = {
    // A point of my own pool that I lose counts this many points of pool taken from my prey
    caution: number
    // What a minion kept unlocked is worth per turn against the actions that are not bleeds
    guard: number
    // What an action of a minion that is not a bleed, a hunt or a rescue is worth ( an equipment, a
    // recruit... ): a placeholder until step 3.5 values the cards themselves. The action card of the
    // hand is worth the best of this and of the roles it has in `cardActionByRole`: a recruit brings a
    // vampire in play, which is worth far more than the average action
    cardAction: number
    cardActionByRole: Partial<Record<Role, number>>
    // A point of blood, in pool
    bloodValue: number
    // What being ousted costs, in pool: the rest of the game. Also the worth of winning the game when my
    // oust of my prey is the last one
    oustedCost: number
    // A card of the hand that the plan spends on the turn of my predator ( a wake card, an unlock card )
    spentCard: number
    // A vampire that comes out of torpor: what it is worth on top of what it adds to my bleeds
    torporReturn: number
    // Above this chance that my prey bounces a bleed, the small bleeds go first ( bait ) instead of the big one
    baitAbove: number
    // The chance, of ousting my prey or of being ousted, from which the posture is a lunge or a defence
    postureAt: number
}

// How the bot counts what a Methuselah takes back from the blood bank each turn ( bloat.ts ). Draft numbers
export type BloatWeights = {
    // The turns it looks ahead: the blood that a Blood Doll carries to the pool within them counts as pool
    horizon: number
    // The share of what a Methuselah regains per turn that eats the bleeds on it: a drain that does not oust
    // only lasts above the income
    recapture: number
    // What the cards a Methuselah is believed to hold give when one is played: pool for a card that gains pool,
    // blood for one that puts blood on a vampire ( one master card is played per turn )
    poolPerCard: number
    bloodPerCard: number
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
    plan: PlanWeights
    bloat: BloatWeights
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
        density: {
            stealth: 0.08,
            bleedBonus: 0.06,
            wake: 0.04,
            bounce: 0.04,
            unlock: 0.03,
            poolGain: 0.02,
            sustain: 0.03,
        },
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
    helpers: {
        rescueChance: 0.3,
        bloodStay: 0.5,
        equipmentStay: 0.25,
        equipmentMax: 3,
        hungryShare: 0.3,
    },
    stakes: { dangerGain: 3, leaderGain: 1, usefulGain: 1, floor: 0.2 },
    plan: {
        caution: 1,
        guard: 0.3,
        cardAction: 1.5,
        cardActionByRole: { recruit: 5 },
        bloodValue: 0.5,
        oustedCost: 15,
        spentCard: 0.5,
        torporReturn: 2,
        baitAbove: 0.2,
        postureAt: 0.25,
    },
    bloat: { horizon: 3, recapture: 0.5, poolPerCard: 2, bloodPerCard: 1 },
    vpValue: 10,
    combatPool: 3,
}
