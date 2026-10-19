import {
    Actor,
    AdditionalStrikeGain,
    addEnvironmentalDamage,
    addStrikes,
    chooseStrike,
    CombatantBase,
    CombatBase,
    CombatHost,
    checkAddEnvironmentalDamage,
    checkAddStrikes,
    checkChooseStrike,
    checkGainBlood,
    checkGrapple,
    checkManeuver,
    checkPass,
    checkPreventDamage,
    checkPress,
    checkSetStrength,
    checkTakeStrengthBonus,
    gainBlood,
    grapple,
    markCardPlayed,
    newCombatFields,
    newStrike,
    opposingOf,
    passImpulse,
    playManeuver,
    playPress,
    PlayStrike,
    preventDamage,
    resolveDamage,
    setStrength,
    takeStrengthBonus,
} from '@/shared/state/combatRules.ts'
import {
    CombatCardEffect,
    combatConditionsHold,
    CombatPlayContext,
    combatPlayEffects,
} from '@/shared/cardImpl/catalog/combatPlay.ts'
import { CombatPlay } from '@/shared/cardImpl/catalog/types.ts'
import { CombatStep, Invalid, VALID, Validity } from '@/shared/types/state.ts'
import type { AttachedKit } from '@/shared/bot/utility/minionProfile.ts'

/**
 * The combat as a plain simulation. The rules are the
 * ones of the engine ( state/combatRules.ts, run here through a host that keeps blood, state and
 * retainers as numbers ), and a combat card is turned into moves by the same function ( the catalog's
 * combatPlay.ts ): what this file adds is the list of the moves a side may make and the application
 * of one, on a copy, so a planner can search. Perfect information and no randomness: the cards a side
 * holds are given. Not modelled, as in the engine: immunity to damage, steal equipment, destroy weapon,
 * damage prevention for retainers, diablerie.
 */

export type Side = 'acting' | 'defending'

// A strike at a retainer, or one that burns an equipment, names the card by its place among the cards
// attached to the opposing minion
export type SimStrike = PlayStrike & { retainer?: number; equipment?: number }

// A combat card of the hand, with the plays of it that the minion can make ( one for each way it can be
// declared )
export type SimCard = {
    cardId: string
    name: string
    bloodCost: number
    poolCost: number
    plays: CombatPlay[]
}

// An ally of the Methuselah at home that burns `burn` life to give the fighter a press ( Underbridge Stray ). `key` is
// the oid of the card: the referee and the model tell it from another ally by it
export type SimAlly = { key: string; name: string; life: number; burn: number; worth: number }

export type SimCombatant = CombatantBase & {
    side: Side
    name: string
    isVampire: boolean
    state: 'ready' | 'torpor' | 'burned'
    blood: number
    startBlood: number
    capacity: number
    // What losing it costs: the capacity of a vampire, what an ally cost and does
    worth: number
    // The pool of its Methuselah: a card costs some, and has to leave some
    pool: number
    // The cards attached to it ( equipment and retainers ), the life of a retainer drops when it is struck
    attached: AttachedKit[]
    // The combat cards of its hand still to play
    cards: SimCard[]
    spent: number
    // The allies of its Methuselah that can burn life for a press, and what the press has cost it in worth so far
    allies: SimAlly[]
    allyLost: number
}

export type CombatSim = CombatBase & {
    acting: SimCombatant
    defending: SimCombatant
    impulsePlayer: Side
    lastPlayedBy: Side | null
    // The combat is over
    closed: boolean
}

type Played = { card?: number }

// What a side does with the impulse: the combat card it plays ( its place in `cards` ) and the effect
export type Move = Played &
    (
        | { type: 'pass' }
        | { type: 'strike'; strike: SimStrike; additional?: AdditionalStrikeGain }
        | { type: 'maneuver'; strike?: SimStrike; weaponKey?: string; free?: boolean }
        | { type: 'press'; granted?: boolean; ally?: number }
        | { type: 'additionalStrike'; limited: boolean }
        | { type: 'grapple'; press: boolean; closeNextRound: boolean }
        | { type: 'gainBlood'; amount: number }
        | { type: 'strengthBonus' }
        | { type: 'strength'; amount: number }
        | { type: 'environmentalDamage'; amount: number }
        | { type: 'prevent'; amount: number; aggravated: boolean; sourceKey?: string }
    )

