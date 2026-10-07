import { Card, LibraryCard, Minion } from '@/shared/model/Card.ts'
import { endAction } from '@/shared/state/actionState.ts'
import { LibraryCardType } from '@/shared/const/model.ts'
import { Player } from '@/shared/model/Player.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { getHost, syncAttachedCards } from '@/shared/state/attachments.ts'
import { getMinionStrength } from '@/shared/cardImpl/catalog/attached.ts'
import { GRID_SIZE, TORPOR_ZONE_Y } from '@/shared/const/game.ts'
import {
    CombatantMinion,
    CombatRange,
    CombatState,
    CombatStep,
    CombatStrike,
    Invalid,
    VALID,
    Validity,
} from '@/shared/types/state.ts'

/**
 * Combat rules ( see .claude/docs/combat.md )
 *
 * A combat is a series of rounds, each made of seven steps. Most steps are a
 * "window" where the combatants, acting minion first, may play cards or effects
 * until both pass. The functions here are the transitions of that state machine.
 * They change the game state directly and are meant to be called from combat
 * mutations ( every client applies the same mutation, so the result is the same
 * everywhere ). Each returns the log lines describing what happened.
 *
 * Equipment and retainers are attached to their minion ( attachments.ts ), which they follow to
 * torpor and burn with. A weapon gives its bearer a strike ( and maybe a maneuver once per
 * combat ), a strike can be aimed at a retainer of the opposing minion.
 *
 * Not modelled yet: immunity to damage, destroy / steal equipment, damage prevention for
 * retainers, diablerie.
 */

// Strikes resolve by tiers : "combat ends" first, then first strikes, then the rest.
const TIER_COMBAT_ENDS = 0
const TIER_FIRST_STRIKE = 1
const TIER_NORMAL = 2

/**
 * Creation
 */

export function createCombatantMinion(minion: Minion): CombatantMinion {
    return {
        minion,
        strength: getMinionStrength(minion),
        strike: null,
        pendingDamage: { regular: 0, aggravated: 0 },
        bloodLost: 0,
        additionalStrikes: 0,
        limitedAdditionalGained: false,
        strikesInPair: true,
        pressesGranted: 0,
        strengthBonus: 0,
        freeManeuvers: 0,
    }
}

export function createCombatState(acting: Minion, defending: Minion): CombatState {
    return {
        acting: createCombatantMinion(acting),
        defending: createCombatantMinion(defending),
        round: 1,
        step: CombatStep.BeforeRange,
        range: CombatRange.Close,
        impulsePlayer: acting.controller,
        lastPlayedBy: null,
        pressed: false,
        resolvedStrikeTier: -1,
        strikePair: 0,
        handStrikesOnly: false,
        closeNextRound: false,
        playedThisRound: {},
        weaponManeuvers: [],
        isOver: false,
    }
}

// The combat is over. One that came from a block ( the action is still open ) goes on with the
// end of the block
export function closeCombat(gameState: GameState): void {
    gameState.combat = null
    if (gameState.action?.blockResolved) {
        finishBlock(gameState)
    }
}

// The block is resolved and its combat, if any, is over. The action ends, unless the blocker's
// controller can still play reaction cards made for this window ( bots only: it needs a reaction
// card in hand and a blocker still ready, so one that went to torpor cannot play any ): then the
// action stays open, and the window closes it ( ClosePostBlock ).
export function finishBlock(gameState: GameState): void {
    const blocker = gameState.action?.blockResolved
    if (!blocker) {
        return
    }
    const controller = blocker.controller
    const canPlay =
        controller.isBot &&
        !controller.isOusted &&
        blocker.isIn.ready &&
        controller.hand.cards.some(
            card => card instanceof LibraryCard && card.hasType(LibraryCardType.Reaction),
        )
    if (!canPlay) {
        endAction(gameState)
    }
}

// A minion enters combat with another one ( an action, not a block ): the combat starts at once
export function startCombat(gameState: GameState, acting: Minion, defending: Minion): void {
    gameState.combat = createCombatState(acting, defending)
}

export function createStrike(name: string, overrides: Partial<CombatStrike> = {}): CombatStrike {
    return {
        name,
        source: null,
        damage: 0,
        aggravated: false,
        ranged: false,
        dodge: false,
        isHand: false,
        undodgeable: false,
        combatEnds: false,
        firstStrike: false,
        stealBlood: 0,
        ...overrides,
    }
}

