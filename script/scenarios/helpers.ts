import { Vampire, Minion, LibraryCard } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { botMutations } from '@/shared/state/botMutations.ts'
import { createCombatState, getCombatant, createHandStrike } from '@/shared/state/combatState.ts'
import {
    CombatState,
    Validity,
    CombatStep,
    CombatStrike,
    DisciplineUse,
} from '@/shared/types/state.ts'
import { createHeadlessGame } from '../harness.ts'
import { GovernDeck } from '@/shared/bot/decks.ts'
import { getDecidingPlayer, getDecisionPoint, applyOption } from '@/shared/bot/referee.ts'
import { CardSummary, summarizeCardId } from '@/shared/bot/utility/summaries.ts'
import { DecisionKind } from '@/shared/bot/types.ts'

export type Scenario = { name: string; run: () => void }

/**
 * Hand-built combats checked against the rulebook. The harness only
 * ever plays hand strikes, so everything a card could add (dodge, first strike,
 * aggravated damage, steal blood, maneuvers, presses, damage prevention...) is
 * checked here by driving the combat mutations directly.
 */

export class ScenarioFailure extends Error {}

export type Fight = {
    gameState: GameState
    acting: Vampire
    defending: Vampire
    actingPlayer: Player
    defendingPlayer: Player
}

export const createdGames: GameState[] = []

export function readyVampire(gameState: GameState, player: Player, blood: number): Vampire {
    const vampire = player.vampiresInUncontrolled[0]
    gameState.moveCardToRegion(vampire, player.ready)
    vampire.blood = blood
    return vampire
}

// A given crypt card, still in the crypt or among the uncontrolled vampires, made ready
export function readySpecific(
    gameState: GameState,
    player: Player,
    krcgId: string,
    blood: number,
): Vampire {
    // The random draw may already have put it in play
    const vampire = [
        ...player.crypt.cards,
        ...player.uncontrolled.cards,
        ...player.ready.cards,
        ...player.torpor.cards,
    ].find(card => card.krcgId == krcgId)
    if (!vampire?.isVampire()) {
        throw new ScenarioFailure(`The vampire ${krcgId} is not in the crypt`)
    }
    if (!vampire.isIn.ready) {
        gameState.moveCardToRegion(vampire, player.ready)
    }
    vampire.blood = blood
    return vampire
}

export function createFight(actingBlood: number, defendingBlood: number, deck = GovernDeck): Fight {
    const { gameState, players } = createHeadlessGame([deck, deck])
    createdGames.push(gameState)
    const [actingPlayer, defendingPlayer] = players
    const acting = readyVampire(gameState, actingPlayer, actingBlood)
    const defending = readyVampire(gameState, defendingPlayer, defendingBlood)
    gameState.combat = createCombatState(acting, defending)
    return { gameState, acting, defending, actingPlayer, defendingPlayer }
}

export function getCombat(fight: Fight): CombatState {
    if (!fight.gameState.combat) {
        throw new ScenarioFailure('The combat is over')
    }
    return fight.gameState.combat
}

export function must(validity: Validity, what: string): void {
    if (!validity.isValid) {
        throw new ScenarioFailure(`${what} refused: ${validity.reason}`)
    }
}

export function mustRefuse(validity: Validity, what: string): void {
    if (validity.isValid) {
        throw new ScenarioFailure(`${what} should have been refused`)
    }
}

export function expectEqual(actual: unknown, expected: unknown, what: string): void {
    if (actual !== expected) {
        throw new ScenarioFailure(`${what}: expected ${String(expected)}, got ${String(actual)}`)
    }
}

export function expectStep(fight: Fight, step: CombatStep | null): void {
    expectEqual(fight.gameState.combat?.step ?? null, step, 'combat step')
}

export function expectRegion(minion: Minion, region: 'ready' | 'torpor' | 'ashHeap'): void {
    expectEqual(minion.isIn[region], true, `${minion.name} in ${region}`)
}

// Passes the impulse until the combat reaches the step ( or ends if null )
export function passUntil(fight: Fight, step: CombatStep | null): void {
    for (let i = 0; i < 40; i++) {
        const combat = fight.gameState.combat
        if ((combat?.step ?? null) == step) {
            return
        }
        if (!combat) {
            throw new ScenarioFailure(`The combat ended before the ${step} step`)
        }
        must(botMutations.COMBAT_pass.act(combat.impulsePlayer, {}), `pass in ${combat.step}`)
    }
    throw new ScenarioFailure(`The ${step} step was not reached`)
}

export const pass = (player: Player, what: string) =>
    must(botMutations.COMBAT_pass.act(player, {}), what)

export const maneuver = (player: Player, minion: Minion, strike?: CombatStrike) =>
    must(botMutations.COMBAT_maneuver.act(player, { minion, strike }), 'maneuver')

