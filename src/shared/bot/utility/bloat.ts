import { AttackResult } from '@/shared/bot/utility/attack.ts'
import { MinionProfile } from '@/shared/bot/utility/minionProfile.ts'
import { BotProfile } from '@/shared/bot/utility/profile.ts'
import { MethuselahSnapshot } from '@/shared/bot/utility/snapshot.ts'
import { PlaySummary, Role } from '@/shared/bot/utility/summaries.ts'

/**
 * Bloat: the counters a Methuselah takes back from the blood bank. Blood on its vampires ( hunting
 * grounds ) and, above all, pool ( the blood a Blood Doll carries over, the cards that gain pool ).
 * The master phase comes before the minion phase, so what a Methuselah regains does not move the
 * ouster of this turn nor of the lunge that follows ( the pool of each is what it is ). It changes what
 * a point is worth: a bleed on a Methuselah that regains `b` before its next turn only lasts above `b`,
 * and the blood a hunt puts on a vampire that carries a Doll is pool, a turn later.
 * It is a schedule over the turns looked ahead ( `bloat.horizon` ), not a flat income: a Doll moves what
 * the vampire holds and then stops, a card of the hand is played once ( one master card a turn, two with
 * a trifle ), and the blood a card taps only exists once a vampire holds it.
 * What a Methuselah has in play is public, for the cards in hand it is exact for me and believed for
 * the others ( the roles it showed ).
 */

export type Income = {
    // Pool counters regained
    pool: number
    // Blood counters put on its vampires
    blood: number
}

export type Bloat = {
    // What it takes back on each of the turns looked ahead: the first is its next master phase, the one
    // that follows the minion phase of everyone before it in the ring
    turns: Income[]
    // The same, per turn on average over the turns looked ahead
    pool: number
    blood: number
    // The blood of one vampire that the cards of its hand convert to pool within the turns looked ahead
    // ( Villein, Minion Tap ), Infinity when a card takes any amount: so much of the blood a vampire gets
    // is pool, soon
    tappable: number
}

const NONE: Income = { pool: 0, blood: 0 }

// What it takes back before its next master phase, in pool: what a bleed that does not oust it meets
export function takenBack(bloat: Bloat | undefined): number {
    return bloat?.turns[0]?.pool ?? 0
}

// What an income is worth, in pool
function worthOf(profile: BotProfile, income: Income): number {
    return income.pool + profile.plan.bloodValue * income.blood
}

type CardIncome = {
    income: Income
    // The blood the card takes from the richest vampire
    tapped: number
}

// The most blood a card takes from a vampire ( Infinity: any amount ), 0 when it takes none
function tapOf(plays: PlaySummary[]): number {
    return Math.max(
        0,
        ...plays.flatMap(play =>
            play.effects.flatMap(effect =>
                effect.type == 'bloodToPool' ? [effect.max ?? Infinity] : [],
            ),
        ),
    )
}

// What a card of the hand gives back when it is played, by its best master play: the blood taken from the
// richest vampire, above what it keeps, is given up, so only what it is worth less than a point of pool is gained
function cardIncome(
    plays: PlaySummary[],
    richest: number,
    room: number,
    profile: BotProfile,
): CardIncome {
    const { plan, bloat } = profile
    const available = Math.max(0, richest - bloat.keep)
    let best: CardIncome = { income: NONE, tapped: 0 }
    for (const play of plays) {
        const taps = play.effects.flatMap(effect => (effect.type == 'bloodToPool' ? [effect] : []))
        const tapped = Math.max(
            0,
            ...taps.map(effect => Math.min(available, effect.max ?? available)),
        )
        const pool =
            tapped * Math.max(0, plan.poolValue - plan.bloodValue) +
            play.effects.reduce(
                (total, effect) => total + (effect.type == 'gainPool' ? effect.amount : 0),
                0,
            )
        const blood = play.effects.reduce(
            (total, effect) => total + (effect.type == 'gainBlood' ? effect.amount : 0),
            0,
        )
        const income = { pool, blood: room > 0 ? blood : 0 }
        if (worthOf(profile, income) > worthOf(profile, best.income)) {
            best = { income, tapped }
        }
    }
    return best
}

