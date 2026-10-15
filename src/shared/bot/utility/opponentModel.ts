import { MethuselahSnapshot } from '@/shared/bot/utility/snapshot.ts'
import { roleDensities } from '@/shared/bot/utility/capabilities.ts'
import { BotProfile } from '@/shared/bot/utility/profile.ts'
import { Role } from '@/shared/bot/utility/summaries.ts'

/**
 * What the bot believes of the deck of another Methuselah, from what is public: the disciplines and
 * titles of its minions in play and the roles of the cards on its ash heap. The share of its library
 * with each role is the base ( the neutral prior when nothing is shown ), the risks are the same
 * numbers read as the threats a neighbour poses, and the confidence says how much was shown.
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
}

export type OpponentModel = {
    densities: Partial<Record<Role, number>>
    risks: OpponentRisks
    // From 0 ( nothing shown ) to 1: each vampire in play halves the doubt, and so do four cards seen
    confidence: number
}

const CARDS_PER_VAMPIRE = 4

function share(densities: Partial<Record<Role, number>>, ...roles: Role[]): number {
    return Math.min(
        1,
        roles.reduce((total, role) => total + (densities[role] ?? 0), 0),
    )
}

export function opponentModelOf(snapshot: MethuselahSnapshot, profile: BotProfile): OpponentModel {
    const densities = roleDensities(
        snapshot.minions.map(minion => minion.disciplines),
        snapshot.seenRoles,
        profile.opponentPrior,
        snapshot.minions.map(minion => minion.title),
    )
    const seen = Object.values(snapshot.seenRoles).reduce((total, count) => total + count, 0)
    return {
        densities,
        risks: {
            stealth: share(densities, 'stealth'),
            bleedBonus: share(densities, 'bleedBonus'),
            combat: share(densities, 'strike', 'additionalStrike'),
            blocking: share(densities, 'intercept', 'wake', 'bounce'),
        },
        confidence: 1 - 0.5 ** (snapshot.minions.length + seen / CARDS_PER_VAMPIRE),
    }
}
