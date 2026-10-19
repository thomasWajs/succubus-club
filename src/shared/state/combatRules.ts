import {
    CombatRange,
    CombatStep,
    Invalid,
    PendingDamage,
    VALID,
    Validity,
} from '@/shared/types/state.ts'

/**
 * The rules of a combat, apart from the game they are played in.
 * Two things run them: the engine ( combatState.ts, on the minions and cards of a GameState ) and the
 * bot's combat model ( utility/combatModel.ts, on plain numbers, to look ahead ). Each tells the rules
 * what it needs through a CombatHost: who owns a combatant, its blood, what happens when it goes to
 * torpor or burns, what a retainer is, how the combat is closed. The step machine, the strikes and the
 * damage are written once, here. Every function changes the combat it is given and returns the log lines.
 *
 * Not modelled: immunity to damage, steal equipment, destroy weapon, damage prevention for retainers,
 * diablerie.
 */

// Strikes resolve by tiers : "combat ends" first, then first strikes, then the rest.
const TIER_COMBAT_ENDS = 0
const TIER_FIRST_STRIKE = 1
const TIER_NORMAL = 2

// What the rules need to know of a strike. `retainer` is the retainer of the opposing minion that it is
// aimed at, whatever the host calls a retainer. `equipment` is the equipment of the opposing minion that the
// strike burns ( a strike that does nothing else ).
export type StrikeBase = {
    name: string
    damage: number
    aggravated: boolean
    // Usable at long range ( "R" damage or a ranged strike )
    ranged: boolean
    dodge: boolean
    // A strike that is a hand strike, whatever its damage ( the grapple only allows these )
    isHand: boolean
    // The opposing dodge does not protect from it
    undodgeable: boolean
    combatEnds: boolean
    firstStrike: boolean
    // Blood ( or life ) moved from the opposing minion to the striking one
    stealBlood: number
    retainer?: unknown
    equipment?: unknown
    // A strike a card in play gives once per combat ( an ally's dodge ): the key of that use
    onceKey?: string
}

export type PlayStrike = Omit<StrikeBase, 'retainer' | 'equipment'>