// The default strike: damage equal to the strength, at close range only
export function createHandStrike(combatant: CombatantMinion): CombatStrike {
    return createStrike('Hand strike', { damage: combatant.strength, isHand: true })
}

export function createDodgeStrike(source: Card | null = null): CombatStrike {
    return createStrike('Dodge', { source, dodge: true })
}

/**
 * Reading the state
 */

export function getCombatant(combat: CombatState, minion: Minion): CombatantMinion | null {
    if (combat.acting.minion == minion) {
        return combat.acting
    }
    return combat.defending.minion == minion ? combat.defending : null
}

export function getOpposingCombatant(combat: CombatState, combatant: CombatantMinion) {
    return combatant == combat.acting ? combat.defending : combat.acting
}

function getPlayer(combatant: CombatantMinion): Player {
    return combatant.minion.controller
}

export function getOpposingPlayer(combat: CombatState, player: Player): Player {
    return getPlayer(combat.acting) == player ?
            getPlayer(combat.defending)
        :   getPlayer(combat.acting)
}

export function isCombatReady(combatant: CombatantMinion): boolean {
    return combatant.minion.isIn.ready
}

function bothReady(combat: CombatState): boolean {
    return isCombatReady(combat.acting) && isCombatReady(combat.defending)
}

export function isStrikeEffective(strike: CombatStrike, range: CombatRange): boolean {
    return range == CombatRange.Close || strike.ranged || strike.dodge || strike.combatEnds
}

function getStrikeTier(strike: CombatStrike): number {
    if (strike.combatEnds) {
        return TIER_COMBAT_ENDS
    }
    return strike.firstStrike ? TIER_FIRST_STRIKE : TIER_NORMAL
}

function hasPendingDamage(combatant: CombatantMinion): boolean {
    return combatant.pendingDamage.regular > 0 || combatant.pendingDamage.aggravated > 0
}

/**
 * Validity of the moves. They all require the impulse, except ending the combat
 * by hand.
 */

function getMoveValidity(gameState: GameState, step: CombatStep, minion: Minion): Validity {
    const combat = gameState.combat
    if (!combat) {
        return Invalid('No combat in progress')
    }
    if (combat.step != step) {
        return Invalid(`Not possible during the ${combat.step} step`)
    }
    const combatant = getCombatant(combat, minion)
    if (!combatant) {
        return Invalid(`${minion.name} is not in this combat`)
    }
    if (getPlayer(combatant) != combat.impulsePlayer) {
        return Invalid(`${minion.name} does not have the impulse`)
    }
    return VALID
}

export function canPass(gameState: GameState): Validity {
    const combat = gameState.combat
    if (!combat) {
        return Invalid('No combat in progress')
    }
    if (combat.step == CombatStep.Strike) {
        return Invalid('A strike must be chosen')
    }
    return VALID
}

// A strike aimed at a retainer needs a retainer attached to the opposing minion
function checkStrikeTarget(
    combat: CombatState,
    combatant: CombatantMinion | null,
    strike: CombatStrike,
): Validity {
    if (!strike.retainer) {
        return VALID
    }
    const opposing = combatant && getOpposingCombatant(combat, combatant)
    return opposing && getHost(strike.retainer) == opposing.minion ?
            VALID
        :   Invalid(`${strike.retainer.name} is not a retainer of the opposing minion`)
}

// The maneuver of a weapon ( `weapon` ) comes with its strike, and is given once per combat
export function canManeuver(
    gameState: GameState,
    minion: Minion,
    strike?: CombatStrike,
    weapon?: Card,
    free?: boolean,
): Validity {
    const validity = getMoveValidity(gameState, CombatStep.DetermineRange, minion)
    const combat = gameState.combat
    if (!validity.isValid || !combat) {
        return validity
    }
    if (combat.lastPlayedBy == minion.controller) {
        return Invalid('A minion cannot play two maneuvers in a row')
    }
    const combatant = getCombatant(combat, minion)
    if (free && !combatant?.freeManeuvers) {
        return Invalid('The minion has no maneuver to play for free')
    }
    if (strike && combatant?.strike) {
        return Invalid('The strike is already chosen')
    }
    if (strike && combat.handStrikesOnly && !strike.isHand) {
        return Invalid('Only hand strikes can be used this round')
    }
    if (weapon && combat.weaponManeuvers.includes(weapon.oid)) {
        return Invalid(`${weapon.name} already gave its maneuver in this combat`)
    }
    return strike ? checkStrikeTarget(combat, combatant, strike) : VALID
}