/**
 * Creation and copy
 */

export function newCombatSim(acting: SimCombatant, defending: SimCombatant): CombatSim {
    return { acting, defending, ...newCombatFields<Side>('acting'), closed: false }
}

function cloneCombatant(combatant: SimCombatant): SimCombatant {
    return {
        ...combatant,
        pendingDamage: { ...combatant.pendingDamage },
        attached: combatant.attached.map(card => ({ ...card })),
        allies: combatant.allies.map(ally => ({ ...ally })),
    }
}

// The cards, the strikes and the plays are never changed in place, so only what the rules change is copied
export function cloneSim(sim: CombatSim): CombatSim {
    return {
        ...sim,
        acting: cloneCombatant(sim.acting),
        defending: cloneCombatant(sim.defending),
        playedThisRound: { ...sim.playedThisRound },
        playedThisCombat: { ...sim.playedThisCombat },
        weaponManeuvers: [...sim.weaponManeuvers],
        attachedPreventions: [...sim.attachedPreventions],
        usedOnce: [...sim.usedOnce],
    }
}

/**
 * What the rules ask of the simulation
 */

// A retainer with no life left and an equipment burned are gone: they give nothing and are no target
export function isAlive(card: AttachedKit): boolean {
    return !card.burned && (!card.retainer || card.life > 0)
}

export function isBurnable(card: AttachedKit | undefined): card is AttachedKit {
    return !!card?.equipment && !card.burned
}

// A class, not an object of closures: a host is made for every move of every playout
class SimHost implements CombatHost {
    constructor(private readonly sim: CombatSim) {}

    name(combatant: SimCombatant): string {
        return combatant.name
    }

    owner(combatant: SimCombatant): Side {
        return combatant.side
    }

    ready(combatant: SimCombatant): boolean {
        return combatant.state == 'ready'
    }

    isVampire(combatant: SimCombatant): boolean {
        return combatant.isVampire
    }

    blood(combatant: SimCombatant): number {
        return combatant.blood
    }

    setBlood(combatant: SimCombatant, blood: number): void {
        combatant.blood = blood
    }

    capacity(combatant: SimCombatant): number {
        return combatant.capacity
    }

    environmentalFrom(source: SimCombatant): number {
        return source.attached.reduce(
            (total, card) => total + (isAlive(card) ? card.environmental : 0),
            0,
        )
    }

    sendToTorpor(combatant: SimCombatant): void {
        combatant.state = 'torpor'
    }

    burn(combatant: SimCombatant): void {
        combatant.state = 'burned'
    }

    retainerValidity(opposing: SimCombatant, strike: SimStrike): Validity {
        const card = strike.retainer === undefined ? null : opposing.attached[strike.retainer]
        return card?.retainer && card.life > 0 ?
                VALID
            :   Invalid('Not a retainer of the opposing minion')
    }

    hitRetainer(target: SimCombatant, strike: SimStrike, who: string, log: string[]): void {
        const card = strike.retainer === undefined ? null : target.attached[strike.retainer]
        if (!card?.retainer || card.life <= 0) {
            log.push(`${who} has no target: the retainer is gone`)
            return
        }
        const lost = Math.min(strike.damage, card.life)
        card.life -= lost
        log.push(`${who} deals ${lost} damage to ${card.name}`)
        if (card.life <= 0) {
            log.push(`${card.name} is burned`)
        }
    }

    equipmentValidity(opposing: SimCombatant, strike: SimStrike): Validity {
        const card =
            strike.equipment === undefined ? undefined : opposing.attached[strike.equipment]
        return isBurnable(card) ? VALID : Invalid('Not an equipment of the opposing minion')
    }

