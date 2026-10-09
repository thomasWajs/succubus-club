import { Player } from '@/shared/model/Player.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { OUST_POOL_GAIN } from '@/shared/const/model.ts'
import { CardOid, PlayerOid } from '@/shared/types/model.ts'
import { BotProfile, DEFAULT_PROFILE } from '@/shared/bot/utility/profile.ts'
import { MinionProfile } from '@/shared/bot/utility/minionProfile.ts'
import {
    bounceTargetOf,
    everyone,
    MethuselahSnapshot,
    readyMinions,
    TableSnapshot,
    takeSnapshot,
    unlockedMinions,
} from '@/shared/bot/utility/snapshot.ts'
import {
    AttackResult,
    chanceOfLossAtLeast,
    DefenceSide,
    Dist,
    exact,
    mixResults,
    resolveAttack,
} from '@/shared/bot/utility/attack.ts'
import {
    attackersOf,
    attackKitOf,
    defenceOf,
    Densities,
    densitiesOf,
    toAttackers,
    unlockCardsOf,
} from '@/shared/bot/utility/defence.ts'
import { boardsOf, returnsOf } from '@/shared/bot/utility/rescue.ts'

/**
 * The table, read: what each Methuselah can do to me and what I can do to it, how my pool stands against
 * my predator, and what a point of each Methuselah's pool is worth to me ( .claude/docs/bot-ai-phase3.md,
 * sections 2, 3 and 3b ). A pure function of the player view: it reads nothing the player does not see.
 * Numbers are pool-equivalents per turn unless said otherwise.
 */

// What a Methuselah can take from me next turn, by axis. Only the axes the board can already show: the
// others ( ranged, combat ends, aggravated, torpor, block denial ) come with the combat model of step
// 3.4 and the risk vector of step 3.7.
export type Threat = {
    // Pool it bleeds me for ( only my predator can )
    bleed: number
    // What its minions would win in the fights my actions run into ( PROVISIONAL, see combatEdge )
    combat: number
    total: number
    // My predator only: the chance that its next turn ousts me, with my minions as they are
    chanceOfOust: number
    // My predator only: the pool of its bleeds I would bounce onto my prey ( 0 with two Methuselahs )
    bounced: number
}

export type Opportunity = {
    // Pool I can drain from it this turn, with the minions that are unlocked and the cards in my hand
    drain: number
    chanceOfOust: number
    // The pool of my bleeds it would bounce instead, and the chance that one is: it lands on `bounceTarget`
    // ( its own prey, never me ) and is worth that Methuselah's stake, not its own. Null with two left.
    bounced: number
    chanceOfBounce: number
    bounceTarget: PlayerOid | null
    // The share of my actions that its minions would block
    blockedShare: number
}

// How much a point of the pool of a Methuselah is worth to me, and why
export type Stake = {
    weight: number
    // Where it stands in the ring: the starting point
    ring: number
    // The share of my pool it takes per turn, less what its successor would take if it were ousted ( my predator )
    danger: number
    // How much stronger than the table it is
    leader: number
    // What it does for me: it hunts my predator, and keeps it busy
    useful: number
}

// A vampire in torpor, and what it is worth to me that it comes back ( rescue.ts )
export type RescueOpening = {
    owner: PlayerOid
    vampire: MinionProfile
    // The chance that a helper brings it back before its Methuselah plays, without me
    chance: number
    // What its return changes for me per turn, in pool: what its Methuselah drains from its prey, at the
    // weight that prey's pool has for me ( minus my own pool when it is me that is drained ). For one of
    // mine: what it adds to my drain on my prey
    value: number
}

export type Assessment = {
    table: TableSnapshot
    profile: BotProfile
    // What each Methuselah is believed to hold, by role
    densities: Record<PlayerOid, Densities>
    // What the minions and the cards in play are worth, in pool, plus the pool and the victory points
    power: Record<PlayerOid, number>
    threat: Record<PlayerOid, Threat>
    opportunity: Record<PlayerOid, Opportunity>
    stakes: Record<PlayerOid, Stake>
    // Every vampire in torpor at the table, mine included
    rescues: RescueOpening[]
    // The minions each other Methuselah is believed to keep unlocked on its turn, to defend itself against its
    // own predator: they do not bleed ( see reserveOf )
    held: Record<PlayerOid, CardOid[]>
    // The unlock cards each other Methuselah may hold: a minion that bled can unlock and still defend
    unlocks: Record<PlayerOid, Dist>
}

/**
 * Fights
 */