// An additional strike can come with the strike chosen ( a strike card that gives one )
export type AdditionalStrikeGain = { limited: boolean }

function canGainAdditionalStrike(
    combatant: CombatantMinion | null,
    gain: AdditionalStrikeGain,
): Validity {
    return gain.limited && combatant?.limitedAdditionalGained ?
            Invalid('Only one limited additional strike per round')
        :   VALID
}

export function canChooseStrike(
    gameState: GameState,
    minion: Minion,
    strike?: CombatStrike,
    additional?: AdditionalStrikeGain,
): Validity {
    const validity = getMoveValidity(gameState, CombatStep.Strike, minion)
    const combat = gameState.combat
    if (!validity.isValid || !combat) {
        return validity
    }
    const combatant = getCombatant(combat, minion)
    if (combatant?.strike) {
        return Invalid('The strike is already chosen')
    }
    if (!combatant?.strikesInPair) {
        return Invalid('No strike to choose in this pair')
    }
    if (strike && combat.handStrikesOnly && !strike.isHand) {
        return Invalid('Only hand strikes can be used this round')
    }
    const target = strike ? checkStrikeTarget(combat, combatant, strike) : VALID
    if (!target.isValid) {
        return target
    }
    return additional ? canGainAdditionalStrike(combatant, additional) : VALID
}

// Cards played in the window after a pair of strikes
export function canAddStrikes(
    gameState: GameState,
    minion: Minion,
    gain: AdditionalStrikeGain,
): Validity {
    const combat = gameState.combat
    if (!combat) {
        return Invalid('No combat in progress')
    }
    const validity = getMoveValidity(gameState, CombatStep.AdditionalStrikes, minion)
    return validity.isValid ? canGainAdditionalStrike(getCombatant(combat, minion), gain) : validity
}

// A window of the steps before the strikes: the card says which one it is played in
export function canSetStrength(gameState: GameState, minion: Minion): Validity {
    const combat = gameState.combat
    if (!combat) {
        return Invalid('No combat in progress')
    }
    if (combat.step != CombatStep.BeforeRange && combat.step != CombatStep.BeforeStrikes) {
        return Invalid(`The strength cannot be changed during the ${combat.step} step`)
    }
    const combatant = getCombatant(combat, minion)
    if (!combatant) {
        return Invalid(`${minion.name} is not in this combat`)
    }
    return getPlayer(combatant) == combat.impulsePlayer ?
            VALID
        :   Invalid(`${minion.name} does not have the impulse`)
}

// A press: the one a card gives ( granted ) is not played from the hand
export function canPress(gameState: GameState, minion: Minion, granted = false): Validity {
    const validity = getMoveValidity(gameState, CombatStep.Press, minion)
    const combat = gameState.combat
    if (!validity.isValid || !combat) {
        return validity
    }
    if (combat.lastPlayedBy == minion.controller) {
        return Invalid('A minion cannot play two presses in a row')
    }
    if (granted && !getCombatant(combat, minion)?.pressesGranted) {
        return Invalid('No press to use')
    }
    return VALID
}

// The grapple: before the strikes are chosen, at close range
export function canGrapple(gameState: GameState, minion: Minion): Validity {
    const validity = getMoveValidity(gameState, CombatStep.BeforeStrikes, minion)
    const combat = gameState.combat
    if (!validity.isValid || !combat) {
        return validity
    }
    if (combat.range != CombatRange.Close) {
        return Invalid('A grapple needs close range')
    }
    return VALID
}

// Blood gained at the end of the round ( Taste of Vitae )
export function canGainBlood(gameState: GameState, minion: Minion): Validity {
    const validity = getMoveValidity(gameState, CombatStep.EndOfRound, minion)
    const combat = gameState.combat
    if (!validity.isValid || !combat) {
        return validity
    }
    const combatant = getCombatant(combat, minion)
    if (!combatant || !isCombatReady(combatant) || !minion.isVampire()) {
        return Invalid('Only a ready vampire gains blood')
    }
    return VALID
}

