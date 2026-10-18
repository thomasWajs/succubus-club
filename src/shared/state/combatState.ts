import { Card, LibraryCard, Minion } from '@/shared/model/Card.ts'
import { endAction } from '@/shared/state/actionState.ts'
import { Player } from '@/shared/model/Player.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { getHost, syncAttachedCards } from '@/shared/state/attachments.ts'
import { getEnvironmentalDamage, getMinionStrength } from '@/shared/cardImpl/catalog/attached.ts'
import { GRID_SIZE, TORPOR_ZONE_Y } from '@/shared/const/game.ts'
import {
    CombatantMinion,
    CombatState,
    CombatStrike,
    Invalid,
    VALID,
    Validity,
} from '@/shared/types/state.ts'
import * as rules from '@/shared/state/combatRules.ts'
import type { Actor, AdditionalStrikeGain, CombatHost } from '@/shared/state/combatRules.ts'

/**
 * Combat in the game
 *
 * The rules themselves ( the seven steps, strikes, damage ) are in combatRules.ts. This is what ties
 * them to the game: the combatants are minions of a GameState, whose blood, region and attached cards
 * are read and changed through a CombatHost. The functions here are meant to be called from combat
 * mutations ( every client applies the same mutation, so the result is the same everywhere ). Each
 * move returns the log lines describing what happened.
 *
 * Equipment and retainers are attached to their minion ( attachments.ts ), which they follow to
 * torpor and burn with. A weapon gives its bearer a strike ( and maybe a maneuver once per
 * combat ), a strike can be aimed at a retainer of the opposing minion.
 */

/**
 * Creation
 */

export function createCombatantMinion(minion: Minion): CombatantMinion {
    return {
        ...rules.newCombatantFields(getMinionStrength(minion)),
        minion,
        strike: null,
    }
}