    burnEquipment(target: SimCombatant, strike: SimStrike, who: string, log: string[]): void {
        const card = strike.equipment === undefined ? undefined : target.attached[strike.equipment]
        if (!isBurnable(card)) {
            log.push(`${who} has no target: the equipment is gone`)
            return
        }
        card.burned = true
        log.push(`${who} burns ${card.name}`)
    }

    settleDamage(combatant: SimCombatant, log: string[]): void {
        resolveDamage(this, combatant, log)
    }

    close(): void {
        this.sim.closed = true
    }
}

function simHost(sim: CombatSim): CombatHost {
    return new SimHost(sim)
}

// The combatant as it would be once its pending damage, and `extra` more, were settled: a copy, the
// combat is left alone ( blood lost, torpor or burning, by the rules of the combat )
export function settled(
    sim: CombatSim,
    combatant: SimCombatant,
    extra: { regular: number; aggravated: number } = { regular: 0, aggravated: 0 },
): SimCombatant {
    const copy = {
        ...combatant,
        pendingDamage: {
            regular: combatant.pendingDamage.regular + extra.regular,
            aggravated: combatant.pendingDamage.aggravated + extra.aggravated,
        },
    }
    if (copy.pendingDamage.regular > 0 || copy.pendingDamage.aggravated > 0) {
        resolveDamage(simHost(sim), copy, [])
    }
    return copy
}

/**
 * The moves
 */

function handStrike(combatant: SimCombatant): SimStrike {
    return newStrike('Hand strike', { damage: combatant.strength, isHand: true })
}

function effectOf(effect: CombatCardEffect, card: number): Move {
    switch (effect.type) {
        case 'strike':
            return { type: 'strike', strike: effect.strike, additional: effect.additional, card }
        case 'additionalStrike':
            return { type: 'additionalStrike', limited: effect.limited, card }
        case 'grapple':
            return {
                type: 'grapple',
                press: effect.press,
                closeNextRound: effect.closeNextRound,
                card,
            }
        case 'gainBlood':
            return { type: 'gainBlood', amount: effect.amount, card }
        case 'maneuver':
            return { type: 'maneuver', strike: effect.strike, card }
        case 'press':
            return { type: 'press', card }
        case 'setStrength':
            return { type: 'strength', amount: effect.amount, card }
        case 'environmentalDamage':
            return { type: 'environmentalDamage', amount: effect.amount, card }
        case 'prevent':
            return {
                type: 'prevent',
                amount: effect.amount,
                aggravated: effect.aggravated,
                card,
            }
    }
}

function contextOf(sim: CombatSim, combatant: SimCombatant): CombatPlayContext {
    const opposing = opposingOf(sim, combatant)
    return {
        round: sim.round,
        step: sim.step,
        range: sim.range,
        playedThisRound: sim.playedThisRound[combatant.side] ?? [],
        playedThisCombat: sim.playedThisCombat[combatant.side] ?? [],
        strength: combatant.strength,
        limitedAdditionalGained: combatant.limitedAdditionalGained,
        opposingBloodLost: opposing.bloodLost,
        opposingIsVampire: opposing.isVampire,
    }
}

// What the combat cards of the hand can add at any step: the rules keep what fits the current one
function cardMoves(sim: CombatSim, combatant: SimCombatant): Move[] {
    const context = contextOf(sim, combatant)
    return combatant.cards.flatMap((card, index) =>
        combatant.blood >= card.bloodCost && combatant.pool > card.poolCost ?
            card.plays.flatMap(play =>
                combatConditionsHold(play, card.cardId, context) ?
                    combatPlayEffects(play, context).map(effect => effectOf(effect, index))
                :   [],
            )
        :   [],
    )
}