// How much of its blood a minion loses each round to the other, from -1 to 1 ( positive: the first is
// ahead ). PROVISIONAL: a first-order race of damage against blood, standing in for the combat model of
// step 3.4, which replaces it and takes ranges, maneuvers and cards into account.
export function combatEdge(first: MinionProfile, second: MinionProfile): number {
    const lossOf = (from: MinionProfile, to: MinionProfile) => {
        const damage = Math.max(from.strength, ...from.weaponStrikes.map(strike => strike.damage))
        const prevented = Math.max(0, ...to.prevention)
        return Math.min(1, Math.max(0, damage - prevented) / Math.max(1, to.blood + to.life))
    }
    return lossOf(first, second) - lossOf(second, first)
}

// How badly the minions of one side beat those of the other: for each of mine, the best fighter they
// have against it, averaged
function combatPressure(theirs: MinionProfile[], mine: MinionProfile[]): number {
    if (theirs.length == 0 || mine.length == 0) {
        return 0
    }
    return (
        mine.reduce(
            (total, minion) =>
                total + Math.max(0, ...theirs.map(fighter => combatEdge(fighter, minion))),
            0,
        ) / mine.length
    )
}

/**
 * The lunge of my predator
 */

type Context = {
    table: TableSnapshot
    profile: BotProfile
    densities: Record<PlayerOid, Densities>
    held: Record<PlayerOid, CardOid[]>
    unlocks: Record<PlayerOid, Dist>
}

type Forced = { oid: CardOid; returns: boolean }

// What `attacker` does on its next turn against a defence with the minions of `without` kept out of it:
// every board it may have ( the vampires an helper brings back from torpor ), mixed
function lunge(
    context: Context,
    attacker: MethuselahSnapshot,
    defence: DefenceSide,
    without: CardOid[],
    forced?: Forced,
): AttackResult {
    const parts = boardsOf(context.table, attacker, context.profile, forced).map(board => {
        const minions = board.minions.filter(minion => !without.includes(minion.oid))
        return {
            p: board.p,
            result: resolveAttack(
                toAttackers(minions),
                defence,
                attackKitOf(attacker, minions, context.densities[attacker.oid], context.profile),
            ),
        }
    })
    return parts.length == 1 ? parts[0].result : mixResults(parts)
}

// What `attacker` does on its next turn against a defence whose pool is `pool`. A Methuselah keeps some
// minions unlocked for its own defence ( context.held ), except when sending them all has a real chance
// to oust the defender. Each unlock card in its hand lets one of the minions it keeps bleed first and
// unlock after: it sends one more. It never bleeds twice with a minion, unlocked or not.
function attackFrom(
    context: Context,
    attacker: MethuselahSnapshot,
    defence: DefenceSide,
    pool: number,
    forced?: Forced,
): AttackResult {
    const all = lunge(context, attacker, defence, [], forced)
    const held = context.held[attacker.oid] ?? []
    if (
        held.length == 0 ||
        chanceOfLossAtLeast(all, pool) >= context.profile.opponentPrior.reserve.allIn
    ) {
        return all
    }
    const parts = (context.unlocks[attacker.oid] ?? exact(0)).map(cards => ({
        p: cards.p,
        result: lunge(
            context,
            attacker,
            defence,
            held.slice(0, Math.max(0, held.length - cards.value)),
            forced,
        ),
    }))
    return parts.length == 1 ? parts[0].result : mixResults(parts)
}

// What the bleeds of `attacker` on its next turn do against the minions of the target that stay unlocked
function bleedsOn(
    context: Context,
    attacker: MethuselahSnapshot,
    target: MethuselahSnapshot,
    options: { unlocked?: MinionProfile[]; pool?: number; forced?: Forced } = {},
): AttackResult {
    return attackFrom(
        context,
        attacker,
        defenceOf(context.table, target, 'bleed', context.densities[target.oid], options.unlocked),
        options.pool ?? target.pool,
        options.forced,
    )
}