// A strike that does nothing but what the overrides say
export function newStrike(name: string, overrides: Partial<PlayStrike> = {}): PlayStrike {
    return {
        name,
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

// What a combatant is, apart from the minion behind it ( its blood and its state are the host's )
export type CombatantBase = {
    strength: number
    strike: StrikeBase | null
    // Damage inflicted by the strikes just resolved, not yet mended
    pendingDamage: PendingDamage
    // Blood burned to damage this round ( the amount that Taste of Vitae gives back )
    bloodLost: number
    // Additional strikes gained and not used yet, and whether a limited card gave one this round
    additionalStrikes: number
    limitedAdditionalGained: boolean
    // Chooses a strike in the current pair ( always in the first one )
    strikesInPair: boolean
    // Presses given by a card played this round and not used yet
    pressesGranted: number
    // A strength bonus the combatant can take before the range of the first round ( Show of Force )
    strengthBonus: number
    // Maneuvers the combatant can play without a card ( given by a reaction when it blocked )
    freeManeuvers: number
    // Regular damage the combatant takes each round from the combat cards played against it
    // ( Carrion Crows ), on top of what the retainers of the opposing minion inflict
    environmentalDamage: number
}

export type CombatBase = {
    acting: CombatantBase
    defending: CombatantBase
    round: number
    step: CombatStep
    range: CombatRange
    // Who may act in the current window of the current step: what the host calls the owner of a combatant
    impulsePlayer: unknown
    // Maneuver and press windows: who played the last maneuver / press there. A minion cannot play two in a row.
    lastPlayedBy: unknown
    // A press to continue is standing
    pressed: boolean
    // Strikes of tiers up to this one are resolved
    resolvedStrikeTier: number
    // 0 for the normal pair of strikes, then 1 for each pair of additional strikes
    strikePair: number
    // Only hand strikes can be used this round ( grapple )
    handStrikesOnly: boolean
    // The next round is at close range and skips the determine range step
    closeNextRound: boolean
    // The krcgIds of the combat cards each minion ( by key ) played this round, and in the whole combat
    playedThisRound: Record<string, string[]>
    playedThisCombat: Record<string, string[]>
    // The environmental damage of the round is inflicted ( once per round, with the normal strikes )
    environmentalApplied: boolean
    // The keys of the weapons that gave their maneuver in this combat ( once per combat, even if the bearer
    // changes )
    weaponManeuvers: string[]
    // The keys of the attached cards that prevented damage in this combat ( once per combat )
    attachedPreventions: string[]
    // The keys of the strikes of cards in play already chosen in this combat ( `StrikeBase.onceKey` )
    usedOnce: string[]
    // The combat ends after the end of round step
    isOver: boolean
}

export interface CombatHost {
    name(combatant: CombatantBase): string
    // The one whose impulse it is when the combatant may act
    owner(combatant: CombatantBase): unknown
    // Not in torpor, not burned
    ready(combatant: CombatantBase): boolean
    isVampire(combatant: CombatantBase): boolean
    // The blood of a vampire, the life of an ally
    blood(combatant: CombatantBase): number
    setBlood(combatant: CombatantBase, blood: number): void
    capacity(combatant: CombatantBase): number
    // The damage of each round that is not a strike, from what the combatant carries ( retainers )
    environmentalFrom(source: CombatantBase): number
    sendToTorpor(combatant: CombatantBase): void
    burn(combatant: CombatantBase): void
    // Is the retainer a strike is aimed at one of the opposing combatant
    retainerValidity(opposing: CombatantBase, strike: StrikeBase): Validity
    // The damage of a strike aimed at a retainer of the target
    hitRetainer(target: CombatantBase, strike: StrikeBase, who: string, log: string[]): void
    // Is the equipment a strike burns one of the opposing combatant
    equipmentValidity(opposing: CombatantBase, strike: StrikeBase): Validity
    // A strike burns the equipment of the target it is aimed at
    burnEquipment(target: CombatantBase, strike: StrikeBase, who: string, log: string[]): void
    // The damage pending on the combatant is applied ( a bot ), or left to its player ( a human )
    settleDamage(combatant: CombatantBase, log: string[]): void
    // The combat is over
    close(): void
}

// What a move names: the combatant, none when the minion is not in the combat
export type Actor = { combatant: CombatantBase | null; name: string }

// An additional strike can come with the strike chosen ( a strike card that gives one )
export type AdditionalStrikeGain = { limited: boolean }

export function newCombatantFields(strength: number): CombatantBase {
    return {
        strength,
        strike: null,
        pendingDamage: { regular: 0, aggravated: 0 },
        bloodLost: 0,
        additionalStrikes: 0,
        limitedAdditionalGained: false,
        strikesInPair: true,
        pressesGranted: 0,
        strengthBonus: 0,
        freeManeuvers: 0,
        environmentalDamage: 0,
    }
}

// The first round: at close range, before the range, the acting minion has the impulse
export function newCombatFields<Owner>(owner: Owner): Omit<
    CombatBase,
    'acting' | 'defending' | 'impulsePlayer' | 'lastPlayedBy'
> & {
    impulsePlayer: Owner
    lastPlayedBy: Owner | null
} {
    return {
        round: 1,
        step: CombatStep.BeforeRange,
        range: CombatRange.Close,
        impulsePlayer: owner,
        lastPlayedBy: null,
        pressed: false,
        resolvedStrikeTier: -1,
        strikePair: 0,
        handStrikesOnly: false,
        closeNextRound: false,
        playedThisRound: {},
        playedThisCombat: {},
        environmentalApplied: false,
        weaponManeuvers: [],
        attachedPreventions: [],
        usedOnce: [],
        isOver: false,
    }
}

/**
 * Reading the state
 */

export function opposingOf<C extends CombatantBase>(
    combat: { acting: C; defending: C },
    combatant: C,
): C {
    return combatant == combat.acting ? combat.defending : combat.acting
}

// The owner that is not the given one
function opposingOwner(host: CombatHost, combat: CombatBase, owner: unknown): unknown {
    return host.owner(combat.acting) == owner ?
            host.owner(combat.defending)
        :   host.owner(combat.acting)
}

export function isStrikeEffective(strike: StrikeBase, range: CombatRange): boolean {
    return range == CombatRange.Close || strike.ranged || strike.dodge || strike.combatEnds
}

function getStrikeTier(strike: StrikeBase): number {
    if (strike.combatEnds) {
        return TIER_COMBAT_ENDS
    }
    return strike.firstStrike ? TIER_FIRST_STRIKE : TIER_NORMAL
}

function hasPendingDamage(combatant: CombatantBase): boolean {
    return combatant.pendingDamage.regular > 0 || combatant.pendingDamage.aggravated > 0
}

function bothReady(host: CombatHost, combat: CombatBase): boolean {
    return host.ready(combat.acting) && host.ready(combat.defending)
}

/**
 * Validity of the moves. They all require the impulse, except ending the combat by hand.
 */

function getMoveValidity(
    host: CombatHost,
    combat: CombatBase | null,
    step: CombatStep,
    actor: Actor,
): Validity {
    if (!combat) {
        return Invalid('No combat in progress')
    }
    if (combat.step != step) {
        return Invalid(`Not possible during the ${combat.step} step`)
    }
    if (!actor.combatant) {
        return Invalid(`${actor.name} is not in this combat`)
    }
    if (host.owner(actor.combatant) != combat.impulsePlayer) {
        return Invalid(`${actor.name} does not have the impulse`)
    }
    return VALID
}

export function checkPass(combat: CombatBase | null): Validity {
    if (!combat) {
        return Invalid('No combat in progress')
    }
    if (combat.step == CombatStep.Strike) {
        return Invalid('A strike must be chosen')
    }
    return VALID
}

// A strike aimed at a retainer needs a retainer attached to the opposing minion, one that burns an
// equipment needs an equipment of it
function checkStrikeTarget(
    host: CombatHost,
    combat: CombatBase,
    combatant: CombatantBase | null,
    strike: StrikeBase,
): Validity {
    if (strike.retainer === undefined && strike.equipment === undefined) {
        return VALID
    }
    const opposing = combatant && opposingOf(combat, combatant)
    if (!opposing) {
        return Invalid('No opposing minion')
    }
    return strike.retainer === undefined ?
            host.equipmentValidity(opposing, strike)
        :   host.retainerValidity(opposing, strike)
}

// The maneuver of a weapon ( `weaponKey` ) comes with its strike, and is given once per combat
export function checkManeuver(
    host: CombatHost,
    combat: CombatBase | null,
    actor: Actor,
    move: { strike?: StrikeBase; weaponKey?: string; free?: boolean },
): Validity {
    const validity = getMoveValidity(host, combat, CombatStep.DetermineRange, actor)
    if (!validity.isValid || !combat) {
        return validity
    }
    const { strike, weaponKey, free } = move
    const combatant = actor.combatant
    if (combatant && combat.lastPlayedBy == host.owner(combatant)) {
        return Invalid('A minion cannot play two maneuvers in a row')
    }
    if (free && !combatant?.freeManeuvers) {
        return Invalid('The minion has no maneuver to play for free')
    }
    if (strike && combatant?.strike) {
        return Invalid('The strike is already chosen')
    }
    if (strike && combat.handStrikesOnly && !strike.isHand) {
        return Invalid('Only hand strikes can be used this round')
    }
    if (weaponKey && combat.weaponManeuvers.includes(weaponKey)) {
        return Invalid('The weapon already gave its maneuver in this combat')
    }
    return strike ? checkStrikeTarget(host, combat, combatant, strike) : VALID
}

function canGainAdditionalStrike(
    combatant: CombatantBase | null,
    gain: AdditionalStrikeGain,
): Validity {
    return gain.limited && combatant?.limitedAdditionalGained ?
            Invalid('Only one limited additional strike per round')
        :   VALID
}

export function checkChooseStrike(
    host: CombatHost,
    combat: CombatBase | null,
    actor: Actor,
    strike?: StrikeBase,
    additional?: AdditionalStrikeGain,
): Validity {
    const validity = getMoveValidity(host, combat, CombatStep.Strike, actor)
    if (!validity.isValid || !combat) {
        return validity
    }
    const combatant = actor.combatant
    if (combatant?.strike) {
        return Invalid('The strike is already chosen')
    }
    if (!combatant?.strikesInPair) {
        return Invalid('No strike to choose in this pair')
    }
    if (strike && combat.handStrikesOnly && !strike.isHand) {
        return Invalid('Only hand strikes can be used this round')
    }
    if (strike?.onceKey && combat.usedOnce.includes(strike.onceKey)) {
        return Invalid('This strike was already used in this combat')
    }
    const target = strike ? checkStrikeTarget(host, combat, combatant, strike) : VALID
    if (!target.isValid) {
        return target
    }
    return additional ? canGainAdditionalStrike(combatant, additional) : VALID
}

// Cards played in the window after a pair of strikes
export function checkAddStrikes(
    host: CombatHost,
    combat: CombatBase | null,
    actor: Actor,
    gain: AdditionalStrikeGain,
): Validity {
    if (!combat) {
        return Invalid('No combat in progress')
    }
    const validity = getMoveValidity(host, combat, CombatStep.AdditionalStrikes, actor)
    return validity.isValid ? canGainAdditionalStrike(actor.combatant, gain) : validity
}

// A window of the steps before the strikes: the card says which one it is played in
export function checkSetStrength(
    host: CombatHost,
    combat: CombatBase | null,
    actor: Actor,
): Validity {
    if (!combat) {
        return Invalid('No combat in progress')
    }
    if (combat.step != CombatStep.BeforeRange && combat.step != CombatStep.BeforeStrikes) {
        return Invalid(`The strength cannot be changed during the ${combat.step} step`)
    }
    if (!actor.combatant) {
        return Invalid(`${actor.name} is not in this combat`)
    }
    return host.owner(actor.combatant) == combat.impulsePlayer ?
            VALID
        :   Invalid(`${actor.name} does not have the impulse`)
}

// A card that makes the opposing minion take damage each round ( Carrion Crows ): before the range
export function checkAddEnvironmentalDamage(
    host: CombatHost,
    combat: CombatBase | null,
    actor: Actor,
): Validity {
    return getMoveValidity(host, combat, CombatStep.BeforeRange, actor)
}

// A press: the one a card gives ( granted ) is not played from the hand
export function checkPress(
    host: CombatHost,
    combat: CombatBase | null,
    actor: Actor,
    granted = false,
): Validity {
    const validity = getMoveValidity(host, combat, CombatStep.Press, actor)
    if (!validity.isValid || !combat) {
        return validity
    }
    const combatant = actor.combatant
    if (combatant && combat.lastPlayedBy == host.owner(combatant)) {
        return Invalid('A minion cannot play two presses in a row')
    }
    if (granted && !combatant?.pressesGranted) {
        return Invalid('No press to use')
    }
    return VALID
}

// The grapple: before the strikes are chosen, at close range
export function checkGrapple(host: CombatHost, combat: CombatBase | null, actor: Actor): Validity {
    const validity = getMoveValidity(host, combat, CombatStep.BeforeStrikes, actor)
    if (!validity.isValid || !combat) {
        return validity
    }
    if (combat.range != CombatRange.Close) {
        return Invalid('A grapple needs close range')
    }
    return VALID
}

// Blood gained at the end of the round ( Taste of Vitae )
export function checkGainBlood(
    host: CombatHost,
    combat: CombatBase | null,
    actor: Actor,
): Validity {
    const validity = getMoveValidity(host, combat, CombatStep.EndOfRound, actor)
    if (!validity.isValid || !combat) {
        return validity
    }
    const combatant = actor.combatant
    if (!combatant || !host.ready(combatant) || !host.isVampire(combatant)) {
        return Invalid('Only a ready vampire gains blood')
    }
    return VALID
}

// The strength bonus a card gave for the first round ( Show of Force ), taken before the range
export function checkTakeStrengthBonus(
    host: CombatHost,
    combat: CombatBase | null,
    actor: Actor,
): Validity {
    if (!combat || combat.round != 1) {
        return Invalid('The bonus is for the first round')
    }
    const validity = getMoveValidity(host, combat, CombatStep.BeforeRange, actor)
    if (!validity.isValid) {
        return validity
    }
    return actor.combatant?.strengthBonus ? VALID : Invalid('No bonus to take')
}

export function checkPreventDamage(
    host: CombatHost,
    combat: CombatBase | null,
    actor: Actor,
    amount: number,
    aggravated: boolean,
    sourceKey?: string,
): Validity {
    const validity = getMoveValidity(host, combat, CombatStep.DamageResolution, actor)
    if (!validity.isValid || !combat) {
        return validity
    }
    if (sourceKey && combat.attachedPreventions.includes(sourceKey)) {
        return Invalid('The card already prevented damage in this combat')
    }
    const pending = actor.combatant?.pendingDamage
    const available = aggravated ? pending?.aggravated : pending?.regular
    if (amount <= 0 || !available || amount > available) {
        return Invalid('Not enough damage to prevent')
    }
    return VALID
}

export function checkApplyDamage(
    host: CombatHost,
    combat: CombatBase | null,
    actor: Actor,
): Validity {
    const validity = getMoveValidity(host, combat, CombatStep.DamageResolution, actor)
    if (!validity.isValid || !combat) {
        return validity
    }
    return actor.combatant && hasPendingDamage(actor.combatant) ?
            VALID
        :   Invalid('No damage to apply')
}

/**
 * Steps
 */

function enterStep(host: CombatHost, combat: CombatBase, step: CombatStep): void {
    combat.step = step
    combat.lastPlayedBy = null
    combat.impulsePlayer = host.owner(combat.acting)
}

// Minions that still have to choose their strike, acting minion first. A strike
// can already be set: a maneuver from a strike card or a weapon chooses it too.
function advanceStrikeChoices(host: CombatHost, combat: CombatBase, log: string[]): void {
    const next = [combat.acting, combat.defending].find(
        combatant => !combatant.strike && combatant.strikesInPair,
    )
    if (next) {
        combat.impulsePlayer = host.owner(next)
    } else {
        resolveStrikeTier(host, combat, log)
    }
}

function closeWindow(host: CombatHost, combat: CombatBase, log: string[]): void {
    switch (combat.step) {
        case CombatStep.BeforeRange:
            // A grapple of the last round: this round is at close range, nobody can maneuver
            if (combat.closeNextRound) {
                combat.closeNextRound = false
                enterStep(host, combat, CombatStep.BeforeStrikes)
            } else {
                enterStep(host, combat, CombatStep.DetermineRange)
            }
            break
        case CombatStep.DetermineRange:
            enterStep(host, combat, CombatStep.BeforeStrikes)
            break
        case CombatStep.BeforeStrikes:
            enterStep(host, combat, CombatStep.Strike)
            advanceStrikeChoices(host, combat, log)
            break
        case CombatStep.DamageResolution:
            finishDamageResolution(host, combat, log)
            break
        case CombatStep.AdditionalStrikes:
            if (combat.acting.additionalStrikes > 0 || combat.defending.additionalStrikes > 0) {
                startAdditionalPair(host, combat, log)
            } else {
                enterStep(host, combat, CombatStep.Press)
            }
            break
        case CombatStep.Press:
            enterStep(host, combat, CombatStep.EndOfRound)
            break
        case CombatStep.EndOfRound:
            finishRound(host, combat, log)
            break
        case CombatStep.Strike:
            throw new Error('The strike step has no window to close')
    }
}

function finishRound(host: CombatHost, combat: CombatBase, log: string[]): void {
    if (combat.isOver || !combat.pressed || !bothReady(host, combat)) {
        host.close()
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
    combat.environmentalApplied = false
    for (const combatant of [combat.acting, combat.defending]) {
        combatant.strike = null
        combatant.strikesInPair = true
        combatant.additionalStrikes = 0
        combatant.limitedAdditionalGained = false
        combatant.pressesGranted = 0
        combatant.strengthBonus = 0
        combatant.bloodLost = 0
    }
    enterStep(host, combat, CombatStep.BeforeRange)
    log.push(`Round ${combat.round}`)
}

// After a pair of strikes ( or when the combat ends early ): the window to gain additional
// strikes, or the end of round
function leaveStrikes(host: CombatHost, combat: CombatBase): void {
    if (!combat.isOver && bothReady(host, combat)) {
        enterStep(host, combat, CombatStep.AdditionalStrikes)
    } else {
        enterStep(host, combat, CombatStep.EndOfRound)
    }
}

// The minions with an additional strike choose a strike in a new pair, the others sit it out
function startAdditionalPair(host: CombatHost, combat: CombatBase, log: string[]): void {
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
    enterStep(host, combat, CombatStep.Strike)
    advanceStrikeChoices(host, combat, log)
}

/**
 * Strike resolution
 */

function resolveStrikeTier(host: CombatHost, combat: CombatBase, log: string[]): void {
    // A combatant is no longer ready: the strikes left are lost
    if (combat.isOver) {
        leaveStrikes(host, combat)
        return
    }

    const strikers = [combat.acting, combat.defending].flatMap(combatant =>
        combatant.strike && getStrikeTier(combatant.strike) > combat.resolvedStrikeTier ?
            [{ combatant, strike: combatant.strike }]
        :   [],
    )
    if (strikers.length == 0) {
        // Only first strikes were played: the normal strike resolution still happens
        if (applyEnvironmentalDamage(host, combat, log)) {
            enterDamageResolution(host, combat, log)
        } else {
            leaveStrikes(host, combat)
        }
        return
    }

    const tier = Math.min(...strikers.map(({ strike }) => getStrikeTier(strike)))
    combat.resolvedStrikeTier = tier

    if (tier == TIER_COMBAT_ENDS) {
        // Resolves before anything else and cannot be dodged
        log.push(`${host.name(combat.acting)} and ${host.name(combat.defending)}: combat ends`)
        combat.isOver = true
        leaveStrikes(host, combat)
        return
    }

    const resolving = strikers.filter(({ strike }) => getStrikeTier(strike) == tier)
    for (const { combatant, strike } of resolving) {
        resolveStrike(host, combat, combatant, strike, log)
    }
    if (tier == TIER_NORMAL) {
        applyEnvironmentalDamage(host, combat, log)
    }
    enterDamageResolution(host, combat, log)
}

// The damage that is not a strike: what the combat cards played against a combatant and the
// retainers of its opponent inflict, once per round with the normal strikes ( it is not dodged ).
// Tells whether some damage is pending.
function applyEnvironmentalDamage(host: CombatHost, combat: CombatBase, log: string[]): boolean {
    if (combat.environmentalApplied) {
        return false
    }
    combat.environmentalApplied = true
    let inflicted = false
    for (const victim of [combat.acting, combat.defending]) {
        const source = opposingOf(combat, victim)
        const amount = victim.environmentalDamage + host.environmentalFrom(source)
        if (amount > 0) {
            victim.pendingDamage.regular += amount
            inflicted = true
            log.push(`${host.name(victim)} takes ${amount} environmental damage`)
        }
    }
    return inflicted
}

function resolveStrike(
    host: CombatHost,
    combat: CombatBase,
    striker: CombatantBase,
    strike: StrikeBase,
    log: string[],
): void {
    const target = opposingOf(combat, striker)
    const who = `${host.name(striker)} (${strike.name})`

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
        log.push(`${who} is dodged by ${host.name(target)}`)
        return
    }
    if (strike.retainer !== undefined) {
        host.hitRetainer(target, strike, who, log)
        return
    }
    if (strike.equipment !== undefined) {
        host.burnEquipment(target, strike, who, log)
        return
    }

    if (strike.stealBlood > 0) {
        const moved = stealBlood(host, target, striker, strike.stealBlood)
        log.push(`${who} steals ${moved} from ${host.name(target)}`)
    }
    if (strike.damage > 0) {
        if (strike.aggravated) {
            target.pendingDamage.aggravated += strike.damage
        } else {
            target.pendingDamage.regular += strike.damage
        }
        log.push(
            `${who} deals ${strike.damage}${strike.aggravated ? ' aggravated' : ''} damage to ${host.name(target)}`,
        )
    }
}

// Does not count as damage: it cannot be prevented, and it happens before damage is mended
function stealBlood(
    host: CombatHost,
    from: CombatantBase,
    to: CombatantBase,
    amount: number,
): number {
    const moved = Math.min(amount, host.blood(from))
    host.setBlood(from, host.blood(from) - moved)
    host.setBlood(to, host.blood(to) + moved)
    // The excess over the capacity drains off
    if (host.isVampire(to)) {
        host.setBlood(to, Math.min(host.blood(to), host.capacity(to)))
    }
    return moved
}

/**
 * Damage resolution
 */

function enterDamageResolution(host: CombatHost, combat: CombatBase, log: string[]): void {
    const victim = [combat.acting, combat.defending].find(hasPendingDamage)
    if (!victim) {
        // Nothing to prevent
        finishDamageResolution(host, combat, log)
        return
    }
    enterStep(host, combat, CombatStep.DamageResolution)
    combat.impulsePlayer = host.owner(victim)
}

type DamageOutcome = { burned: boolean; wounded: boolean }

// Regular damage is mended with blood, then aggravated damage can not be mended
function applyPendingDamage(
    host: CombatHost,
    combatant: CombatantBase,
    log: string[],
): DamageOutcome {
    const name = host.name(combatant)
    const { regular, aggravated } = combatant.pendingDamage
    combatant.pendingDamage = { regular: 0, aggravated: 0 }
    const outcome: DamageOutcome = { burned: false, wounded: false }
    let blood = host.blood(combatant)

    if (!host.isVampire(combatant)) {
        // Allies burn life counters. The life of an ally is its blood.
        const lost = Math.min(regular + aggravated, blood)
        host.setBlood(combatant, blood - lost)
        if (lost > 0) {
            log.push(`${name} loses ${lost} life`)
        }
        return outcome
    }

    const mended = Math.min(regular, blood)
    blood -= mended
    combatant.bloodLost += mended
    outcome.wounded = regular > mended
    if (regular > 0) {
        log.push(`${name} mends ${mended} of ${regular} damage`)
    }

    for (let i = 0; i < aggravated; i++) {
        if (!outcome.wounded) {
            // The first point is not mended: the vampire is wounded
            outcome.wounded = true
        } else if (blood > 0) {
            // Each further point burns a blood to avoid destruction
            blood--
            combatant.bloodLost++
        } else {
            outcome.burned = true
            break
        }
    }
    host.setBlood(combatant, blood)
    if (aggravated > 0) {
        log.push(`${name} takes ${aggravated} aggravated damage`)
    }
    return outcome
}

// Applies the pending damage of a combatant: blood lost, then torpor or burning
export function resolveDamage(host: CombatHost, combatant: CombatantBase, log: string[]): void {
    const outcome = applyPendingDamage(host, combatant, log)
    // An ally without life left is burned, whatever took the life
    const burned = outcome.burned || (!host.isVampire(combatant) && host.blood(combatant) <= 0)
    if (burned) {
        host.burn(combatant)
        log.push(`${host.name(combatant)} is burned`)
    } else if (outcome.wounded) {
        host.sendToTorpor(combatant)
        log.push(`${host.name(combatant)} goes to torpor`)
    }
}

function finishDamageResolution(host: CombatHost, combat: CombatBase, log: string[]): void {
    for (const combatant of [combat.acting, combat.defending]) {
        host.settleDamage(combatant, log)
    }

    if (!bothReady(host, combat)) {
        // The round and the combat end immediately, but the end of round step still happens
        combat.isOver = true
    }
    resolveStrikeTier(host, combat, log)
}

/**
 * Moves. Each assumes the matching check...() passed.
 */

// The current window is done for the impulse player
export function passImpulse(host: CombatHost, combat: CombatBase): string[] {
    const log: string[] = []
    const actingPlayer = host.owner(combat.acting)
    const defendingPlayer = host.owner(combat.defending)

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
                closeWindow(host, combat, log)
            }
            break

        // Offsetting each other: a minion that passes when facing the other's
        // last maneuver / press closes the window, since that one cannot play twice in a row.
        case CombatStep.DetermineRange:
        case CombatStep.Press:
            if (combat.lastPlayedBy) {
                closeWindow(host, combat, log)
            } else if (combat.impulsePlayer == actingPlayer) {
                combat.impulsePlayer = defendingPlayer
            } else {
                closeWindow(host, combat, log)
            }
            break

        // Prevention is for the victims, acting minion first
        case CombatStep.DamageResolution:
            if (combat.impulsePlayer == actingPlayer && hasPendingDamage(combat.defending)) {
                combat.impulsePlayer = defendingPlayer
            } else {
                closeWindow(host, combat, log)
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
    host: CombatHost,
    combat: CombatBase,
    combatant: CombatantBase,
    move: { strike?: StrikeBase; weaponKey?: string; free?: boolean },
): string[] {
    if (move.free) {
        combatant.freeManeuvers -= 1
    }
    if (move.weaponKey) {
        combat.weaponManeuvers.push(move.weaponKey)
    }

    combat.range = combat.range == CombatRange.Close ? CombatRange.Long : CombatRange.Close
    const owner = host.owner(combatant)
    combat.lastPlayedBy = owner
    combat.impulsePlayer = opposingOwner(host, combat, owner)
    if (move.strike) {
        combatant.strike = move.strike
    }
    return [`${host.name(combatant)} maneuvers: ${combat.range} range`]
}

// Playing something in a window gives the acting minion the impulse back
export function setStrength(
    host: CombatHost,
    combat: CombatBase,
    combatant: CombatantBase,
    strength: number,
): string[] {
    combatant.strength = strength
    combat.impulsePlayer = host.owner(combat.acting)
    return [`${host.name(combatant)} has a strength of ${strength}`]
}

// The opposing minion takes this much damage each round from now on. Playing something in a
// window gives the acting minion the impulse back.
export function addEnvironmentalDamage(
    host: CombatHost,
    combat: CombatBase,
    combatant: CombatantBase,
    amount: number,
): string[] {
    const opposing = opposingOf(combat, combatant)
    opposing.environmentalDamage += amount
    combat.impulsePlayer = host.owner(combat.acting)
    return [`${host.name(opposing)} will take ${amount} environmental damage each round`]
}

export function chooseStrike(
    host: CombatHost,
    combat: CombatBase,
    combatant: CombatantBase,
    strike: StrikeBase,
    additional?: AdditionalStrikeGain,
): string[] {
    const name = host.name(combatant)
    const log = [`${name} strikes: ${strike.name}`]
    combatant.strike = strike
    if (strike.onceKey) {
        combat.usedOnce.push(strike.onceKey)
    }
    if (additional) {
        combatant.additionalStrikes++
        combatant.limitedAdditionalGained ||= additional.limited
        log.push(`${name} gains an additional strike`)
    }
    advanceStrikeChoices(host, combat, log)
    return log
}

// Playing something in a window gives the acting minion the impulse back
export function addStrikes(
    host: CombatHost,
    combat: CombatBase,
    combatant: CombatantBase,
    gain: AdditionalStrikeGain,
): string[] {
    combatant.additionalStrikes++
    combatant.limitedAdditionalGained ||= gain.limited
    combat.impulsePlayer = host.owner(combat.acting)
    return [`${host.name(combatant)} gains an additional strike`]
}

// Only hand strikes for the round, and what the grapple gives besides
export function grapple(
    host: CombatHost,
    combat: CombatBase,
    combatant: CombatantBase,
    press: boolean,
    closeNextRound: boolean,
): string[] {
    combat.handStrikesOnly = true
    if (press) {
        combatant.pressesGranted++
    }
    if (closeNextRound) {
        combat.closeNextRound = true
    }
    combat.impulsePlayer = host.owner(combat.acting)
    return [`${host.name(combatant)} grapples: only hand strikes this round`]
}

export function gainBlood(
    host: CombatHost,
    combat: CombatBase,
    combatant: CombatantBase,
    amount: number,
): string[] {
    const blood = host.blood(combatant)
    const gained = Math.max(0, Math.min(amount, host.capacity(combatant) - blood))
    host.setBlood(combatant, blood + gained)
    combat.impulsePlayer = host.owner(combat.acting)
    return [`${host.name(combatant)} gains ${gained} blood`]
}

export function takeStrengthBonus(
    host: CombatHost,
    combat: CombatBase,
    combatant: CombatantBase,
): string[] {
    combatant.strength += combatant.strengthBonus
    const log = [`${host.name(combatant)} gains ${combatant.strengthBonus} strength`]
    combatant.strengthBonus = 0
    combat.impulsePlayer = host.owner(combat.acting)
    return log
}

export function markCardPlayed(combat: CombatBase, minionKey: string, cardKey: string): void {
    combat.playedThisRound[minionKey] = [...(combat.playedThisRound[minionKey] ?? []), cardKey]
    combat.playedThisCombat[minionKey] = [...(combat.playedThisCombat[minionKey] ?? []), cardKey]
}

// A press to continue, or the cancellation of the opposing one. A granted press is used up.
export function playPress(
    host: CombatHost,
    combat: CombatBase,
    combatant: CombatantBase,
    granted = false,
): string[] {
    if (granted) {
        combatant.pressesGranted--
    }

    combat.pressed = !combat.pressed
    const owner = host.owner(combatant)
    combat.lastPlayedBy = owner
    combat.impulsePlayer = opposingOwner(host, combat, owner)
    return [
        `${host.name(combatant)} ${combat.pressed ? 'presses to continue' : 'cancels the press'}`,
    ]
}

export function preventDamage(
    host: CombatHost,
    combat: CombatBase,
    combatant: CombatantBase,
    amount: number,
    aggravated: boolean,
    sourceKey?: string,
): string[] {
    if (sourceKey) {
        combat.attachedPreventions.push(sourceKey)
    }

    if (aggravated) {
        combatant.pendingDamage.aggravated -= amount
    } else {
        combatant.pendingDamage.regular -= amount
    }
    return [`${host.name(combatant)} prevents ${amount}${aggravated ? ' aggravated' : ''} damage`]
}