// What the cards in play add, with no card to play and nothing to pay: the strikes of the weapons ( and
// their maneuver ), the prevention, the strikes aimed at the retainers of the opposing minion and the
// ones that burn its equipment
function attachedMoves(sim: CombatSim, combatant: SimCombatant): Move[] {
    const opposing = opposingOf(sim, combatant)
    const retainers = opposing.attached.flatMap((card, index) =>
        card.retainer && card.life > 0 ? [{ card, index }] : [],
    )
    const equipment = opposing.attached.flatMap((card, index) =>
        isBurnable(card) ? [{ card, index }] : [],
    )
    const moves: Move[] = []
    if (combatant.freeManeuvers > 0) {
        moves.push({ type: 'maneuver', free: true })
    }
    combatant.attached.forEach((attached, index) => {
        if (!isAlive(attached)) {
            return
        }
        // The weapon and the prevention of a card are once per combat, whoever the bearer is
        const key = `${combatant.side}:${index}`
        if (attached.burnsEquipment) {
            for (const { card, index: target } of equipment) {
                moves.push({
                    type: 'strike',
                    strike: {
                        ...newStrike(`${attached.name} burns ${card.name}`),
                        equipment: target,
                    },
                })
            }
        }
        if (attached.dodge) {
            moves.push({
                type: 'strike',
                strike: { ...newStrike(`${attached.name} dodges`, { dodge: true }), onceKey: key },
            })
        }
        for (const amount of attached.prevention) {
            for (const aggravated of [false, true]) {
                moves.push({ type: 'prevent', amount, aggravated, sourceKey: key })
            }
        }
        for (const weapon of attached.strikes) {
            const strike = newStrike(attached.name, {
                damage: weapon.damage,
                ranged: weapon.ranged,
                aggravated: weapon.aggravated,
            })
            moves.push({ type: 'strike', strike })
            if (weapon.maneuver) {
                moves.push({ type: 'maneuver', strike, weaponKey: key })
            }
            for (const { card, index: retainer } of retainers) {
                moves.push({
                    type: 'strike',
                    strike: { ...strike, name: `${strike.name} at ${card.name}`, retainer },
                })
            }
        }
    })
    for (const { card, index: retainer } of retainers) {
        moves.push({
            type: 'strike',
            strike: {
                ...handStrike(combatant),
                name: `Hand strike at ${card.name}`,
                retainer,
            },
        })
    }
    return moves
}

function checkMove(host: CombatHost, sim: CombatSim, actor: Actor, move: Move): Validity {
    switch (move.type) {
        case 'pass':
            return checkPass(sim)
        case 'strike':
            return checkChooseStrike(host, sim, actor, move.strike, move.additional)
        case 'additionalStrike':
            return checkAddStrikes(host, sim, actor, { limited: move.limited })
        case 'grapple':
            return checkGrapple(host, sim, actor)
        case 'gainBlood':
            return checkGainBlood(host, sim, actor)
        case 'strengthBonus':
            return checkTakeStrengthBonus(host, sim, actor)
        case 'maneuver':
            return checkManeuver(host, sim, actor, move)
        case 'press':
            return checkPress(host, sim, actor, move.granted)
        case 'strength':
            return checkSetStrength(host, sim, actor)
        case 'environmentalDamage':
            return checkAddEnvironmentalDamage(host, sim, actor)
        case 'prevent':
            return checkPreventDamage(
                host,
                sim,
                actor,
                move.amount,
                move.aggravated,
                move.sourceKey,
            )
    }
}

