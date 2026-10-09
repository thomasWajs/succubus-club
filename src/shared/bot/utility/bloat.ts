import { AttackResult } from '@/shared/bot/utility/attack.ts'
import { MinionProfile } from '@/shared/bot/utility/minionProfile.ts'
import { BotProfile } from '@/shared/bot/utility/profile.ts'
import { MethuselahSnapshot } from '@/shared/bot/utility/snapshot.ts'
import { Role } from '@/shared/bot/utility/summaries.ts'

/**
 * Bloat: the counters a Methuselah takes back from the blood bank. Blood on its vampires ( hunting
 * grounds ) and, above all, pool ( the blood a Blood Doll carries over, the cards that gain pool ).
 * The master phase comes before the minion phase, so what a Methuselah regains does not move the
 * ouster of this turn nor of the lunge that follows ( the pool of each is what it is ). It changes what
 * a point is worth: a bleed on a Methuselah that regains `b` per turn only lasts above `b`, and the
 * blood a hunt puts on a vampire that carries a Doll is pool, a turn later.
 * What a Methuselah has in play is public, for the cards in hand it is exact for me and believed for
 * the others ( the roles it showed ).
 */

export type Bloat = {
    // Pool counters it regains per turn, on average
    pool: number
    // Blood counters it puts on its vampires per turn, on average
    blood: number
}

const NONE: Bloat = { pool: 0, blood: 0 }

// The best master card of my hand for what it gives back: one is played per turn
function ownCards(snapshot: MethuselahSnapshot, room: number, profile: BotProfile): Bloat {
    const worth = (card: Bloat) => card.pool + profile.plan.bloodValue * card.blood
    const richest = Math.max(
        0,
        ...snapshot.minions.filter(minion => minion.isVampire).map(minion => minion.blood),
    )
    let best = NONE
    for (const { summary } of snapshot.hand) {
        for (const play of summary.plays) {
            if (play.kind != 'master') {
                continue
            }
            // Any amount of the blood of one vampire: the blood is given up, so only what it is worth less
            // than a point of pool is gained
            const tapped = play.effects.some(effect => effect.type == 'bloodToPool') ? richest : 0
            const pool =
                tapped * Math.max(0, profile.plan.caution - profile.plan.bloodValue) +
                play.effects.reduce(
                    (total, effect) => total + (effect.type == 'gainPool' ? effect.amount : 0),
                    0,
                )
            const blood = play.effects.reduce(
                (total, effect) => total + (effect.type == 'gainBlood' ? effect.amount : 0),
                0,
            )
            const card = { pool, blood: room > 0 ? blood : 0 }
            if (worth(card) > worth(best)) {
                best = card
            }
        }
    }
    return best
}

// What the hand of another is believed to give back: the chance that it holds a card of the role, once
function believedCards(
    snapshot: MethuselahSnapshot,
    densities: Partial<Record<Role, number>>,
    profile: BotProfile,
): Bloat {
    const chance = (role: Role) => Math.min(1, (densities[role] ?? 0) * snapshot.handSize)
    return {
        pool: chance('poolGain') * profile.bloat.poolPerCard,
        blood: chance('sustain') * profile.bloat.bloodPerCard,
    }
}

export function bloatOf(
    snapshot: MethuselahSnapshot,
    densities: Partial<Record<Role, number>>,
    profile: BotProfile,
): Bloat {
    const abilities = snapshot.permanents.flatMap(permanent => permanent.abilities)
    const effects = abilities.flatMap(ability =>
        ability.effects.map(effect => ({ ability, effect })),
    )
    // The hunting grounds: blood on a vampire at the unlock phase, if one has room for it
    const room = snapshot.minions
        .filter(minion => minion.isVampire && minion.state != 'torpor')
        .reduce((total, minion) => total + Math.max(0, minion.capacity - minion.blood), 0)
    const grounds = effects.reduce(
        (total, { ability, effect }) =>
            total +
            (effect.type == 'gainBlood' && ability.windows.includes('unlockPhase') ?
                effect.amount
            :   0),
        0,
    )
    // Standing pool gains that cost no transfer
    const standing = effects.reduce(
        (total, { ability, effect }) =>
            total + (effect.type == 'gainPool' && ability.transfers == 0 ? effect.amount : 0),
        0,
    )
    // The Dolls: each turn the blood they carry over is bounded by what they can move and by the blood
    // the vampires hold, spread over the turns looked ahead, plus the blood that grounds put back
    const carriers = snapshot.minions.filter(minion => minion.bloodMove > 0)
    const carry = carriers.reduce((total, minion) => total + minion.bloodMove, 0)
    const stock = carriers.reduce((total, minion) => total + minion.blood, 0)
    const refill = Math.min(grounds, room)
    const converted = Math.min(carry, stock / profile.bloat.horizon + refill)

    const cards =
        snapshot.isMe ?
            ownCards(snapshot, room, profile)
        :   believedCards(snapshot, densities, profile)
    return { pool: converted + standing + cards.pool, blood: refill + cards.blood }
}

// What is left of a loss of `amount` per turn against an income of `income`: the income eats a share of it
export function lasting(amount: number, income: number, recapture: number): number {
    return amount - recapture * Math.min(amount, Math.max(0, income))
}

// The pool a Methuselah of `pool` loses in expectation, as what lasts: a loss that takes all of it is
// not eaten ( the Methuselah is ousted )
export function lastingLoss(
    result: AttackResult,
    pool: number,
    income: number,
    recapture: number,
): number {
    return result.outcomes.reduce(
        (total, outcome) =>
            total +
            outcome.p * (outcome.loss >= pool ? pool : lasting(outcome.loss, income, recapture)),
        0,
    )
}

// What `blood` counters on a vampire are worth, in pool: each is worth `bloodValue`, and those that a Doll
// carries to the pool within the horizon are worth a point of pool
function bloodWorth(profile: BotProfile, minion: MinionProfile, blood: number): number {
    const { plan, bloat } = profile
    const carried = Math.min(Math.max(0, blood), minion.bloodMove * bloat.horizon)
    return plan.bloodValue * blood + Math.max(0, plan.caution - plan.bloodValue) * carried
}

// What it is worth to the minion that its blood goes up by `delta` ( down when negative ), in pool
export function bloodChange(profile: BotProfile, minion: MinionProfile, delta: number): number {
    return (
        bloodWorth(profile, minion, minion.blood + delta) -
        bloodWorth(profile, minion, minion.blood)
    )
}
