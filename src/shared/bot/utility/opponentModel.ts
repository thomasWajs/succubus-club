import { MethuselahSnapshot } from '@/shared/bot/utility/snapshot.ts'
import { PlayerLedger } from '@/shared/bot/utility/ledger.ts'
import { roleDensities } from '@/shared/bot/utility/capabilities.ts'
import { BotProfile } from '@/shared/bot/utility/profile.ts'
import { Role } from '@/shared/bot/utility/summaries.ts'

/**
 * What the bot believes of the deck of another Methuselah, from what is public: the disciplines and
 * titles of its minions in play and the roles of the cards on its ash heap. The share of its library
 * with each role is the base ( the neutral prior when nothing is shown ), the risks are the same
 * numbers read as the threats a neighbour poses, and the confidence says how much was shown.
 * The ledger adds what it was seen doing: the size of its bleeds, how often it blocks and the kinds of
 * action it takes besides bleeds ( the mix, which sets what stopping one of them is worth ). Each is
 * the prior pulled toward what was observed, by as many observations as the count says, so that one
 * odd observation moves it little. What it played shows in the cards seen ( the ash heap ), which
 * is public state, so the ledger holds no card of the combat.
 */

export type OpponentRisks = {
    // The chance that an action of a minion of this Methuselah gets stealth cards
    stealth: number
    // Bleed points added by modifiers
    bleedBonus: number
    // Damage cards in its library ( strikes, additional strikes )
    combat: number
    // Cards that stop an action of mine: intercept, wake, bounce
    blocking: number
    // The pool one of its bleeds takes when no block stops it
    bleedSize: number
    // The share of the actions it could block that it tries to block
    blockRate: number
}

// The share of the actions it takes that are not bleeds, by kind
export type ActionMix = { hunt: number; political: number; other: number }

export type OpponentModel = {
    densities: Partial<Record<Role, number>>
    risks: OpponentRisks
    mix: ActionMix
    // What stopping one of its actions that is not a bleed is worth, as a multiple of the guard
    guardFactor: number
    // From 0 ( nothing shown ) to 1: each vampire in play halves the doubt, and so do four cards seen
    confidence: number
    // The observations behind bleedSize and blockRate
    observed: { bleeds: number; blockChances: number; actions: number }
}

const CARDS_PER_VAMPIRE = 4
// Observations that weigh as much as a vampire in play in the confidence
const OBSERVATIONS_PER_VAMPIRE = 8

// The prior pulled toward the mean of the observations, by their number against the weight of the prior
function pulled(prior: number, observed: number, count: number, weight: number): number {
    return (prior * weight + observed * count) / (weight + count)
}

function share(densities: Partial<Record<Role, number>>, ...roles: Role[]): number {
    return Math.min(
        1,
        roles.reduce((total, role) => total + (densities[role] ?? 0), 0),
    )
}

export function opponentModelOf(
    snapshot: MethuselahSnapshot,
    profile: BotProfile,
    observed?: PlayerLedger,
): OpponentModel {
    const densities = roleDensities(
        snapshot.minions.map(minion => minion.disciplines),
        snapshot.seenRoles,
        profile.opponentPrior,
        snapshot.minions.map(minion => minion.title),
    )
    const seen = Object.values(snapshot.seenRoles).reduce((total, count) => total + count, 0)
    const { behaviour } = profile.opponentPrior
    const amounts = observed?.bleedAmounts ?? []
    const chances = (observed?.blocksAttempted ?? 0) + (observed?.blocksDeclined ?? 0)
    const watched = amounts.length + chances
    const actions = (observed?.actionsDeclared ?? 0) - (observed?.bleedsDeclared ?? 0)
    const hunt = pulled(
        behaviour.mix.hunt,
        (observed?.huntsDeclared ?? 0) / Math.max(1, actions),
        actions,
        behaviour.weight,
    )
    const political = pulled(
        behaviour.mix.political,
        (observed?.politicalDeclared ?? 0) / Math.max(1, actions),
        actions,
        behaviour.weight,
    )
    const mix = { hunt, political, other: 1 - hunt - political }
    const kinds = profile.plan.guardKinds
    return {
        densities,
        mix,
        guardFactor: hunt * kinds.hunt + political * kinds.political + mix.other * kinds.other,
        risks: {
            stealth: share(densities, 'stealth'),
            bleedBonus: share(densities, 'bleedBonus'),
            combat: share(densities, 'strike', 'additionalStrike'),
            blocking: share(densities, 'intercept', 'wake', 'bounce'),
            bleedSize: pulled(
                behaviour.bleedSize,
                amounts.reduce((sum, amount) => sum + amount, 0) / Math.max(1, amounts.length),
                amounts.length,
                behaviour.weight,
            ),
            blockRate: pulled(
                behaviour.blockRate,
                (observed?.blocksAttempted ?? 0) / Math.max(1, chances),
                chances,
                behaviour.weight,
            ),
        },
        confidence:
            1 -
            0.5 **
                (snapshot.minions.length +
                    seen / CARDS_PER_VAMPIRE +
                    watched / OBSERVATIONS_PER_VAMPIRE),
        observed: { bleeds: amounts.length, blockChances: chances, actions },
    }
}