export const press = (player: Player, minion: Minion) =>
    must(botMutations.COMBAT_press.act(player, { minion }), 'press')

// Plays the strike step: acting minion first. Defaults to a hand strike.
export function strikes(
    fight: Fight,
    actingStrike?: CombatStrike,
    defendingStrike?: CombatStrike,
): void {
    expectStep(fight, CombatStep.Strike)
    for (const [minion, player, strike] of [
        [fight.acting, fight.actingPlayer, actingStrike],
        [fight.defending, fight.defendingPlayer, defendingStrike],
    ] as const) {
        const combat = fight.gameState.combat
        const combatant = combat && getCombatant(combat, minion)
        if (!combatant || combatant.strike) {
            continue
        }
        must(
            botMutations.COMBAT_chooseStrike.act(player, {
                minion,
                strike: strike ?? createHandStrike(combatant),
            }),
            `${minion.name} strikes`,
        )
    }
}

// Goes to the strike step and plays it
export function strikeRound(
    fight: Fight,
    actingStrike?: CombatStrike,
    defendingStrike?: CombatStrike,
): void {
    passUntil(fight, CombatStep.Strike)
    strikes(fight, actingStrike, defendingStrike)
}

// Plays the round and the damage resolution, until the end of round step
export function strikeRoundToEnd(
    fight: Fight,
    actingStrike?: CombatStrike,
    defendingStrike?: CombatStrike,
): void {
    strikeRound(fight, actingStrike, defendingStrike)
    passUntil(fight, CombatStep.EndOfRound)
}

// Sets the combat in the damage resolution of a victim, with the damage already inflicted
export function damageResolution(
    fight: Fight,
    victim: Minion,
    regular: number,
    aggravated: number,
) {
    const combat = getCombat(fight)
    const combatant = getCombatant(combat, victim)
    if (!combatant) {
        throw new ScenarioFailure('Not a combatant')
    }
    combatant.pendingDamage = { regular, aggravated }
    combat.step = CombatStep.DamageResolution
    combat.resolvedStrikeTier = 2
    combat.impulsePlayer = victim.controller
}

// The setup deals a random hand, so a card can be in the library or already in the hand
export function findCard(player: Player, krcgId: string): LibraryCard {
    const card = [...player.library.cards, ...player.hand.cards].find(
        candidate => candidate.krcgId == krcgId,
    )
    if (!(card instanceof LibraryCard)) {
        throw new ScenarioFailure(`Card ${krcgId} is neither in the library nor in the hand`)
    }
    return card
}

// Cards handed out by a scenario stay in hand
export const givenCards = new WeakSet<LibraryCard>()

// A bot over its hand size has to discard first: the hand stays at its size, so a card given
// takes the place of one dealt by the setup
export function giveCard(gameState: GameState, player: Player, krcgId: string): LibraryCard {
    const card = findCard(player, krcgId)
    if (card.region == player.hand) {
        givenCards.add(card)
        return card
    }
    if (player.hand.length >= player.handSize) {
        const dealt = player.hand.cards.find(
            candidate => candidate instanceof LibraryCard && !givenCards.has(candidate),
        )
        if (dealt) {
            gameState.moveCardToRegion(dealt, player.library)
        }
    }
    gameState.moveCardToRegion(card, player.hand)
    givenCards.add(card)
    return card
}

// Once an action or a combat is over, the bot holding its cards has a forced cleanup decision, which
// comes first even when that bot is not the active player
export function applyPendingCleanup(gameState: GameState, expected: Player): void {
    const decider = getDecidingPlayer(gameState)
    expectEqual(decider, expected, 'the bot that cleans up')
    const cleanup = decider && getDecisionPoint(gameState, decider)
    if (cleanup?.kind != DecisionKind.Cleanup) {
        throw new ScenarioFailure(`Expected a cleanup, got ${cleanup?.kind}`)
    }
    applyOption(cleanup, cleanup.options[0])
}

// Puts the card in play attached to the minion, as an equip action would have
export function attachInPlay(
    card: LibraryCard,
    minion: Minion,
    options: { life?: number; disciplines?: DisciplineUse[] } = {},
): void {
    const player = minion.controller
    player.gameState.moveCardToRegion(card, player.ready)
    must(
        botMutations.attachCard.act(player, { card, minion, disciplines: options.disciplines }),
        'attach',
    )
    if (options.life) {
        card.blood = options.life
    }
}

/**
 * Play summaries: what the scorer reads of a card, from the catalog.
 */

export function summaryOf(id: string): CardSummary {
    const summary = summarizeCardId(id)
    if (!summary) {
        throw new ScenarioFailure(`No summary for ${id}`)
    }
    return summary
}