// The minions a Methuselah keeps unlocked on its turn against its own predator, best blockers first. The
// ones that cannot bleed are kept for free. Each next one is kept while it is worth more at home than
// out bleeding: the pool it saves ( the lunge it stops, more than the pool it would drain, see
// `caution` ) plus its guard against the actions that are not bleeds; or, when an ouster is at hand,
// while it lowers that chance enough. Far from an ouster it still defends: a bleed that lands weakens
// it for the rest of the game. The predator is assumed to send everything ( no reserve of its own: the
// recursion stops here, which makes the reserve a little larger than it would be ).
function reserveOf(
    context: Context,
    owner: MethuselahSnapshot,
    preyUnlocked?: MinionProfile[],
): CardOid[] {
    const { table, densities, profile } = context
    const { caution, guard, action, tolerance, ousterGain } = profile.opponentPrior.reserve
    const ring = ringOf(table)
    const index = ring.indexOf(owner)
    const hunter = ring[(index - 1 + ring.length) % ring.length]
    const prey = ring[(index + 1) % ring.length]
    const canBleed = (minion: MinionProfile) => minion.blood > 0 && minion.bleed > 0
    const order = readyMinions(owner).toSorted(
        (a, b) =>
            Number(canBleed(a)) - Number(canBleed(b)) ||
            b.intercept.againstBleeds - a.intercept.againstBleeds ||
            a.bleed - b.bleed ||
            b.blood - a.blood,
    )
    const lungeWith = (kept: number) =>
        lunge(
            context,
            hunter,
            defenceOf(table, owner, 'bleed', densities[owner.oid], order.slice(0, kept)),
            [],
        )
    // What the minion would drain from its prey instead
    const drainOf = (minion: MinionProfile) =>
        resolveAttack(
            toAttackers([minion]),
            defenceOf(table, prey, 'bleed', densities[prey.oid], preyUnlocked),
            attackKitOf(owner, [minion], densities[owner.oid], profile),
        ).expectedLoss

    let kept = order.filter(minion => !canBleed(minion)).length
    let result = lungeWith(kept)
    while (kept < order.length) {
        const next = lungeWith(kept + 1)
        const saved = result.expectedLoss - next.expectedLoss
        const worth = saved * caution + guard >= Math.max(drainOf(order[kept]), action)
        const urgent =
            chanceOfLossAtLeast(result, owner.pool) > tolerance &&
            chanceOfLossAtLeast(result, owner.pool) - chanceOfLossAtLeast(next, owner.pool) >=
                ousterGain
        if (!worth && !urgent) {
            break
        }
        kept++
        result = next
    }
    return order.slice(0, kept).map(minion => minion.oid)
}

// The lunge of my predator on me, with `reserved` kept unlocked and my pool at `pool`
function lungeOnMe(
    assessment: Assessment,
    options: { pool?: number; reserved?: MinionProfile[] },
): AttackResult | null {
    const { table } = assessment
    if (!table.predator) {
        return null
    }
    const context = contextOf(assessment)
    // The predator sees the minions I keep unlocked: what it keeps home depends on them
    if (options.reserved) {
        context.held = {
            ...context.held,
            [table.predator.oid]: reserveOf(context, table.predator, options.reserved),
        }
    }
    return bleedsOn(context, table.predator, table.me, {
        unlocked: options.reserved,
        pool: options.pool ?? table.me.pool,
    })
}

// The chance that my predator ousts me on its next turn when I keep `reserved` unlocked ( by default
// the minions that are unlocked now ) and my pool is `pool`: the lunge distribution, summed up
export function chanceOfOust(
    assessment: Assessment,
    options: { pool?: number; reserved?: MinionProfile[] } = {},
): number {
    const result = lungeOnMe(assessment, options)
    return result ? chanceOfLossAtLeast(result, options.pool ?? assessment.table.me.pool) : 0
}

// The pool I expect to lose to the lunge of my predator ( never more than I have ). Far from an ouster
// it is still what a bleed costs me: it weakens me for the rest of the game.
export function expectedLossToLunge(
    assessment: Assessment,
    options: { pool?: number; reserved?: MinionProfile[] } = {},
): number {
    const result = lungeOnMe(assessment, options)
    const pool = options.pool ?? assessment.table.me.pool
    return (
        result?.outcomes.reduce(
            (total, outcome) => total + outcome.p * Math.min(outcome.loss, pool),
            0,
        ) ?? 0
    )
}

// Keeping the k best blockers unlocked ( the best intercept, then the most blood ): how the chance of
// being ousted next turn, and the pool I expect to lose, fall with each one
export function survivalCurve(
    assessment: Assessment,
    pool?: number,
): { reserved: number; chanceOfOust: number; expectedLoss: number }[] {
    const best = unlockedMinions(assessment.table.me).toSorted(
        (a, b) => b.intercept.againstBleeds - a.intercept.againstBleeds || b.blood - a.blood,
    )
    return Array.from({ length: best.length + 1 }, (_, reserved) => {
        const options = { pool, reserved: best.slice(0, reserved) }
        return {
            reserved,
            chanceOfOust: chanceOfOust(assessment, options),
            expectedLoss: expectedLossToLunge(assessment, options),
        }
    })
}