export function createCombatState(acting: Minion, defending: Minion): CombatState {
    return {
        acting: createCombatantMinion(acting),
        defending: createCombatantMinion(defending),
        ...rules.newCombatFields(acting.controller),
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
        controller.hand.cards.some(card => card instanceof LibraryCard && card.isType.reaction)
    if (!canPlay) {
        endAction(gameState)
    }
}

// A minion enters combat with another one ( an action, not a block ): the combat starts at once
export function startCombat(gameState: GameState, acting: Minion, defending: Minion): void {
    gameState.combat = createCombatState(acting, defending)
}

export function createStrike(name: string, overrides: Partial<CombatStrike> = {}): CombatStrike {
    return { ...rules.newStrike(name), source: null, ...overrides }
}

// The default strike: damage equal to the strength, at close range only
export function createHandStrike(combatant: CombatantMinion): CombatStrike {
    return createStrike('Hand strike', { damage: combatant.strength, isHand: true })
}

export function createDodgeStrike(source: Card | null = null): CombatStrike {
    return createStrike('Dodge', { source, dodge: true })
}

export function createCombatEndsStrike(source: Card | null = null): CombatStrike {
    return createStrike('Combat ends', { source, combatEnds: true })
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
    return rules.opposingOf(combat, combatant)
}

export function getOpposingPlayer(combat: CombatState, player: Player): Player {
    return combat.acting.minion.controller == player ?
            combat.defending.minion.controller
        :   combat.acting.minion.controller
}

export function isCombatReady(combatant: CombatantMinion): boolean {
    return combatant.minion.isIn.ready
}

/**
 * What the rules ask of the game
 */

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

function createHost(gameState: GameState): CombatHost {
    const host: CombatHost = {
        name: (combatant: CombatantMinion) => combatant.minion.name,
        owner: (combatant: CombatantMinion) => combatant.minion.controller,
        ready: isCombatReady,
        isVampire: (combatant: CombatantMinion) => combatant.minion.isVampire(),
        blood: (combatant: CombatantMinion) => combatant.minion.blood,
        setBlood: (combatant: CombatantMinion, blood: number) => {
            combatant.minion.blood = blood
        },
        capacity: (combatant: CombatantMinion) => combatant.minion.minionAttrs.capacity,
        environmentalFrom: (source: CombatantMinion) => getEnvironmentalDamage(source.minion),
        sendToTorpor: (combatant: CombatantMinion) => sendToTorpor(gameState, combatant.minion),
        burn: (combatant: CombatantMinion) => burnMinion(gameState, combatant.minion),
        retainerValidity: (opposing: CombatantMinion, strike: CombatStrike) =>
            !strike.retainer || getHost(strike.retainer) == opposing.minion ?
                VALID
            :   Invalid(`${strike.retainer.name} is not a retainer of the opposing minion`),
        hitRetainer: (
            target: CombatantMinion,
            strike: CombatStrike,
            who: string,
            log: string[],
        ) => {
            if (strike.retainer) {
                hitRetainer(gameState, target, strike.retainer, strike.damage, who, log)
            }
        },
        settleDamage: (combatant: CombatantMinion, log: string[]) => {
            if (combatant.minion.controller.isBot) {
                rules.resolveDamage(host, combatant, log)
            } else {
                leaveDamageToHand(combatant, log)
            }
        },
        close: () => closeCombat(gameState),
    }
    return host
}

function actorOf(combat: CombatState | null, minion: Minion): Actor {
    return { combatant: combat && getCombatant(combat, minion), name: minion.name }
}

function getActiveCombat(gameState: GameState): CombatState {
    if (!gameState.combat) {
        throw new Error('gameState.combat is null')
    }
    return gameState.combat
}

// What a move changes: the rules, the combat and the combatant of the minion
function moveOf(gameState: GameState, minion: Minion) {
    const combat = getActiveCombat(gameState)
    const combatant = getCombatant(combat, minion)
    if (!combatant) {
        throw new Error(`${minion.name} is not in this combat`)
    }
    return { host: createHost(gameState), combat, combatant }
}

// A validity check of the rules, for the minion
function checked<Args extends unknown[]>(
    check: (host: CombatHost, combat: CombatState | null, actor: Actor, ...args: Args) => Validity,
    gameState: GameState,
    minion: Minion,
    ...args: Args
): Validity {
    return check(
        createHost(gameState),
        gameState.combat,
        actorOf(gameState.combat, minion),
        ...args,
    )
}

/**
 * Validity of the moves. They all require the impulse, except ending the combat by hand.
 */

export function canPass(gameState: GameState): Validity {
    return rules.checkPass(gameState.combat)
}

// The maneuver of a weapon ( `weapon` ) comes with its strike, and is given once per combat
export function canManeuver(
    gameState: GameState,
    minion: Minion,
    strike?: CombatStrike,
    weapon?: Card,
    free?: boolean,
): Validity {
    return checked(rules.checkManeuver, gameState, minion, { strike, weaponKey: weapon?.oid, free })
}

export function canChooseStrike(
    gameState: GameState,
    minion: Minion,
    strike?: CombatStrike,
    additional?: AdditionalStrikeGain,
): Validity {
    return checked(rules.checkChooseStrike, gameState, minion, strike, additional)
}

export function canAddStrikes(
    gameState: GameState,
    minion: Minion,
    gain: AdditionalStrikeGain,
): Validity {
    return checked(rules.checkAddStrikes, gameState, minion, gain)
}

export function canSetStrength(gameState: GameState, minion: Minion): Validity {
    return checked(rules.checkSetStrength, gameState, minion)
}

export function canAddEnvironmentalDamage(gameState: GameState, minion: Minion): Validity {
    return checked(rules.checkAddEnvironmentalDamage, gameState, minion)
}

export function canPress(gameState: GameState, minion: Minion, granted = false): Validity {
    return checked(rules.checkPress, gameState, minion, granted)
}

export function canGrapple(gameState: GameState, minion: Minion): Validity {
    return checked(rules.checkGrapple, gameState, minion)
}

export function canGainBlood(gameState: GameState, minion: Minion): Validity {
    return checked(rules.checkGainBlood, gameState, minion)
}

export function canTakeStrengthBonus(gameState: GameState, minion: Minion): Validity {
    return checked(rules.checkTakeStrengthBonus, gameState, minion)
}

export function canPreventDamage(
    gameState: GameState,
    minion: Minion,
    amount: number,
    aggravated: boolean,
    source?: Card,
): Validity {
    return checked(rules.checkPreventDamage, gameState, minion, amount, aggravated, source?.oid)
}

export function canApplyDamage(gameState: GameState, minion: Minion): Validity {
    return checked(rules.checkApplyDamage, gameState, minion)
}

/**
 * Moves. Each assumes the matching can...() check passed.
 */

// The current window is done for the impulse player
export function passCombatImpulse(gameState: GameState): string[] {
    return rules.passImpulse(createHost(gameState), getActiveCombat(gameState))
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
    const { host, combat, combatant } = moveOf(gameState, minion)
    return rules.playManeuver(host, combat, combatant, { strike, weaponKey: weapon?.oid, free })
}

export function setStrength(gameState: GameState, minion: Minion, strength: number): string[] {
    const { host, combat, combatant } = moveOf(gameState, minion)
    return rules.setStrength(host, combat, combatant, strength)
}

export function addEnvironmentalDamage(
    gameState: GameState,
    minion: Minion,
    amount: number,
): string[] {
    const { host, combat, combatant } = moveOf(gameState, minion)
    return rules.addEnvironmentalDamage(host, combat, combatant, amount)
}

export function chooseStrike(
    gameState: GameState,
    minion: Minion,
    strike: CombatStrike,
    additional?: AdditionalStrikeGain,
): string[] {
    const { host, combat, combatant } = moveOf(gameState, minion)
    return rules.chooseStrike(host, combat, combatant, strike, additional)
}

export function addStrikes(
    gameState: GameState,
    minion: Minion,
    gain: AdditionalStrikeGain,
): string[] {
    const { host, combat, combatant } = moveOf(gameState, minion)
    return rules.addStrikes(host, combat, combatant, gain)
}

export function grapple(
    gameState: GameState,
    minion: Minion,
    press: boolean,
    closeNextRound: boolean,
): string[] {
    const { host, combat, combatant } = moveOf(gameState, minion)
    return rules.grapple(host, combat, combatant, press, closeNextRound)
}

export function gainBlood(gameState: GameState, minion: Minion, amount: number): string[] {
    if (!minion.isVampire()) {
        throw new Error(`${minion.name} is not a vampire`)
    }
    const { host, combat, combatant } = moveOf(gameState, minion)
    return rules.gainBlood(host, combat, combatant, amount)
}

export function takeStrengthBonus(gameState: GameState, minion: Minion): string[] {
    const { host, combat, combatant } = moveOf(gameState, minion)
    return rules.takeStrengthBonus(host, combat, combatant)
}

export function markCombatCardPlayed(gameState: GameState, minion: Minion, krcgId: string): void {
    rules.markCardPlayed(getActiveCombat(gameState), minion.oid, krcgId)
}

// A press to continue, or the cancellation of the opposing one. A granted press is used up.
export function playPress(gameState: GameState, minion: Minion, granted = false): string[] {
    const { host, combat, combatant } = moveOf(gameState, minion)
    return rules.playPress(host, combat, combatant, granted)
}

export function preventDamage(
    gameState: GameState,
    minion: Minion,
    amount: number,
    aggravated: boolean,
    source?: Card,
): string[] {
    const { host, combat, combatant } = moveOf(gameState, minion)
    return rules.preventDamage(host, combat, combatant, amount, aggravated, source?.oid)
}

// Applies the pending damage of a minion now, instead of leaving it to be applied by hand.
// The window stays open: the combat goes on when the players pass.
export function applyDamageNow(gameState: GameState, minion: Minion): string[] {
    const { host, combatant } = moveOf(gameState, minion)
    const log: string[] = []
    rules.resolveDamage(host, combatant, log)
    return log
}

// Stops the combat on the spot, nothing more is resolved
export function endCombatNow(gameState: GameState): string[] {
    closeCombat(gameState)
    return ['Combat ended']
}