// The strength bonus a card gave for the first round ( Show of Force ), taken before the range
export function canTakeStrengthBonus(gameState: GameState, minion: Minion): Validity {
    const combat = gameState.combat
    if (!combat || combat.round != 1) {
        return Invalid('The bonus is for the first round')
    }
    const validity = getMoveValidity(gameState, CombatStep.BeforeRange, minion)
    if (!validity.isValid) {
        return validity
    }
    return getCombatant(combat, minion)?.strengthBonus ? VALID : Invalid('No bonus to take')
}

export function canPreventDamage(
    gameState: GameState,
    minion: Minion,
    amount: number,
    aggravated: boolean,
): Validity {
    const validity = getMoveValidity(gameState, CombatStep.DamageResolution, minion)
    const combat = gameState.combat
    if (!validity.isValid || !combat) {
        return validity
    }
    const pending = getCombatant(combat, minion)?.pendingDamage
    const available = aggravated ? pending?.aggravated : pending?.regular
    if (amount <= 0 || !available || amount > available) {
        return Invalid('Not enough damage to prevent')
    }
    return VALID
}

export function canApplyDamage(gameState: GameState, minion: Minion): Validity {
    const validity = getMoveValidity(gameState, CombatStep.DamageResolution, minion)
    const combat = gameState.combat
    if (!validity.isValid || !combat) {
        return validity
    }
    const combatant = getCombatant(combat, minion)
    return combatant && hasPendingDamage(combatant) ? VALID : Invalid('No damage to apply')
}

/**
 * Steps
 */

function enterStep(combat: CombatState, step: CombatStep): void {
    combat.step = step
    combat.lastPlayedBy = null
    combat.impulsePlayer = getPlayer(combat.acting)
}

// Minions that still have to choose their strike, acting minion first. A strike
// can already be set: a maneuver from a strike card or a weapon chooses it too.
function advanceStrikeChoices(gameState: GameState, combat: CombatState, log: string[]): void {
    const next = [combat.acting, combat.defending].find(
        combatant => !combatant.strike && combatant.strikesInPair,
    )
    if (next) {
        combat.impulsePlayer = getPlayer(next)
    } else {
        resolveStrikeTier(gameState, combat, log)
    }
}

function closeWindow(gameState: GameState, combat: CombatState, log: string[]): void {
    switch (combat.step) {
        case CombatStep.BeforeRange:
            // A grapple of the last round: this round is at close range, nobody can maneuver
            if (combat.closeNextRound) {
                combat.closeNextRound = false
                enterStep(combat, CombatStep.BeforeStrikes)
            } else {
                enterStep(combat, CombatStep.DetermineRange)
            }
            break
        case CombatStep.DetermineRange:
            enterStep(combat, CombatStep.BeforeStrikes)
            break
        case CombatStep.BeforeStrikes:
            enterStep(combat, CombatStep.Strike)
            advanceStrikeChoices(gameState, combat, log)
            break
        case CombatStep.DamageResolution:
            finishDamageResolution(gameState, combat, log)
            break
        case CombatStep.AdditionalStrikes:
            if (combat.acting.additionalStrikes > 0 || combat.defending.additionalStrikes > 0) {
                startAdditionalPair(gameState, combat, log)
            } else {
                enterStep(combat, CombatStep.Press)
            }
            break
        case CombatStep.Press:
            enterStep(combat, CombatStep.EndOfRound)
            break
        case CombatStep.EndOfRound:
            finishRound(gameState, combat, log)
            break
        case CombatStep.Strike:
            throw new Error('The strike step has no window to close')
    }
}

function finishRound(gameState: GameState, combat: CombatState, log: string[]): void {
    if (combat.isOver || !combat.pressed || !bothReady(combat)) {
        closeCombat(gameState)
        log.push('Combat ends')
        return
    }

    combat.round++
    combat.range = CombatRange.Close
    combat.pressed = false
    combat.resolvedStrikeTier = -1
    combat.strikePair = 0
    combat.handStrikesOnly = false
    combat.playedThisRound = {}
    for (const combatant of [combat.acting, combat.defending]) {
        combatant.strike = null
        combatant.strikesInPair = true
        combatant.additionalStrikes = 0
        combatant.limitedAdditionalGained = false
        combatant.pressesGranted = 0
        combatant.strengthBonus = 0
        combatant.bloodLost = 0
    }
    enterStep(combat, CombatStep.BeforeRange)
    log.push(`Round ${combat.round}`)
}