/**
 * My turn, then the lunge of my predator. I send `actors` at my prey ( they lock ) and keep `reserved`
 * unlocked. Ousting my prey gives me OUST_POOL_GAIN pool before my predator plays, so it bleeds against
 * the larger pool in that case: a prey low enough to be finished is worth locking more minions for, even
 * if my defence thins, because the pool gained swallows the attacks. With only my prey left, the oust
 * ends the game.
 */
export function outcomeOfTurn(
    assessment: Assessment,
    plan: { actors: MinionProfile[]; reserved: MinionProfile[] },
): { chanceToOust: number; chanceOfBeingOusted: number } {
    const { table, densities, profile } = assessment
    const { me, prey } = table
    const chanceToOust =
        prey ?
            chanceOfLossAtLeast(
                resolveAttack(
                    toAttackers(plan.actors),
                    defenceOf(table, prey, 'bleed', densities[prey.oid]),
                    attackKitOf(me, plan.actors, densities[me.oid], profile),
                ),
                prey.pool,
            )
        :   0
    const without = chanceOfOust(assessment, { pool: me.pool, reserved: plan.reserved })
    const withGain =
        table.others.length > 1 ?
            chanceOfOust(assessment, { pool: me.pool + OUST_POOL_GAIN, reserved: plan.reserved })
        :   0
    return {
        chanceToOust,
        chanceOfBeingOusted: chanceToOust * withGain + (1 - chanceToOust) * without,
    }
}

function contextOf(assessment: Assessment): Context {
    return {
        table: assessment.table,
        profile: assessment.profile,
        densities: assessment.densities,
        held: assessment.held,
        unlocks: assessment.unlocks,
    }
}

/**
 * Threat, opportunity, stakes
 */

function powerOf(snapshot: MethuselahSnapshot, profile: BotProfile): number {
    const minions = snapshot.minions.reduce(
        (total, minion) =>
            total + (minion.state == 'torpor' ? 0.5 : 1) * minion.capacity + minion.attached.length,
        0,
    )
    return (
        snapshot.pool +
        profile.vpValue * snapshot.victoryPoints +
        minions +
        snapshot.permanents.length
    )
}

// What `attacker` would take from me if it were next to me in the ring
function threatFrom(
    context: Context,
    attacker: MethuselahSnapshot,
    asPredator: boolean,
    exposure: number,
): Threat {
    const { me } = context.table
    const bleeds = asPredator ? bleedsOn(context, attacker, me) : null
    const bleed = bleeds?.expectedLoss ?? 0
    const combat =
        exposure *
        context.profile.combatPool *
        combatPressure(readyMinions(attacker), readyMinions(me))
    return {
        bleed,
        combat,
        total: bleed + combat,
        chanceOfOust: bleeds ? chanceOfLossAtLeast(bleeds, me.pool) : 0,
        bounced: bleeds?.expectedBounced ?? 0,
    }
}

// The ring from me: me, my prey, ..., my predator
function ringOf(table: TableSnapshot): MethuselahSnapshot[] {
    return [table.me, ...table.others]
}

export function assessSnapshot(table: TableSnapshot, profile: BotProfile): Assessment {
    const { me } = table
    const densities: Record<PlayerOid, Densities> = {}
    const power: Record<PlayerOid, number> = {}
    for (const methuselah of everyone(table)) {
        densities[methuselah.oid] = densitiesOf(methuselah, profile)
        power[methuselah.oid] = powerOf(methuselah, profile)
    }
    const context: Context = { table, profile, densities, held: {}, unlocks: {} }
    // Who keeps what back, read from the lunge of each one's predator before the rest uses it
    const held: Record<PlayerOid, CardOid[]> = {}
    const unlocks: Record<PlayerOid, Dist> = {}
    for (const other of table.others) {
        unlocks[other.oid] = unlockCardsOf(other, readyMinions(other), densities[other.oid])
    }
    context.unlocks = unlocks
    for (const other of table.others) {
        held[other.oid] = reserveOf(context, other)
    }
    context.held = held

    // What I can do now, and what I would do on my next turn ( the exposure to the fights of the others )
    const actors = attackersOf(me, 'now')
    const myKit = attackKitOf(me, actors, densities[me.oid], profile)

    const opportunity: Record<PlayerOid, Opportunity> = {}
    const exposure: Record<PlayerOid, number> = {}
    for (const other of table.others) {
        if (other.isPrey) {
            const result = resolveAttack(
                toAttackers(actors),
                defenceOf(table, other, 'bleed', densities[other.oid]),
                myKit,
            )
            opportunity[other.oid] = {
                drain: result.expectedLoss,
                chanceOfOust: chanceOfLossAtLeast(result, other.pool),
                bounced: result.expectedBounced,
                chanceOfBounce: result.chanceOfBounce,
                bounceTarget: bounceTargetOf(table, other)?.oid ?? null,
                blockedShare: result.blockedShare,
            }
        } else {
            opportunity[other.oid] = {
                drain: 0,
                chanceOfOust: 0,
                bounced: 0,
                chanceOfBounce: 0,
                bounceTarget: null,
                blockedShare: 0,
            }
        }
        // My actions run into the fights of the Methuselahs that can block them
        exposure[other.oid] =
            other.isPrey || other.isPredator ?
                attackFrom(
                    context,
                    me,
                    defenceOf(
                        table,
                        other,
                        other.isPrey ? 'bleed' : 'general',
                        densities[other.oid],
                    ),
                    other.pool,
                ).blockedShare
            :   0
    }

    const threat: Record<PlayerOid, Threat> = {}
    for (const other of table.others) {
        threat[other.oid] =
            other.isPrey || other.isPredator ?
                threatFrom(context, other, other.isPredator, exposure[other.oid])
            :   { bleed: 0, combat: 0, total: 0, chanceOfOust: 0, bounced: 0 }
    }

    const stakes = stakesOf(context, power, threat, exposure)
    const rescues = rescuesOf(context, stakes)
    return { table, profile, densities, power, threat, opportunity, stakes, rescues, held, unlocks }
}

