import { Effect, PlaySummary, Role, waysUsableBy } from '@/shared/bot/utility/summaries.ts'
import { MinionProfile, profileMatches } from '@/shared/bot/utility/minionProfile.ts'
import {
    canBounce,
    MethuselahSnapshot,
    readyMinions,
    TableSnapshot,
} from '@/shared/bot/utility/snapshot.ts'
import { mayUseRole, roleDensities } from '@/shared/bot/utility/capabilities.ts'
import { BotProfile } from '@/shared/bot/utility/profile.ts'
import {
    Attacker,
    AttackKit,
    binomial,
    DefenceSide,
    Dist,
    exact,
} from '@/shared/bot/utility/attack.ts'

/**
 * The defence profile and the attack kit of a Methuselah ( .claude/docs/bot-ai-phase3.md, section 3b
 * points 5 and 6 ): what stands between its pool and the actions of another, and what its actions can
 * count on. For the player itself everything is exact, it knows its hand. For the others the board is
 * exact ( minions, equipment, permanents are public ) and the hand is an estimate from the cards that
 * the table showed ( capabilities.ts ).
 */

// Which intercept is read: against a bleed aimed at the Methuselah, or against any other action
export type InterceptKind = 'bleed' | 'general'

export type Densities = Partial<Record<Role, number>>

export function densitiesOf(snapshot: MethuselahSnapshot, profile: BotProfile): Densities {
    return roleDensities(
        snapshot.minions.map(minion => minion.disciplines),
        snapshot.seenRoles,
        profile.opponentPrior,
        snapshot.minions.map(minion => minion.title),
    )
}

function interceptOf(minion: MinionProfile, kind: InterceptKind): number {
    return kind == 'bleed' ? minion.intercept.againstBleeds : minion.intercept.general
}

function density(densities: Densities, role: Role): number {
    return densities[role] ?? 0
}

// The intercept that standing abilities of the permanents can add ( a card kept unlocked to be used )
function standingIntercept(snapshot: MethuselahSnapshot): number {
    return snapshot.permanents
        .filter(permanent => permanent.available)
        .flatMap(permanent => permanent.abilities)
        .flatMap(ability => ability.effects)
        .reduce((total, effect) => total + (effect.type == 'intercept' ? effect.amount : 0), 0)
}

// The wake cards of the hand ( they may also give intercept ), each with the minion that uses it. A card
// wakes a locked minion, which then blocks as a reactor of its own; with no locked minion left it gives
// its intercept to an unlocked one. Exact, the hand is known.
function ownWakeCards(
    snapshot: MethuselahSnapshot,
    unlocked: MinionProfile[],
    asleep: MinionProfile[],
    kind: InterceptKind,
): { reactors: number[]; wakers: number[] } {
    const reactors = unlocked.map(minion => interceptOf(minion, kind))
    const freeAsleep = [...asleep]
    const freeUnlocked = [...unlocked]
    const wakers: number[] = []
    // What the card adds to the minion that uses it, or null when the minion cannot play it
    const bonusFor = (plays: PlaySummary[], minion: MinionProfile): number | null => {
        const usable = plays.filter(play => waysUsableBy(play.ways, minion.disciplines).length > 0)
        if (usable.length == 0) {
            return null
        }
        return Math.max(
            ...usable.map(play =>
                play.effects.reduce(
                    (total, effect) =>
                        total + (effect.type == 'unlockAndBlock' ? effect.intercept : 0),
                    0,
                ),
            ),
        )
    }
    for (const { summary } of snapshot.hand) {
        const plays = summary.plays.filter(play => play.roles.includes('wake'))
        if (plays.length == 0) {
            continue
        }
        const candidates = (minions: MinionProfile[]) =>
            minions.flatMap(minion => {
                const bonus = bonusFor(plays, minion)
                return bonus === null ?
                        []
                    :   [{ minion, bonus, value: interceptOf(minion, kind) + bonus }]
            })
        const woken = candidates(freeAsleep).toSorted((a, b) => b.value - a.value)[0]
        if (woken) {
            wakers.push(woken.value)
            freeAsleep.splice(freeAsleep.indexOf(woken.minion), 1)
            continue
        }
        const boosted = candidates(freeUnlocked)
            .filter(candidate => candidate.bonus > 0)
            .toSorted((a, b) => b.value - a.value)[0]
        if (boosted) {
            reactors[unlocked.indexOf(boosted.minion)] += boosted.bonus
            freeUnlocked.splice(freeUnlocked.indexOf(boosted.minion), 1)
        }
    }
    return { reactors, wakers: wakers.toSorted((a, b) => b - a) }
}

// How many bounce cards the hand holds and how many of the unlocked minions can play one
function ownBounces(
    snapshot: MethuselahSnapshot,
    unlocked: MinionProfile[],
): { cards: number; bouncers: number } {
    const cards = snapshot.hand.filter(({ summary }) =>
        summary.plays.some(play => play.roles.includes('bounce')),
    )
    const bouncers = unlocked.filter(
        minion =>
            minion.isVampire &&
            cards.some(({ summary }) =>
                summary.plays.some(
                    play =>
                        play.roles.includes('bounce') &&
                        waysUsableBy(play.ways, minion.disciplines).length > 0,
                ),
            ),
    )
    return { cards: bouncers.length > 0 ? cards.length : 0, bouncers: bouncers.length }
}

/**
 * What stands between the pool of the Methuselah and an action aimed at it. `unlocked` is the set of
 * its minions that stay unlocked: by default the ones that are now, a planner passes the reserve it is
 * considering. The other ready minions can only be woken. With two Methuselahs left a bounce has nowhere
 * to send the bleed ( never back to the acting one ): no bounce card counts.
 */