// After a pair of strikes ( or when the combat ends early ): the window to gain additional
// strikes, or the end of round
function leaveStrikes(combat: CombatState): void {
    if (!combat.isOver && bothReady(combat)) {
        enterStep(combat, CombatStep.AdditionalStrikes)
    } else {
        enterStep(combat, CombatStep.EndOfRound)
    }
}

// The minions with an additional strike choose a strike in a new pair, the others sit it out
function startAdditionalPair(gameState: GameState, combat: CombatState, log: string[]): void {
    combat.strikePair++
    combat.resolvedStrikeTier = -1
    for (const combatant of [combat.acting, combat.defending]) {
        combatant.strike = null
        combatant.strikesInPair = combatant.additionalStrikes > 0
        if (combatant.strikesInPair) {
            combatant.additionalStrikes--
        }
    }
    log.push('Additional strikes')
    enterStep(combat, CombatStep.Strike)
    advanceStrikeChoices(gameState, combat, log)
}

/**
 * Strike resolution
 */

function resolveStrikeTier(gameState: GameState, combat: CombatState, log: string[]): void {
    // A combatant is no longer ready: the strikes left are lost
    if (combat.isOver) {
        leaveStrikes(combat)
        return
    }

    const strikers = [combat.acting, combat.defending].filter(
        (combatant): combatant is CombatantMinion & { strike: CombatStrike } =>
            !!combatant.strike && getStrikeTier(combatant.strike) > combat.resolvedStrikeTier,
    )
    if (strikers.length == 0) {
        leaveStrikes(combat)
        return
    }

    const tier = Math.min(...strikers.map(combatant => getStrikeTier(combatant.strike)))
    combat.resolvedStrikeTier = tier

    if (tier == TIER_COMBAT_ENDS) {
        // Resolves before anything else and cannot be dodged
        log.push(`${combat.acting.minion.name} and ${combat.defending.minion.name}: combat ends`)
        combat.isOver = true
        leaveStrikes(combat)
        return
    }

    const resolving = strikers.filter(combatant => getStrikeTier(combatant.strike) == tier)
    for (const striker of resolving) {
        resolveStrike(gameState, combat, striker, striker.strike, log)
    }
    enterDamageResolution(gameState, combat, log)
}

// The damage of a strike aimed at a retainer burns its life counters at once ( no damage
// prevention for retainers yet ), and the retainer is burned when none is left
function hitRetainer(
    gameState: GameState,
    target: CombatantMinion,
    retainer: Card,
    damage: number,
    who: string,
    log: string[],
): void {
    if (getHost(retainer) != target.minion) {
        log.push(`${who} has no target: ${retainer.name} is gone`)
        return
    }
    const lost = Math.min(damage, retainer.blood)
    retainer.blood -= lost
    log.push(`${who} deals ${lost} damage to ${retainer.name}`)
    if (retainer.blood <= 0) {
        gameState.moveCardToRegion(retainer, retainer.owner.ashHeap)
        log.push(`${retainer.name} is burned`)
    }
}

function resolveStrike(
    gameState: GameState,
    combat: CombatState,
    striker: CombatantMinion,
    strike: CombatStrike,
    log: string[],
): void {
    const target = getOpposingCombatant(combat, striker)
    const who = `${striker.minion.name} (${strike.name})`

    if (strike.dodge) {
        log.push(who)
        return
    }
    if (!isStrikeEffective(strike, combat.range)) {
        log.push(`${who} has no effect at long range`)
        return
    }
    // A dodge protects against every effect of the opposing strike, first strike included
    if (target.strike?.dodge && !strike.undodgeable) {
        log.push(`${who} is dodged by ${target.minion.name}`)
        return
    }
    if (strike.retainer) {
        hitRetainer(gameState, target, strike.retainer, strike.damage, who, log)
        return
    }

    if (strike.stealBlood > 0) {
        const moved = stealBlood(target.minion, striker.minion, strike.stealBlood)
        log.push(`${who} steals ${moved} from ${target.minion.name}`)
    }
    if (strike.damage > 0) {
        if (strike.aggravated) {
            target.pendingDamage.aggravated += strike.damage
        } else {
            target.pendingDamage.regular += strike.damage
        }
        log.push(
            `${who} deals ${strike.damage}${strike.aggravated ? ' aggravated' : ''} damage to ${target.minion.name}`,
        )
    }
}