// Every torpid vampire at the table: how likely a helper is to bring it back, and what it is worth to me
// that it is back. Its Methuselah drains its own prey more with it: good for me when that prey is
// someone whose pool I want low, bad when it is me. For one of mine, what it adds to my drain on my prey.
function rescuesOf(context: Context, stakes: Record<PlayerOid, Stake>): RescueOpening[] {
    const { table, profile } = context
    const ring = ringOf(table)
    return ring.flatMap((owner, index) => {
        const prey = ring[(index + 1) % ring.length]
        const weight = prey.isMe ? -1 : (stakes[prey.oid]?.weight ?? 0)
        return returnsOf(table, owner, profile).map(back => {
            const drain = (returns: boolean) =>
                bleedsOn(context, owner, prey, {
                    forced: { oid: back.minion.oid, returns },
                }).expectedLoss
            return {
                owner: owner.oid,
                vampire: back.minion,
                chance: back.chance,
                value: weight * (drain(true) - drain(false)),
            }
        })
    })
}

// The weight of each Methuselah's fate for me. Starts from where it stands in the ring and moves with
// how dangerous it is, how strong it is and what it does for me ( section 3 of the roadmap ).
function stakesOf(
    context: Context,
    power: Record<PlayerOid, number>,
    threat: Record<PlayerOid, Threat>,
    exposure: Record<PlayerOid, number>,
): Record<PlayerOid, Stake> {
    const { table, profile } = context
    const { me, predator } = table
    const ring = ringOf(table)
    const weights = profile.stakes
    const myPool = Math.max(1, me.pool)
    const everybody = everyone(table)
    const meanPower = everybody.reduce((total, one) => total + power[one.oid], 0) / everybody.length

    // The Methuselah that would be my predator, were mine ousted: the one that hunts it
    const successor =
        predator ? ring[(ring.indexOf(predator) - 1 + ring.length) % ring.length] : null
    const successorThreat =
        successor && successor != me ?
            threatFrom(context, successor, true, exposure[successor.oid] ?? 0).total
        :   0
    const stakes: Record<PlayerOid, Stake> = {}
    for (const other of table.others) {
        const place =
            other.isPrey ? profile.ringPrior.prey
            : other.isPredator ? profile.ringPrior.predator
            : profile.ringPrior.other
        const dangerShare = threat[other.oid].total / myPool
        const danger = other.isPredator ? dangerShare - successorThreat / myPool : dangerShare
        const leader = Math.max(0, power[other.oid] / meanPower - 1)

        // It hunts my predator: the better it holds it, the better for me
        const useful =
            predator && successor && successor != me && other == successor ?
                (threat[predator.oid].total / myPool) *
                Math.min(1, power[other.oid] / Math.max(1, power[predator.oid]))
            :   0

        const raw =
            place *
            (1 +
                weights.dangerGain * danger +
                weights.leaderGain * leader -
                weights.usefulGain * useful)
        stakes[other.oid] = {
            weight: Math.max(weights.floor * place, raw),
            ring: place,
            danger,
            leader,
            useful,
        }
    }
    return stakes
}

export function assess(
    gameState: GameState,
    me: Player,
    profile: BotProfile = DEFAULT_PROFILE,
): Assessment {
    return assessSnapshot(takeSnapshot(gameState, me), profile)
}