// The moves of the side that holds the impulse, in the order the referee offers them: the hand strike,
// then what the rules allow in this window, then a pass ( the strike step cannot be passed )
export function legalMoves(sim: CombatSim): Move[] {
    if (sim.closed) {
        return []
    }
    const host = simHost(sim)
    const combatant = sim[sim.impulsePlayer]
    const actor = { combatant, name: combatant.name }
    const moves: Move[] = []
    if (sim.step == CombatStep.Strike) {
        moves.push({ type: 'strike', strike: handStrike(combatant) })
    }
    const candidates: Move[] = [
        { type: 'press', granted: true },
        ...combatant.allies.flatMap((ally, index): Move[] =>
            ally.life >= ally.burn ? [{ type: 'press', ally: index }] : [],
        ),
        { type: 'strengthBonus' },
        ...cardMoves(sim, combatant),
        ...attachedMoves(sim, combatant),
    ]
    for (const move of candidates) {
        if (checkMove(host, sim, actor, move).isValid) {
            moves.push(move)
        }
    }
    if (sim.step != CombatStep.Strike) {
        moves.push({ type: 'pass' })
    }
    return moves
}

// The ally burns the life of the press: it is lost in worth by the share of its life that goes, all of it when it burns
function burnForPress(combatant: SimCombatant, index: number): void {
    const ally = combatant.allies[index]
    combatant.allyLost += ally.worth * Math.min(1, ally.burn / ally.life)
    ally.life -= ally.burn
    if (ally.life <= 0) {
        combatant.allies = combatant.allies.filter((_, place) => place != index)
    }
}

// The card is played: it leaves the hand, the minion pays its blood and the Methuselah its pool
function playCard(sim: CombatSim, combatant: SimCombatant, index: number): void {
    const card = combatant.cards[index]
    combatant.cards = combatant.cards.filter((_, place) => place != index)
    combatant.blood -= card.bloodCost
    combatant.pool -= card.poolCost
    combatant.spent++
    markCardPlayed(sim, combatant.side, card.cardId)
}

function moveOf(host: CombatHost, sim: CombatSim, combatant: SimCombatant, move: Move): string[] {
    switch (move.type) {
        case 'pass':
            return passImpulse(host, sim)
        case 'strike':
            return chooseStrike(host, sim, combatant, move.strike, move.additional)
        case 'additionalStrike':
            return addStrikes(host, sim, combatant, { limited: move.limited })
        case 'grapple':
            return grapple(host, sim, combatant, move.press, move.closeNextRound)
        case 'gainBlood':
            return gainBlood(host, sim, combatant, move.amount)
        case 'strengthBonus':
            return takeStrengthBonus(host, sim, combatant)
        case 'maneuver':
            return playManeuver(host, sim, combatant, move)
        case 'press': {
            const log = playPress(host, sim, combatant, move.granted)
            if (move.ally !== undefined) {
                burnForPress(combatant, move.ally)
            }
            return log
        }
        case 'strength':
            return setStrength(host, sim, combatant, move.amount)
        case 'environmentalDamage':
            return addEnvironmentalDamage(host, sim, combatant, move.amount)
        case 'prevent':
            return preventDamage(host, sim, combatant, move.amount, move.aggravated, move.sourceKey)
    }
}

// The combat after the move, on a copy ( the move must be one of `legalMoves` ), and what happened
export function applyMove(sim: CombatSim, move: Move): { sim: CombatSim; log: string[] } {
    const next = cloneSim(sim)
    const combatant = next[next.impulsePlayer]
    if (move.card !== undefined) {
        playCard(next, combatant, move.card)
    }
    return { sim: next, log: moveOf(simHost(next), next, combatant, move) }
}

/**
 * Reading the result
 */

export type SideOutcome = {
    state: SimCombatant['state']
    blood: number
    // The blood it has lost or gained since the combat began
    bloodChange: number
    cardsPlayed: number
}

export type CombatOutcome = {
    acting: SideOutcome
    defending: SideOutcome
    rounds: number
    over: boolean
}

function sideOutcome(combatant: SimCombatant): SideOutcome {
    return {
        state: combatant.state,
        blood: combatant.blood,
        bloodChange: combatant.blood - combatant.startBlood,
        cardsPlayed: combatant.spent,
    }
}

export function outcomeOf(sim: CombatSim): CombatOutcome {
    return {
        acting: sideOutcome(sim.acting),
        defending: sideOutcome(sim.defending),
        rounds: sim.round,
        over: sim.closed,
    }
}
