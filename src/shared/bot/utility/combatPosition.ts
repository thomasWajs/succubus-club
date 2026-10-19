import { BotProfile } from '@/shared/bot/utility/profile.ts'
import { MinionProfile } from '@/shared/bot/utility/minionProfile.ts'
import { MethuselahSnapshot, TableSnapshot } from '@/shared/bot/utility/snapshot.ts'
import { Densities } from '@/shared/bot/utility/defence.ts'
import { CombatSim, Side, SimCombatant } from '@/shared/bot/utility/combatModel.ts'
import {
    CardFacts,
    cardFactsOf,
    combatCards,
    combatOf,
    pressAlliesOf,
} from '@/shared/bot/utility/combatSetup.ts'
import { lossOf, lossWeightsOf } from '@/shared/bot/utility/combatValue.ts'
import { playOut, PolicyWeights } from '@/shared/bot/utility/combatPolicy.ts'
import {
    BelievedHand,
    believedCards,
    beliefKey,
    hashOf,
    mayHoldCombatCards,
    seededRandom,
} from '@/shared/bot/utility/combatBelief.ts'

/**
 * The position of a combat: what a fight between two minions
 * costs each side, in pool, on average, when both play it out with the default policy ( combatPolicy.ts ).
 * The cards of a side are its hand when it is known ( mine ), or hands drawn from what is believed of it
 * ( combatBelief.ts ), a few of them, each played out with the real rules of the combat. A fight is
 * judged the same way every time: the hands drawn come from a seed made of the fight itself.
 */

// A side's cards: the cards of a hand that is seen, or what a hand is believed to hold
export type Hand = { cards: CardFacts[] } | BelievedHand

export type Fighter = {
    profile: MinionProfile
    // The pool of its Methuselah
    pool: number
    hand: Hand
    strengthBonus?: number
    freeManeuvers?: number
    // The other minions of its Methuselah in play: an ally among them may burn life for a press
    allies?: MinionProfile[]
}

// What a side is expected to go through, over the hands drawn
export type SideForecast = {
    // Its loss in pool, by the weights of the profile ( combatValue.ts )
    loss: number
    // Blood lost ( negative when it gained some )
    blood: number
    // The chance that it goes to torpor, and that it burns
    torpor: number
    burned: number
    // The retainers it loses, and the cards it plays
    retainers: number
    cards: number
}

export type Forecast = {
    acting: SideForecast
    defending: SideForecast
    rounds: number
    // The hands played out
    samples: number
}

// What the fight costs a side, less the share of what it costs the other that counts for it
export function netLoss(forecast: Forecast, side: Side, profile: BotProfile): number {
    const opposite = side == 'acting' ? 'defending' : 'acting'
    return forecast[side].loss - profile.combat.credit * forecast[opposite].loss
}

export function policyWeightsOf(profile: BotProfile): PolicyWeights {
    return { loss: lossWeightsOf(profile), card: profile.combat.cardCost }
}

const isBelieved = (hand: Hand): hand is BelievedHand => 'size' in hand

// A pool that is more than any combat card costs changes nothing
const MOST_POOL_USED = 7

// What of the hand decides the fight: the combat cards the minion can play, or what a believed hand may hold
function handKey(fighter: Fighter): string {
    const { hand } = fighter
    return isBelieved(hand) ?
            beliefKey(fighter.profile, hand)
        :   combatCards(fighter.profile, hand.cards)
                .map(card => `${card.cardId}:${card.bloodCost}:${card.poolCost}`)
                .toSorted()
                .join(',')
}

function fighterKey(fighter: Fighter): string {
    const { profile } = fighter
    return JSON.stringify([
        profile.strength,
        profile.blood,
        profile.capacity,
        profile.worth,
        profile.state,
        profile.isVampire,
        profile.clan,
        profile.sect,
        profile.title,
        profile.disciplines,
        profile.attachedKits,
        profile.forbiddenPlays,
        Math.min(fighter.pool, MOST_POOL_USED),
        fighter.strengthBonus ?? 0,
        fighter.freeManeuvers ?? 0,
        pressAlliesOf(fighter.allies ?? []),
        handKey(fighter),
    ])
}