// Does not count as damage: it cannot be prevented, and it happens before damage is mended
function stealBlood(from: Minion, to: Minion, amount: number): number {
    const moved = Math.min(amount, from.blood)
    from.blood -= moved
    to.blood += moved
    // The excess over the capacity drains off
    if (to.isVampire()) {
        to.blood = Math.min(to.blood, to.minionAttrs.capacity)
    }
    return moved
}

/**
 * Damage resolution
 */

function enterDamageResolution(gameState: GameState, combat: CombatState, log: string[]): void {
    const victim = [combat.acting, combat.defending].find(hasPendingDamage)
    if (!victim) {
        // Nothing to prevent
        finishDamageResolution(gameState, combat, log)
        return
    }
    enterStep(combat, CombatStep.DamageResolution)
    combat.impulsePlayer = getPlayer(victim)
}

type DamageOutcome = { burned: boolean; wounded: boolean }

// Regular damage is mended with blood, then aggravated damage can not be mended
function applyPendingDamage(combatant: CombatantMinion, log: string[]): DamageOutcome {
    const minion = combatant.minion
    const { regular, aggravated } = combatant.pendingDamage
    combatant.pendingDamage = { regular: 0, aggravated: 0 }
    const outcome: DamageOutcome = { burned: false, wounded: false }

    if (!minion.isVampire()) {
        // Allies burn life counters. The life of an ally is its blood.
        const lost = Math.min(regular + aggravated, minion.blood)
        minion.blood -= lost
        if (lost > 0) {
            log.push(`${minion.name} loses ${lost} life`)
        }
        return outcome
    }

    const mended = Math.min(regular, minion.blood)
    minion.blood -= mended
    combatant.bloodLost += mended
    outcome.wounded = regular > mended
    if (regular > 0) {
        log.push(`${minion.name} mends ${mended} of ${regular} damage`)
    }

    for (let i = 0; i < aggravated; i++) {
        if (!outcome.wounded) {
            // The first point is not mended: the vampire is wounded
            outcome.wounded = true
        } else if (minion.blood > 0) {
            // Each further point burns a blood to avoid destruction
            minion.blood--
            combatant.bloodLost++
        } else {
            outcome.burned = true
            break
        }
    }
    if (aggravated > 0) {
        log.push(`${minion.name} takes ${aggravated} aggravated damage`)
    }
    return outcome
}

// Applies the pending damage of a combatant: blood lost, then torpor or burning
function resolveDamage(gameState: GameState, combatant: CombatantMinion, log: string[]): void {
    const minion = combatant.minion
    const outcome = applyPendingDamage(combatant, log)
    // An ally without life left is burned, whatever took the life
    const burned = outcome.burned || (!minion.isVampire() && minion.blood <= 0)
    if (burned) {
        burnMinion(gameState, minion)
        log.push(`${minion.name} is burned`)
    } else if (outcome.wounded) {
        sendToTorpor(gameState, minion)
        log.push(`${minion.name} goes to torpor`)
    }
}

// A human applies the damage to their own minion by hand ( or with the apply damage
// move ): what is still pending when the window closes is dropped, not applied.
function leaveDamageToHand(combatant: CombatantMinion, log: string[]): void {
    const { regular, aggravated } = combatant.pendingDamage
    combatant.pendingDamage = { regular: 0, aggravated: 0 }
    if (regular > 0 || aggravated > 0) {
        log.push(
            `${combatant.minion.name} is left to apply ${regular} damage` +
                `${aggravated > 0 ? ` and ${aggravated} aggravated damage` : ''} by hand`,
        )
    }
}

function finishDamageResolution(gameState: GameState, combat: CombatState, log: string[]): void {
    for (const combatant of [combat.acting, combat.defending]) {
        if (combatant.minion.controller.isBot) {
            resolveDamage(gameState, combatant, log)
        } else {
            leaveDamageToHand(combatant, log)
        }
    }

    if (!bothReady(combat)) {
        // The round and the combat end immediately, but the end of round step still happens
        combat.isOver = true
    }
    resolveStrikeTier(gameState, combat, log)
}

function sendToTorpor(gameState: GameState, minion: Minion): void {
    const torpor = minion.controller.torpor
    const x = 8 * GRID_SIZE * torpor.length
    gameState.moveCardToRegion(minion, torpor)
    minion.setCoordinates(x, TORPOR_ZONE_Y)
    syncAttachedCards(gameState, minion)
}