// The master cards of my hand, as they are played over the turns looked ahead: the best one each turn, and a
// second one when a trifle is played ( it gives back the master phase action it uses ). What each gives back
// on the turn it is played, and the blood they can take from a vampire in all
function ownCards(
    snapshot: MethuselahSnapshot,
    room: number,
    profile: BotProfile,
): { turns: Income[]; tappable: number } {
    const { horizon } = profile.bloat
    const hand = snapshot.hand.flatMap(({ card, summary }) => {
        const plays = summary.plays.filter(play => play.kind == 'master')
        return plays.length > 0 ? [{ trifle: card.isTrifle, plays }] : []
    })
    let pending = hand
    let richest = Math.max(
        0,
        ...snapshot.minions.filter(minion => minion.isVampire).map(minion => minion.blood),
    )
    // Play the best of the cards `among` ( none when no one gives anything back )
    const playBest = (among: typeof hand) => {
        const options = among.map(card => ({
            card,
            ...cardIncome(card.plays, richest, room, profile),
        }))
        const best = options.reduce<(typeof options)[number] | null>(
            (one, other) =>
                !one || worthOf(profile, other.income) > worthOf(profile, one.income) ? other : one,
            null,
        )
        if (!best || worthOf(profile, best.income) <= 0) {
            return null
        }
        pending = pending.filter(card => card != best.card)
        richest -= best.tapped
        return best
    }
    const turns: Income[] = []
    for (let turn = 0; turn < horizon; turn++) {
        const first = playBest(pending)
        const second =
            first ?
                playBest(first.card.trifle ? pending : pending.filter(card => card.trifle))
            :   null
        turns.push({
            pool: (first?.income.pool ?? 0) + (second?.income.pool ?? 0),
            blood: (first?.income.blood ?? 0) + (second?.income.blood ?? 0),
        })
    }
    // Whatever the blood now: a card taps it once a vampire holds some
    const tappable = hand
        .map(card => tapOf(card.plays))
        .filter(cap => cap > 0)
        .toSorted((a, b) => b - a)
        .slice(0, 2 * horizon)
        .reduce((total, cap) => total + cap, 0)
    return { turns, tappable }
}

// What the hand of another is believed to give back: the chance that it holds a card of the role, once,
// on every turn ( its deck keeps supplying them, and nothing says when )
function believedCards(
    snapshot: MethuselahSnapshot,
    densities: Partial<Record<Role, number>>,
    profile: BotProfile,
): { turns: Income[]; tappable: number } {
    const chance = (role: Role) => Math.min(1, (densities[role] ?? 0) * snapshot.handSize)
    const income = {
        pool: chance('poolGain') * profile.bloat.poolPerCard,
        blood: chance('sustain') * profile.bloat.bloodPerCard,
    }
    return { turns: Array.from({ length: profile.bloat.horizon }, () => income), tappable: 0 }
}

export function bloatOf(
    snapshot: MethuselahSnapshot,
    densities: Partial<Record<Role, number>>,
    profile: BotProfile,
): Bloat {
    const { horizon } = profile.bloat
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
    // The Dolls: each turn they carry over what they can move of the blood the vampires hold, the blood that
    // the grounds put back first, until it runs out
    const carriers = snapshot.minions.filter(minion => minion.bloodMove > 0)
    const carry = carriers.reduce((total, minion) => total + minion.bloodMove, 0)
    const refill = Math.min(grounds, room)
    let stock = carriers.reduce(
        (total, minion) => total + Math.max(0, minion.blood - profile.bloat.keep),
        0,
    )
    const converted = Array.from({ length: horizon }, () => {
        stock += refill
        const moved = Math.min(carry, stock)
        stock -= moved
        return moved
    })

    const cards =
        snapshot.isMe ?
            ownCards(snapshot, room, profile)
        :   believedCards(snapshot, densities, profile)
    const turns = converted.map((moved, turn) => ({
        pool: moved + standing + cards.turns[turn].pool,
        blood: refill + cards.turns[turn].blood,
    }))
    const average = (pick: (income: Income) => number) =>
        turns.reduce((total, income) => total + pick(income), 0) / horizon
    return {
        turns,
        pool: average(income => income.pool),
        blood: average(income => income.blood),
        tappable: cards.tappable,
    }
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

// What `blood` counters on a vampire are worth, in pool: each is worth `bloodValue`, and those that reach
// the pool within the horizon, carried by a Doll or tapped by a card of the hand ( `bloat.tappable` ), are
// worth a point of pool. The blood the vampire keeps ( `bloat.keep` ) is never one of them
function bloodWorth(
    profile: BotProfile,
    minion: MinionProfile,
    blood: number,
    tappable: number,
): number {
    const { plan, bloat } = profile
    const carried = Math.min(
        Math.max(0, blood - bloat.keep),
        minion.bloodMove * bloat.horizon + tappable,
    )
    return plan.bloodValue * blood + Math.max(0, plan.poolValue - plan.bloodValue) * carried
}

// What it is worth to the minion that its blood goes up by `delta` ( down when negative ), in pool. `bloat`
// is the one of its Methuselah: the cards of a hand that tap blood make it pool sooner.
export function bloodChange(
    profile: BotProfile,
    minion: MinionProfile,
    delta: number,
    bloat?: Bloat,
): number {
    const tappable = minion.isVampire ? (bloat?.tappable ?? 0) : 0
    return (
        bloodWorth(profile, minion, minion.blood + delta, tappable) -
        bloodWorth(profile, minion, minion.blood, tappable)
    )
}