export function defenceOf(
    table: TableSnapshot,
    snapshot: MethuselahSnapshot,
    kind: InterceptKind,
    densities: Densities,
    unlocked: MinionProfile[] = readyMinions(snapshot).filter(minion => minion.state == 'unlocked'),
): DefenceSide {
    const asleep = readyMinions(snapshot).filter(minion => !unlocked.includes(minion))
    const reactors = unlocked.map(minion => interceptOf(minion, kind))
    const standing = standingIntercept(snapshot)
    const live = canBounce(table)

    if (snapshot.isMe) {
        const bounces = ownBounces(snapshot, unlocked)
        const own = ownWakeCards(snapshot, unlocked, asleep, kind)
        return {
            reactors: own.reactors,
            wakers: own.wakers,
            wakeCards: exact(own.wakers.length),
            bounceCards: exact(live ? bounces.cards : 0),
            bouncers: live ? bounces.bouncers : 0,
            standingIntercept: standing,
        }
    }
    return {
        reactors,
        wakers: asleep.map(minion => interceptOf(minion, kind)).toSorted((a, b) => b - a),
        wakeCards: binomial(snapshot.handSize, density(densities, 'wake'), 2),
        bounceCards: live ? binomial(snapshot.handSize, density(densities, 'bounce'), 2) : exact(0),
        bouncers:
            live ?
                unlocked.filter(
                    minion =>
                        minion.isVampire && mayUseRole(minion.disciplines, 'bounce', minion.title),
                ).length
            :   0,
        standingIntercept: standing,
    }
}

// The minions that can bleed now ( unlocked ), or on the next turn of the Methuselah ( all the ready
// ones ). A vampire without blood must hunt first.
export function attackersOf(
    snapshot: MethuselahSnapshot,
    when: 'now' | 'nextTurn',
): MinionProfile[] {
    return readyMinions(snapshot).filter(
        minion => minion.blood > 0 && (when == 'nextTurn' || minion.state == 'unlocked'),
    )
}

export function toAttackers(minions: MinionProfile[]): Attacker[] {
    return minions.map(minion => ({ bleed: minion.bleed, stealth: 0 }))
}

// The stealth the permanents give for free, when one of the attackers can use it
function standingStealth(snapshot: MethuselahSnapshot, attackers: MinionProfile[]): number {
    return snapshot.permanents
        .filter(permanent => permanent.available)
        .flatMap(permanent => permanent.abilities)
        .filter(
            ability =>
                ability.activate == 'lockForAction' &&
                attackers.some(minion => !ability.minion || profileMatches(minion, ability.minion)),
        )
        .reduce(
            (total, ability) =>
                total +
                ability.effects.reduce(
                    (sum, effect) => sum + (effect.type == 'stealth' ? effect.amount : 0),
                    0,
                ),
            0,
        )
}

// What a hand of known cards adds, summed over the cards that one of the attackers can play
function ownPoints(
    snapshot: MethuselahSnapshot,
    attackers: MinionProfile[],
    role: Role,
    amountOf: (effect: Effect) => number,
): number {
    return snapshot.hand.reduce((total, { summary }) => {
        const best = summary.plays
            .filter(
                play =>
                    play.roles.includes(role) &&
                    attackers.some(
                        minion => waysUsableBy(play.ways, minion.disciplines).length > 0,
                    ),
            )
            .map(play => play.effects.reduce((sum, effect) => sum + amountOf(effect), 0))
        return total + Math.max(0, ...best)
    }, 0)
}

// A hand rarely holds more unlock cards that count ( the tail is folded into this )
const MOST_UNLOCK_CARDS = 2

/**
 * The cards that unlock a minion after it acted ( Freak Drive, Forced March... ): the minion that bled
 * stays a blocker for the turn of its Methuselah's predator, or does another action. They never give
 * a second bleed: a minion bleeds once a turn, even if it unlocks. Exact for the player itself, a
 * distribution for the others.
 */
export function unlockCardsOf(
    snapshot: MethuselahSnapshot,
    minions: MinionProfile[],
    densities: Densities,
): Dist {
    if (snapshot.isMe) {
        return exact(
            Math.min(
                MOST_UNLOCK_CARDS,
                ownPoints(snapshot, minions, 'unlock', effect =>
                    effect.type == 'unlockSelf' ? 1 : 0,
                ),
            ),
        )
    }
    return binomial(snapshot.handSize, density(densities, 'unlock'), MOST_UNLOCK_CARDS)
}

export function attackKitOf(
    snapshot: MethuselahSnapshot,
    attackers: MinionProfile[],
    densities: Densities,
    profile: BotProfile,
): AttackKit {
    const standing = standingStealth(snapshot, attackers)
    if (snapshot.isMe) {
        return {
            stealth: exact(
                ownPoints(snapshot, attackers, 'stealth', effect =>
                    effect.type == 'stealth' ? effect.amount : 0,
                ),
            ),
            bonus: exact(
                ownPoints(snapshot, attackers, 'bleedBonus', effect =>
                    effect.type == 'bleedBonus' ?
                        typeof effect.amount == 'number' ?
                            effect.amount
                        :   1
                    :   0,
                ),
            ),
            standingStealth: standing,
        }
    }
    const { stealthPerCard, bonusPerCard } = profile.opponentPrior
    return {
        stealth: binomial(snapshot.handSize, density(densities, 'stealth'), 3, stealthPerCard),
        bonus: binomial(snapshot.handSize, density(densities, 'bleedBonus'), 3, bonusPerCard),
        standingStealth: standing,
    }
}