function burnMinion(gameState: GameState, minion: Minion): void {
    gameState.moveCardToRegion(minion, minion.owner.ashHeap)
    minion.setCoordinates(0, 0)
}

/**
 * Moves. Each assumes the matching can...() check passed.
 */

function getActiveCombat(gameState: GameState): CombatState {
    if (!gameState.combat) {
        throw new Error('gameState.combat is null')
    }
    return gameState.combat
}

// The current window is done for the impulse player
export function passCombatImpulse(gameState: GameState): string[] {
    const combat = getActiveCombat(gameState)
    const log: string[] = []
    const actingPlayer = getPlayer(combat.acting)
    const defendingPlayer = getPlayer(combat.defending)

    switch (combat.step) {
        // The acting minion first, then the opposing one. Playing something gives the
        // acting minion the impulse back, so only a pass reaches here.
        case CombatStep.BeforeRange:
        case CombatStep.BeforeStrikes:
        case CombatStep.AdditionalStrikes:
        case CombatStep.EndOfRound:
            if (combat.impulsePlayer == actingPlayer) {
                combat.impulsePlayer = defendingPlayer
            } else {
                closeWindow(gameState, combat, log)
            }
            break

        // Offsetting each other: a minion that passes when facing the other's
        // last maneuver / press closes the window, since that one cannot play twice in a row.
        case CombatStep.DetermineRange:
        case CombatStep.Press:
            if (combat.lastPlayedBy) {
                closeWindow(gameState, combat, log)
            } else if (combat.impulsePlayer == actingPlayer) {
                combat.impulsePlayer = defendingPlayer
            } else {
                closeWindow(gameState, combat, log)
            }
            break

        // Prevention is for the victims, acting minion first
        case CombatStep.DamageResolution:
            if (combat.impulsePlayer == actingPlayer && hasPendingDamage(combat.defending)) {
                combat.impulsePlayer = defendingPlayer
            } else {
                closeWindow(gameState, combat, log)
            }
            break

        case CombatStep.Strike:
            throw new Error('Cannot pass during the strike step')
    }
    return log
}

// A maneuver moves the range to long, or back to close. A strike given by the
// maneuver ( strike card, weapon ) is the minion's strike of this round.
export function playManeuver(
    gameState: GameState,
    minion: Minion,
    strike?: CombatStrike,
    weapon?: Card,
    free?: boolean,
): string[] {
    const combat = getActiveCombat(gameState)
    const combatant = getCombatant(combat, minion)
    if (!combatant) {
        throw new Error(`${minion.name} is not in this combat`)
    }
    if (free) {
        combatant.freeManeuvers -= 1
    }
    if (weapon) {
        combat.weaponManeuvers.push(weapon.oid)
    }

    combat.range = combat.range == CombatRange.Close ? CombatRange.Long : CombatRange.Close
    combat.lastPlayedBy = minion.controller
    combat.impulsePlayer = getOpposingPlayer(combat, minion.controller)
    if (strike) {
        combatant.strike = strike
    }
    return [`${minion.name} maneuvers: ${combat.range} range`]
}

// Playing something in a window gives the acting minion the impulse back
export function setStrength(gameState: GameState, minion: Minion, strength: number): string[] {
    const combat = getActiveCombat(gameState)
    const combatant = getCombatant(combat, minion)
    if (!combatant) {
        throw new Error(`${minion.name} is not in this combat`)
    }

    combatant.strength = strength
    combat.impulsePlayer = getPlayer(combat.acting)
    return [`${minion.name} has a strength of ${strength}`]
}

export function chooseStrike(
    gameState: GameState,
    minion: Minion,
    strike: CombatStrike,
    additional?: AdditionalStrikeGain,
): string[] {
    const combat = getActiveCombat(gameState)
    const combatant = getCombatant(combat, minion)
    if (!combatant) {
        throw new Error(`${minion.name} is not in this combat`)
    }

    const log = [`${minion.name} strikes: ${strike.name}`]
    combatant.strike = strike
    if (additional) {
        combatant.additionalStrikes++
        combatant.limitedAdditionalGained ||= additional.limited
        log.push(`${minion.name} gains an additional strike`)
    }
    advanceStrikeChoices(gameState, combat, log)
    return log
}