function setupOf(fighter: Fighter, profile: BotProfile, random: () => number) {
    const { hand } = fighter
    return {
        profile: fighter.profile,
        pool: Math.min(fighter.pool, MOST_POOL_USED),
        hand: isBelieved(hand) ? [] : hand.cards,
        extraCards:
            isBelieved(hand) ? believedCards(fighter.profile, hand, profile.combat, random) : [],
        strengthBonus: fighter.strengthBonus,
        freeManeuvers: fighter.freeManeuvers,
        allies: fighter.allies,
    }
}

// The hands drawn only matter when a hand may hold a card the minion plays
function handsToPlay(fighter: Fighter): boolean {
    return isBelieved(fighter.hand) && mayHoldCombatCards(fighter.profile, fighter.hand)
}

function sideOutcome(weights: PolicyWeights, combatant: SimCombatant): SideForecast {
    return {
        loss: lossOf(weights.loss, combatant),
        blood: combatant.startBlood - combatant.blood,
        torpor: combatant.state == 'torpor' ? 1 : 0,
        burned: combatant.state == 'burned' ? 1 : 0,
        retainers: combatant.attached.filter(card => card.retainer && card.life <= 0).length,
        cards: combatant.spent,
    }
}

function average(parts: SideForecast[]): SideForecast {
    const mean = (pick: (part: SideForecast) => number) =>
        parts.reduce((total, part) => total + pick(part), 0) / parts.length
    return {
        loss: mean(part => part.loss),
        blood: mean(part => part.blood),
        torpor: mean(part => part.torpor),
        burned: mean(part => part.burned),
        retainers: mean(part => part.retainers),
        cards: mean(part => part.cards),
    }
}

// What a fight is judged once: the same two minions in the same state give the same forecast
const CACHE = new Map<string, Forecast>()
const CACHE_LIMIT = 4000

/**
 * The forecast of the fight of an acting minion and a defending one. A side whose hand is believed has
 * `profile.combat.samples` hands played out.
 */
export function forecastFight(acting: Fighter, defending: Fighter, profile: BotProfile): Forecast {
    const weights = policyWeightsOf(profile)
    const { combat } = profile
    const key = JSON.stringify([
        fighterKey(acting),
        fighterKey(defending),
        weights,
        combat.samples,
        combat.strikeBonus,
    ])
    const known = CACHE.get(key)
    if (known) {
        return known
    }
    const samples = handsToPlay(acting) || handsToPlay(defending) ? combat.samples : 1
    const seed = hashOf(key)
    const ends: CombatSim[] = []
    for (let sample = 0; sample < samples; sample++) {
        const random = seededRandom(seed + sample)
        const sim = combatOf(setupOf(acting, profile, random), setupOf(defending, profile, random))
        ends.push(playOut(weights, sim).sim)
    }
    const forecast: Forecast = {
        acting: average(ends.map(end => sideOutcome(weights, end.acting))),
        defending: average(ends.map(end => sideOutcome(weights, end.defending))),
        rounds: ends.reduce((total, end) => total + end.round, 0) / ends.length,
        samples,
    }
    if (CACHE.size >= CACHE_LIMIT) {
        CACHE.clear()
    }
    CACHE.set(key, forecast)
    return forecast
}

/**
 * What the table shows of the fighters
 */

// My minion, with the hand I hold
export function myFighter(table: TableSnapshot, minion: MinionProfile): Fighter {
    const { me } = table
    return {
        profile: minion,
        pool: me.pool,
        hand: { cards: me.hand.map(({ card }) => cardFactsOf(card)) },
        allies: me.minions.filter(other => other.oid != minion.oid),
    }
}

// A minion of another Methuselah: the cards its hand is believed to hold
export function theirFighter(
    owner: MethuselahSnapshot,
    densities: Densities,
    minion: MinionProfile,
): Fighter {
    return {
        profile: minion,
        pool: owner.pool,
        hand: { size: owner.handSize, densities },
        allies: owner.minions.filter(other => other.oid != minion.oid),
    }
}

// The pool that the fight costs me when my minion acts and a minion of `owner` blocks it: what it costs mine,
// less the share of what it costs the other that counts for me ( negative when I win it: the readers keep the
// worst fight, and a fight won is no risk )
export function fightRisk(
    table: TableSnapshot,
    profile: BotProfile,
    mine: MinionProfile,
    owner: MethuselahSnapshot,
    densities: Densities,
    theirs: MinionProfile,
): number {
    const forecast = forecastFight(
        myFighter(table, mine),
        theirFighter(owner, densities, theirs),
        profile,
    )
    return netLoss(forecast, 'acting', profile)
}