// Playing something in a window gives the acting minion the impulse back
export function addStrikes(
    gameState: GameState,
    minion: Minion,
    gain: AdditionalStrikeGain,
): string[] {
    const combat = getActiveCombat(gameState)
    const combatant = getCombatant(combat, minion)
    if (!combatant) {
        throw new Error(`${minion.name} is not in this combat`)
    }

    combatant.additionalStrikes++
    combatant.limitedAdditionalGained ||= gain.limited
    combat.impulsePlayer = getPlayer(combat.acting)
    return [`${minion.name} gains an additional strike`]
}

// Only hand strikes for the round, and what the grapple gives besides
export function grapple(
    gameState: GameState,
    minion: Minion,
    press: boolean,
    closeNextRound: boolean,
): string[] {
    const combat = getActiveCombat(gameState)
    const combatant = getCombatant(combat, minion)
    if (!combatant) {
        throw new Error(`${minion.name} is not in this combat`)
    }

    combat.handStrikesOnly = true
    if (press) {
        combatant.pressesGranted++
    }
    if (closeNextRound) {
        combat.closeNextRound = true
    }
    combat.impulsePlayer = getPlayer(combat.acting)
    return [`${minion.name} grapples: only hand strikes this round`]
}

export function gainBlood(gameState: GameState, minion: Minion, amount: number): string[] {
    const combat = getActiveCombat(gameState)
    if (!minion.isVampire()) {
        throw new Error(`${minion.name} is not a vampire`)
    }
    const gained = Math.max(0, Math.min(amount, minion.minionAttrs.capacity - minion.blood))
    minion.blood += gained
    combat.impulsePlayer = getPlayer(combat.acting)
    return [`${minion.name} gains ${gained} blood`]
}

export function takeStrengthBonus(gameState: GameState, minion: Minion): string[] {
    const combat = getActiveCombat(gameState)
    const combatant = getCombatant(combat, minion)
    if (!combatant) {
        throw new Error(`${minion.name} is not in this combat`)
    }
    combatant.strength += combatant.strengthBonus
    const log = [`${minion.name} gains ${combatant.strengthBonus} strength`]
    combatant.strengthBonus = 0
    combat.impulsePlayer = getPlayer(combat.acting)
    return log
}

export function markCombatCardPlayed(gameState: GameState, minion: Minion, krcgId: string): void {
    const combat = getActiveCombat(gameState)
    const played = combat.playedThisRound[minion.oid] ?? []
    combat.playedThisRound[minion.oid] = [...played, krcgId]
}

// A press to continue, or the cancellation of the opposing one. A granted press is used up.
export function playPress(gameState: GameState, minion: Minion, granted = false): string[] {
    const combat = getActiveCombat(gameState)
    const combatant = getCombatant(combat, minion)
    if (granted && combatant) {
        combatant.pressesGranted--
    }

    combat.pressed = !combat.pressed
    combat.lastPlayedBy = minion.controller
    combat.impulsePlayer = getOpposingPlayer(combat, minion.controller)
    return [`${minion.name} ${combat.pressed ? 'presses to continue' : 'cancels the press'}`]
}

export function preventDamage(
    gameState: GameState,
    minion: Minion,
    amount: number,
    aggravated: boolean,
): string[] {
    const combat = getActiveCombat(gameState)
    const combatant = getCombatant(combat, minion)
    if (!combatant) {
        throw new Error(`${minion.name} is not in this combat`)
    }

    if (aggravated) {
        combatant.pendingDamage.aggravated -= amount
    } else {
        combatant.pendingDamage.regular -= amount
    }
    return [`${minion.name} prevents ${amount}${aggravated ? ' aggravated' : ''} damage`]
}

// Applies the pending damage of a minion now, instead of leaving it to be applied by hand.
// The window stays open: the combat goes on when the players pass.
export function applyDamageNow(gameState: GameState, minion: Minion): string[] {
    const combat = getActiveCombat(gameState)
    const combatant = getCombatant(combat, minion)
    if (!combatant) {
        throw new Error(`${minion.name} is not in this combat`)
    }
    const log: string[] = []
    resolveDamage(gameState, combatant, log)
    return log
}

// Stops the combat on the spot, nothing more is resolved
export function endCombatNow(gameState: GameState): string[] {
    closeCombat(gameState)
    return ['Combat ended']
}
