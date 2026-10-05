// Hand-built combat scenarios checked against the rulebook. Run from the repo root:
//   npx tsx script/combatScenarios.ts
// Exits with code 1 if any scenario fails.
import { readFileSync } from 'node:fs'
import { Card, LibraryCard, Minion, Vampire } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { deleteGameState, registerLogger, setGameResources } from '@/shared/registries.ts'
import { initWasmHasher } from '@/shared/serialization.ts'
import {
    createCombatState,
    createDodgeStrike,
    createHandStrike,
    createStrike,
    getCombatant,
} from '@/shared/state/combatState.ts'
import {
    CombatRange,
    CombatState,
    CombatStep,
    CombatStrike,
    MinionActionType,
    Validity,
} from '@/shared/types/state.ts'
import {
    Discipline,
    DisciplineLevel,
    LEAVE_TORPOR_COST,
    TurnPhase,
    TurnSequence,
} from '@/shared/const/model.ts'
import { CARD_HEIGHT } from '@/shared/const/game.ts'
import {
    BEHIND_YOU_ID,
    DEFLECTION_ID,
    FAR_MASTERY_ID,
    GOVERN_ID,
} from '@/shared/cardImpl/cardIds.ts'
import { findOption } from '@/shared/bot/helpers.ts'
import { createBleedAction, createHuntAction } from '@/shared/state/minionActionFactories.ts'
import { GovernAgent } from '@/shared/bot/agents/governAgent.ts'
import { createHeadlessGame, registerSyncMutationTrigger } from './harness.ts'
import { GovernDeck } from '@/shared/bot/decks.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { applyOption, getDecidingPlayer, getDecisionPoint } from '@/shared/bot/referee.ts'
import { stepBot } from '@/shared/bot/driver.ts'
import { BaseAgent } from '@/shared/bot/agents/baseAgent.ts'
import { BotOption, DecisionPoint, optionsOfType } from '@/shared/bot/types.ts'

/**
 * Hand-built combats checked against the rulebook (combat.md). The harness only
 * ever plays hand strikes, so everything a card could add (dodge, first strike,
 * aggravated damage, steal blood, maneuvers, presses, damage prevention...) is
 * checked here by driving the combat mutations directly.
 */

class ScenarioFailure extends Error {}

type Fight = {
    gameState: GameState
    acting: Vampire
    defending: Vampire
    actingPlayer: Player
    defendingPlayer: Player
}

const createdGames: GameState[] = []

function readyVampire(gameState: GameState, player: Player, blood: number): Vampire {
    const vampire = player.vampiresInUncontrolled[0]
    gameState.moveCardToRegion(vampire, player.ready)
    vampire.blood = blood
    return vampire
}

function createFight(actingBlood: number, defendingBlood: number): Fight {
    const { gameState, players } = createHeadlessGame([GovernDeck, GovernDeck])
    createdGames.push(gameState)
    const [actingPlayer, defendingPlayer] = players
    const acting = readyVampire(gameState, actingPlayer, actingBlood)
    const defending = readyVampire(gameState, defendingPlayer, defendingBlood)
    gameState.combat = createCombatState(acting, defending)
    return { gameState, acting, defending, actingPlayer, defendingPlayer }
}

function getCombat(fight: Fight): CombatState {
    if (!fight.gameState.combat) {
        throw new ScenarioFailure('The combat is over')
    }
    return fight.gameState.combat
}

function must(validity: Validity, what: string): void {
    if (!validity.isValid) {
        throw new ScenarioFailure(`${what} refused: ${validity.reason}`)
    }
}

function mustRefuse(validity: Validity, what: string): void {
    if (validity.isValid) {
        throw new ScenarioFailure(`${what} should have been refused`)
    }
}

function expectEqual(actual: unknown, expected: unknown, what: string): void {
    if (actual !== expected) {
        throw new ScenarioFailure(`${what}: expected ${String(expected)}, got ${String(actual)}`)
    }
}

function expectStep(fight: Fight, step: CombatStep | null): void {
    expectEqual(fight.gameState.combat?.step ?? null, step, 'combat step')
}

function expectRegion(minion: Minion, region: 'ready' | 'torpor' | 'ashHeap'): void {
    expectEqual(minion.isIn[region], true, `${minion.name} in ${region}`)
}

// Passes the impulse until the combat reaches the step ( or ends if null )
function passUntil(fight: Fight, step: CombatStep | null): void {
    for (let i = 0; i < 40; i++) {
        const combat = fight.gameState.combat
        if ((combat?.step ?? null) == step) {
            return
        }
        if (!combat) {
            throw new ScenarioFailure(`The combat ended before the ${step} step`)
        }
        must(gameMutations.COMBAT_pass.act(combat.impulsePlayer, {}), `pass in ${combat.step}`)
    }
    throw new ScenarioFailure(`The ${step} step was not reached`)
}

const pass = (player: Player, what: string) => must(gameMutations.COMBAT_pass.act(player, {}), what)

const maneuver = (player: Player, minion: Minion, strike?: CombatStrike) =>
    must(gameMutations.COMBAT_maneuver.act(player, { minion, strike }), 'maneuver')

const press = (player: Player, minion: Minion) =>
    must(gameMutations.COMBAT_press.act(player, { minion }), 'press')

// Plays the strike step: acting minion first. Defaults to a hand strike.
function strikes(fight: Fight, actingStrike?: CombatStrike, defendingStrike?: CombatStrike): void {
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
            gameMutations.COMBAT_chooseStrike.act(player, {
                minion,
                strike: strike ?? createHandStrike(combatant),
            }),
            `${minion.name} strikes`,
        )
    }
}

// Goes to the strike step and plays it
function strikeRound(
    fight: Fight,
    actingStrike?: CombatStrike,
    defendingStrike?: CombatStrike,
): void {
    passUntil(fight, CombatStep.Strike)
    strikes(fight, actingStrike, defendingStrike)
}

// Plays the round and the damage resolution, until the end of round step
function strikeRoundToEnd(
    fight: Fight,
    actingStrike?: CombatStrike,
    defendingStrike?: CombatStrike,
): void {
    strikeRound(fight, actingStrike, defendingStrike)
    passUntil(fight, CombatStep.EndOfRound)
}

// Sets the combat in the damage resolution of a victim, with the damage already inflicted
function damageResolution(fight: Fight, victim: Minion, regular: number, aggravated: number) {
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

const SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'a round of hand strikes: 1 damage each, mended, no press so the combat ends',
        run() {
            const fight = createFight(3, 3)
            strikeRound(fight)
            passUntil(fight, null)
            expectEqual(fight.acting.blood, 2, 'acting blood')
            expectEqual(fight.defending.blood, 2, 'defending blood')
            expectRegion(fight.acting, 'ready')
            expectRegion(fight.defending, 'ready')
        },
    },
    {
        name: 'the strike step cannot be passed, and strikes are chosen in order',
        run() {
            const fight = createFight(3, 3)
            passUntil(fight, CombatStep.Strike)
            mustRefuse(gameMutations.COMBAT_pass.act(fight.actingPlayer, {}), 'pass')
            mustRefuse(
                gameMutations.COMBAT_chooseStrike.act(fight.defendingPlayer, {
                    minion: fight.defending,
                    strike: createHandStrike(getCombat(fight).defending),
                }),
                'strike out of order',
            )
        },
    },
    {
        name: 'only the impulse player can move, and only in the matching step',
        run() {
            const fight = createFight(3, 3)
            mustRefuse(gameMutations.COMBAT_pass.act(fight.defendingPlayer, {}), 'pass out of turn')
            mustRefuse(
                gameMutations.COMBAT_maneuver.act(fight.actingPlayer, { minion: fight.acting }),
                'maneuver before the range step',
            )
            mustRefuse(
                gameMutations.COMBAT_press.act(fight.actingPlayer, { minion: fight.acting }),
                'press before the press step',
            )
        },
    },
    {
        name: 'a maneuver to long range: hand strikes do nothing, a ranged strike works',
        run() {
            const fight = createFight(3, 3)
            passUntil(fight, CombatStep.DetermineRange)
            maneuver(fight.actingPlayer, fight.acting)
            expectEqual(getCombat(fight).range, CombatRange.Long, 'range')
            // The impulse went to the opponent: no second maneuver in a row
            mustRefuse(
                gameMutations.COMBAT_maneuver.act(fight.actingPlayer, { minion: fight.acting }),
                'second maneuver in a row',
            )
            strikeRound(fight, createStrike('Gun', { damage: 2, ranged: true }))
            passUntil(fight, null)
            expectEqual(fight.acting.blood, 3, 'acting blood (hand strike at long range)')
            expectEqual(fight.defending.blood, 1, 'defending blood (ranged strike)')
        },
    },
    {
        name: 'maneuvers offset each other, passing facing a maneuver closes the window',
        run() {
            const fight = createFight(3, 3)
            passUntil(fight, CombatStep.DetermineRange)
            maneuver(fight.actingPlayer, fight.acting)
            maneuver(fight.defendingPlayer, fight.defending)
            expectEqual(getCombat(fight).range, CombatRange.Close, 'range back to close')
            maneuver(fight.actingPlayer, fight.acting)
            expectEqual(getCombat(fight).range, CombatRange.Long, 'range long again')
            pass(fight.defendingPlayer, 'defending passes')
            expectStep(fight, CombatStep.BeforeStrikes)
        },
    },
    {
        name: 'the acting minion passes, the opponent maneuvers, the acting minion can answer',
        run() {
            const fight = createFight(3, 3)
            passUntil(fight, CombatStep.DetermineRange)
            pass(fight.actingPlayer, 'acting passes')
            expectStep(fight, CombatStep.DetermineRange)
            maneuver(fight.defendingPlayer, fight.defending)
            expectEqual(getCombat(fight).impulsePlayer, fight.actingPlayer, 'impulse back')
            pass(fight.actingPlayer, 'acting passes again')
            expectStep(fight, CombatStep.BeforeStrikes)
            expectEqual(getCombat(fight).range, CombatRange.Long, 'range')
        },
    },
    {
        name: 'a maneuver from a strike card chooses the strike of the round',
        run() {
            const fight = createFight(3, 3)
            passUntil(fight, CombatStep.DetermineRange)
            const gun = createStrike('Gun', { damage: 2, ranged: true })
            maneuver(fight.actingPlayer, fight.acting, gun)
            pass(fight.defendingPlayer, 'defending passes')
            passUntil(fight, CombatStep.Strike)
            // The acting minion is skipped: its strike is already chosen
            expectEqual(getCombat(fight).impulsePlayer, fight.defendingPlayer, 'strike impulse')
            strikes(fight)
            passUntil(fight, null)
            expectEqual(fight.defending.blood, 1, 'defending blood')
            expectEqual(fight.acting.blood, 3, 'acting blood (hand strike at long range)')
        },
    },
    {
        name: 'a dodge protects from a hand strike',
        run() {
            const fight = createFight(3, 3)
            strikeRound(fight, undefined, createDodgeStrike())
            passUntil(fight, null)
            expectEqual(fight.acting.blood, 3, 'acting blood')
            expectEqual(fight.defending.blood, 3, 'defending blood')
        },
    },
    {
        name: 'a dodge protects from first strike aggravated damage',
        run() {
            const fight = createFight(3, 1)
            strikeRound(
                fight,
                createStrike('Claws', { damage: 3, aggravated: true, firstStrike: true }),
                createDodgeStrike(),
            )
            passUntil(fight, null)
            expectEqual(fight.defending.blood, 1, 'defending blood')
            expectRegion(fight.defending, 'ready')
        },
    },
    {
        name: 'first strike: the victim goes to torpor and its own strike is lost',
        run() {
            const fight = createFight(3, 1)
            strikeRoundToEnd(fight, createStrike('Quick', { damage: 2, firstStrike: true }))
            // 1 damage mended with the last blood, 1 not: wounded
            expectEqual(fight.defending.blood, 0, 'defending blood')
            expectRegion(fight.defending, 'torpor')
            passUntil(fight, null)
            expectEqual(fight.acting.blood, 3, 'the defending strike was never resolved')
        },
    },
    {
        name: 'first strike from both minions resolves simultaneously',
        run() {
            const fight = createFight(3, 3)
            const quick = createStrike('Quick', { damage: 1, firstStrike: true })
            strikeRound(fight, quick, quick)
            passUntil(fight, null)
            expectEqual(fight.acting.blood, 2, 'acting blood')
            expectEqual(fight.defending.blood, 2, 'defending blood')
        },
    },
    {
        name: 'combat ends resolves first, nothing else happens, the end of round step still does',
        run() {
            const fight = createFight(3, 3)
            strikeRound(fight, createStrike('Flee', { combatEnds: true }))
            expectStep(fight, CombatStep.EndOfRound)
            passUntil(fight, null)
            expectEqual(fight.acting.blood, 3, 'acting blood')
            expectEqual(fight.defending.blood, 3, 'defending blood')
        },
    },
    {
        name: 'combat ends is not stopped by a dodge',
        run() {
            const fight = createFight(3, 3)
            strikeRound(fight, createStrike('Flee', { combatEnds: true }), createDodgeStrike())
            expectStep(fight, CombatStep.EndOfRound)
        },
    },
    {
        name: 'steal blood happens before damage is mended, and the excess drains off',
        run() {
            const fight = createFight(0, 3)
            const capacity = fight.acting.minionAttrs.capacity
            fight.acting.blood = capacity - 1
            strikeRound(fight, createStrike('Drain', { stealBlood: 2 }))
            passUntil(fight, null)
            // Capacity - 1 + 2 = capacity + 1, capped, then 1 damage mended
            expectEqual(fight.acting.blood, capacity - 1, 'acting blood')
            expectEqual(fight.defending.blood, 1, 'defending blood')
        },
    },
    {
        name: 'a vampire that cannot mend all damage is wounded and goes to torpor',
        run() {
            const fight = createFight(3, 1)
            strikeRoundToEnd(fight, createStrike('Punch', { damage: 3 }))
            expectEqual(fight.defending.blood, 0, 'defending blood')
            expectRegion(fight.defending, 'torpor')
            expectRegion(fight.acting, 'ready')
        },
    },
    {
        name: 'a combatant going to torpor ends the combat: no press step',
        run() {
            const fight = createFight(3, 1)
            strikeRound(fight, createStrike('Punch', { damage: 3 }))
            passUntil(fight, CombatStep.EndOfRound)
            passUntil(fight, null)
        },
    },
    {
        name: 'rulebook, Nassir: 1 blood, 1 aggravated damage: torpor with 1 blood',
        run() {
            const fight = createFight(3, 1)
            strikeRoundToEnd(fight, createStrike('Claws', { damage: 1, aggravated: true }))
            expectEqual(fight.defending.blood, 1, 'defending blood')
            expectRegion(fight.defending, 'torpor')
        },
    },
    {
        name: 'rulebook, Tamoszius: 2 blood, 3 aggravated damage: torpor with 0 blood',
        run() {
            const fight = createFight(3, 2)
            strikeRoundToEnd(fight, createStrike('Claws', { damage: 3, aggravated: true }))
            expectEqual(fight.defending.blood, 0, 'defending blood')
            expectRegion(fight.defending, 'torpor')
        },
    },
    {
        name: 'rulebook, Ryan: 1 blood, 2 normal and 1 aggravated damage: burned',
        run() {
            const fight = createFight(3, 1)
            damageResolution(fight, fight.defending, 2, 1)
            passUntil(fight, CombatStep.EndOfRound)
            expectRegion(fight.defending, 'ashHeap')
        },
    },
    {
        name: 'aggravated damage on a vampire without blood to spare burns it',
        run() {
            const fight = createFight(3, 0)
            strikeRoundToEnd(fight, createStrike('Claws', { damage: 2, aggravated: true }))
            expectRegion(fight.defending, 'ashHeap')
        },
    },
    {
        name: 'damage prevention: victims prevent one at a time, acting minion first',
        run() {
            const fight = createFight(3, 3)
            strikeRound(
                fight,
                createStrike('Punch', { damage: 2 }),
                createStrike('Kick', { damage: 1 }),
            )
            // Both are victims: 1 damage on the acting minion, 2 on the defending one
            expectStep(fight, CombatStep.DamageResolution)
            expectEqual(getCombat(fight).impulsePlayer, fight.actingPlayer, 'first victim')
            must(
                gameMutations.COMBAT_preventDamage.act(fight.actingPlayer, {
                    minion: fight.acting,
                    amount: 1,
                    aggravated: false,
                }),
                'prevent',
            )
            mustRefuse(
                gameMutations.COMBAT_preventDamage.act(fight.actingPlayer, {
                    minion: fight.acting,
                    amount: 1,
                    aggravated: false,
                }),
                'prevent damage that is not there',
            )
            pass(fight.actingPlayer, 'acting victim passes')
            expectEqual(getCombat(fight).impulsePlayer, fight.defendingPlayer, 'second victim')
            pass(fight.defendingPlayer, 'defending victim passes')
            expectEqual(fight.acting.blood, 3, 'acting blood: the damage was prevented')
            expectEqual(fight.defending.blood, 1, 'defending blood: 2 damage mended')
        },
    },
    {
        name: 'a press to continue starts another round',
        run() {
            const fight = createFight(5, 5)
            strikeRound(fight)
            passUntil(fight, CombatStep.Press)
            press(fight.actingPlayer, fight.acting)
            pass(fight.defendingPlayer, 'defending passes')
            passUntil(fight, CombatStep.BeforeRange)
            expectEqual(getCombat(fight).round, 2, 'round')
            expectEqual(getCombat(fight).range, CombatRange.Close, 'range')
            expectEqual(getCombat(fight).acting.strike, null, 'strike of the new round')
            strikeRound(fight)
            passUntil(fight, null)
            expectEqual(fight.acting.blood, 3, 'acting blood after two rounds')
            expectEqual(fight.defending.blood, 3, 'defending blood after two rounds')
        },
    },
    {
        name: 'a press is cancelled by the opponent, and nobody presses twice in a row',
        run() {
            const fight = createFight(5, 5)
            strikeRound(fight)
            passUntil(fight, CombatStep.Press)
            press(fight.actingPlayer, fight.acting)
            mustRefuse(
                gameMutations.COMBAT_press.act(fight.actingPlayer, { minion: fight.acting }),
                'second press in a row',
            )
            press(fight.defendingPlayer, fight.defending)
            expectEqual(getCombat(fight).pressed, false, 'pressed')
            pass(fight.actingPlayer, 'acting passes')
            passUntil(fight, null)
        },
    },
    {
        name: 'an ally burns when it has no life left',
        run() {
            const fight = createFight(3, 1)
            // An ally is a minion that is not a vampire, its life is its blood
            ;(fight.defending as Card).vampireAttrs = undefined
            strikeRoundToEnd(fight, createStrike('Punch', { damage: 2 }))
            expectRegion(fight.defending, 'ashHeap')
        },
    },
    {
        name: 'ending the combat by hand stops everything, whoever has the impulse',
        run() {
            const fight = createFight(3, 3)
            must(gameMutations.COMBAT_end.act(fight.defendingPlayer, {}), 'end combat')
            expectStep(fight, null)
        },
    },
]

/**
 * Torpor actions: what the referee offers in the minion phase once combat sends
 * vampires to torpor, and what they do once nobody blocks.
 */

class PassiveAgent extends BaseAgent {}

type Turn = { gameState: GameState; player: Player; ready: Vampire; torpid: Vampire }

function createMinionPhase(readyBlood: number, torpidBlood: number, deck = GovernDeck): Turn {
    const { gameState, players } = createHeadlessGame([deck, deck])
    createdGames.push(gameState)
    const player = gameState.activePlayer
    if (!player || !players.includes(player)) {
        throw new ScenarioFailure('No active player')
    }
    gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Minion)
    gameState.turnResources.unlocked = true

    const ready = readyVampire(gameState, player, readyBlood)
    const torpid = player.vampiresInUncontrolled[0]
    gameState.moveCardToRegion(torpid, player.torpor)
    torpid.blood = torpidBlood
    return { gameState, player, ready, torpid }
}

function getActionOptions(turn: Turn, type: MinionActionType) {
    const decision = getDecisionPoint(turn.gameState, turn.player)
    if (!decision) {
        throw new ScenarioFailure('No decision point')
    }
    const options = optionsOfType(decision.options, 'declareAction').filter(
        option => option.action.type == type,
    )
    return { decision, options }
}

// Plays the declared action until it resolves, nobody blocking or reacting
function resolveAction(turn: Turn): void {
    const agent = new PassiveAgent()
    for (let i = 0; i < 20 && turn.gameState.action; i++) {
        const player = getDecidingPlayer(turn.gameState)
        if (!player) {
            throw new ScenarioFailure('Nobody has the impulse during the action')
        }
        stepBot(player, agent)
    }
    expectEqual(turn.gameState.action, null, 'action in progress')
}

const TORPOR_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'a torpid vampire with enough blood can leave torpor, the others cannot',
        run() {
            const poor = createMinionPhase(0, LEAVE_TORPOR_COST - 1)
            expectEqual(
                getActionOptions(poor, MinionActionType.LeaveTorpor).options.length,
                0,
                'options',
            )

            const turn = createMinionPhase(0, 3)
            const { decision, options } = getActionOptions(turn, MinionActionType.LeaveTorpor)
            expectEqual(options.length, 1, 'leave torpor offered')
            applyOption(decision, options[0])
            resolveAction(turn)
            expectRegion(turn.torpid, 'ready')
            expectEqual(turn.torpid.blood, 3 - LEAVE_TORPOR_COST, 'blood after leaving torpor')
        },
    },
    {
        name: 'a ready minion can rescue a torpid vampire, the blood is shared as chosen',
        run() {
            const turn = createMinionPhase(2, 1)
            const { decision, options } = getActionOptions(turn, MinionActionType.RescueFromTorpor)
            // 2 blood to pay, the rescued vampire has 1: 1+1 or 2+0, never 0+2
            expectEqual(options.length, 2, 'rescue options')
            const split = options.find(
                option =>
                    option.action.type == MinionActionType.RescueFromTorpor &&
                    option.action.bloodPaidByRescuedMinion == 1,
            )
            if (!split) {
                throw new ScenarioFailure('The 1+1 rescue is not offered')
            }
            applyOption(decision, split)
            resolveAction(turn)
            expectRegion(turn.torpid, 'ready')
            expectEqual(turn.torpid.blood, 0, 'rescued blood')
            expectEqual(turn.ready.blood, 1, 'rescuer blood')
        },
    },
]

/**
 * Costs of action cards. No implemented action card has a cost, so Govern the Unaligned
 * is given one for the scenario.
 */

function withGovernCost<T>(blood: number, pool: number, run: () => T): T {
    const { gameState } = createHeadlessGame([GovernDeck, GovernDeck])
    createdGames.push(gameState)
    const sample = gameState.activePlayer?.library.cards.find(card => card.krcgId == GOVERN_ID)
    const resource = sample?.resource
    if (!resource) {
        throw new ScenarioFailure('No Govern in the library')
    }
    const saved = { blood: resource.blood, pool: resource.pool }
    resource.blood = blood
    resource.pool = pool
    try {
        return run()
    } finally {
        resource.blood = saved.blood
        resource.pool = saved.pool
    }
}

class BlockingAgent extends BaseAgent {
    protected reactionImpulse(decision: DecisionPoint): BotOption {
        return (
            decision.options.find(option => option.type == 'block') ??
            super.reactionImpulse(decision)
        )
    }
}

// Declares the inferior Govern ( a bleed ), then plays the action out with the agent
function playGovernBleed(agent: BaseAgent) {
    const turn = createMinionPhase(5, 0)
    const govern = turn.player.library.cards.find(card => card.krcgId == GOVERN_ID)
    const prey = turn.player.prey
    if (!govern || !prey) {
        throw new ScenarioFailure('No Govern or no prey')
    }
    turn.gameState.moveCardToRegion(govern, turn.player.hand)
    // Someone able to block
    readyVampire(turn.gameState, prey, 3)
    const { decision, options } = getActionOptions(turn, MinionActionType.ActionCardFromHand)
    const bleed = options.find(
        option =>
            option.action.type == MinionActionType.ActionCardFromHand &&
            option.action.card == govern &&
            option.action.usage.disciplines?.[0]?.level == DisciplineLevel.INFERIOR,
    )
    if (!bleed) {
        throw new ScenarioFailure('The inferior Govern is not offered')
    }
    const start = { pool: turn.player.pool, preyPool: prey.pool, blood: turn.ready.blood }
    applyOption(decision, bleed)
    for (let i = 0; i < 20 && turn.gameState.action; i++) {
        const player = getDecidingPlayer(turn.gameState)
        if (!player) {
            throw new ScenarioFailure('Nobody has the impulse during the action')
        }
        stepBot(player, agent)
    }
    expectEqual(turn.gameState.action, null, 'action in progress')
    return { turn, prey, start }
}

const COST_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'an action card pays its costs when it resolves, and the bleed lands',
        run() {
            withGovernCost(1, 1, () => {
                const { turn, prey, start } = playGovernBleed(new PassiveAgent())
                expectEqual(turn.ready.blood, start.blood - 1, 'blood')
                expectEqual(turn.player.pool, start.pool - 1, 'pool')
                // The minion's own bleed, plus the 2 of Govern
                expectEqual(
                    prey.pool,
                    start.preyPool - (turn.ready.minionAttrs.bleed + 2),
                    'prey pool after the bleed',
                )
            })
        },
    },
    {
        name: 'a blocked action pays nothing',
        run() {
            withGovernCost(1, 1, () => {
                const { turn, prey, start } = playGovernBleed(new BlockingAgent())
                if (!turn.gameState.combat) {
                    throw new ScenarioFailure('The block did not start a combat')
                }
                expectEqual(turn.ready.blood, start.blood, 'blood')
                expectEqual(turn.player.pool, start.pool, 'pool')
                expectEqual(prey.pool, start.preyPool, 'prey pool')
            })
        },
    },
]

/**
 * The engine refuses invalid bot declarations (canDeclare), never a human's.
 */

const DECLARE_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'a bot cannot declare with a locked minion, a human can',
        run() {
            const turn = createMinionPhase(5, 0)
            turn.ready.lock()
            mustRefuse(
                gameMutations.ACTION_declareAction.act(turn.player, {
                    minionAction: createHuntAction(turn.ready),
                }),
                'bot hunt with a locked minion',
            )

            turn.player.permId = 'human'
            must(
                gameMutations.ACTION_declareAction.act(turn.player, {
                    minionAction: createHuntAction(turn.ready),
                }),
                'human hunt with a locked minion',
            )
        },
    },
    {
        name: 'a bot cannot bleed a player who is not its prey',
        run() {
            const { gameState, players } = createHeadlessGame([GovernDeck, GovernDeck, GovernDeck])
            createdGames.push(gameState)
            const player = gameState.activePlayer
            if (!player || !player.prey) {
                throw new ScenarioFailure('No active player or no prey')
            }
            const minion = readyVampire(gameState, player, 5)
            const other = players.find(candidate => candidate != player && candidate != player.prey)
            if (!other) {
                throw new ScenarioFailure('No player other than the prey')
            }
            mustRefuse(
                gameMutations.ACTION_declareAction.act(player, {
                    minionAction: createBleedAction(minion, other),
                }),
                'bleed on a player who is not the prey',
            )
            must(
                gameMutations.ACTION_declareAction.act(player, {
                    minionAction: createBleedAction(minion, player.prey),
                }),
                'bleed on the prey',
            )
        },
    },
]

/**
 * Far Mastery: the card proposes its own targets (a retainer at inferior, an ally at
 * superior), both controlled by another Methuselah.
 */

const CAMARILLA_VITAE_SLAVE_ID = '100286'
const ABYSSAL_HUNTER_ID = '100014'
const HeistDeck = <DeckList>{
    ...GovernDeck,
    [FAR_MASTERY_ID]: 3,
    [CAMARILLA_VITAE_SLAVE_ID]: 3,
    [ABYSSAL_HUNTER_ID]: 3,
}

type Heist = {
    turn: Turn
    victim: Player
    card: LibraryCard
    retainer: LibraryCard
    ally: LibraryCard
}

function findInLibrary(player: Player, krcgId: string): LibraryCard {
    const card = player.library.cards.find(candidate => candidate.krcgId == krcgId)
    if (!(card instanceof LibraryCard)) {
        throw new ScenarioFailure(`Card ${krcgId} is not in the library`)
    }
    return card
}

// The acting player holds Far Mastery, the other one has a retainer and an ally in play
function createHeist(level: DisciplineLevel): Heist {
    const turn = createMinionPhase(5, 0, HeistDeck)
    const victim = turn.gameState.competingPlayers.find(player => player != turn.player)
    if (!victim) {
        throw new ScenarioFailure('No other player')
    }
    turn.ready.minionAttrs.disciplines[Discipline.Dominate] = level
    const card = findInLibrary(turn.player, FAR_MASTERY_ID)
    turn.gameState.moveCardToRegion(card, turn.player.hand)
    const retainer = findInLibrary(victim, CAMARILLA_VITAE_SLAVE_ID)
    const ally = findInLibrary(victim, ABYSSAL_HUNTER_ID)
    turn.gameState.moveCardToRegion(retainer, victim.ready)
    turn.gameState.moveCardToRegion(ally, victim.ready)
    return { turn, victim, card, retainer, ally }
}

// The declarations of Far Mastery among everything the acting player can declare
function getHeistOptions(heist: Heist) {
    const { decision, options } = getActionOptions(heist.turn, MinionActionType.ActionCardFromHand)
    const farMastery = options.flatMap(option =>
        (
            option.action.type == MinionActionType.ActionCardFromHand &&
            option.action.card == heist.card
        ) ?
            [{ option, usage: option.action.usage }]
        :   [],
    )
    return { decision, farMastery }
}

// What the Far Mastery options steal, with the level of each
function getHeistTargets(heist: Heist) {
    return getHeistOptions(heist).farMastery.map(({ usage }) => ({
        target: usage.target,
        level: usage.disciplines?.[0]?.level,
    }))
}

const FAR_MASTERY_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'inferior Far Mastery targets only the retainer of another Methuselah',
        run() {
            const heist = createHeist(DisciplineLevel.INFERIOR)
            const targets = getHeistTargets(heist)
            expectEqual(targets.length, 1, 'options')
            expectEqual(targets[0].target, heist.retainer, 'target')
            expectEqual(targets[0].level, DisciplineLevel.INFERIOR, 'level')
        },
    },
    {
        name: 'superior Far Mastery also targets the ally, not with the inferior level',
        run() {
            const heist = createHeist(DisciplineLevel.SUPERIOR)
            const targets = getHeistTargets(heist)
            expectEqual(targets.length, 2, 'options')
            for (const { target, level } of targets) {
                expectEqual(
                    target,
                    level == DisciplineLevel.SUPERIOR ? heist.ally : heist.retainer,
                    `target at level ${level}`,
                )
            }
        },
    },
    {
        name: 'Far Mastery cannot steal what the acting player already controls',
        run() {
            const heist = createHeist(DisciplineLevel.SUPERIOR)
            heist.turn.gameState.moveCardToRegion(heist.retainer, heist.turn.player.ready)
            heist.turn.gameState.moveCardToRegion(heist.ally, heist.turn.player.ready)
            expectEqual(getHeistTargets(heist).length, 0, 'options')
        },
    },
    {
        name: 'a resolved Far Mastery takes control of the target and pays its blood',
        run() {
            const heist = createHeist(DisciplineLevel.INFERIOR)
            const { turn, retainer } = heist
            const { decision, farMastery } = getHeistOptions(heist)
            expectEqual(farMastery.length, 1, 'options')
            expectEqual(retainer.controller, heist.victim, 'controller before')
            applyOption(decision, farMastery[0].option)
            resolveAction(turn)
            expectEqual(retainer.controller, turn.player, 'controller after')
            expectEqual(retainer.region, turn.player.ready, 'retainer region')
            expectEqual(turn.ready.blood, 4, 'blood after the 1 blood cost')
            // No attachment in the model: the retainer lands close to the acting minion
            const distance = Math.hypot(retainer.x - turn.ready.x, retainer.y - turn.ready.y)
            expectEqual(distance < 2 * CARD_HEIGHT, true, `retainer distance ${distance}`)
        },
    },
    {
        name: 'a stolen ally comes to the play area of the acting player as a minion of its own',
        run() {
            const heist = createHeist(DisciplineLevel.SUPERIOR)
            const { turn, ally } = heist
            const { decision, farMastery } = getHeistOptions(heist)
            const steal = farMastery.find(({ usage }) => usage.target == ally)
            if (!steal) {
                throw new ScenarioFailure('The ally is not offered')
            }
            applyOption(decision, steal.option)
            resolveAction(turn)
            expectEqual(ally.controller, turn.player, 'controller after')
            expectEqual(ally.region, turn.player.ready, 'ally region')
            expectEqual(
                heist.victim.ready.cards.includes(ally),
                false,
                'still in the victim region',
            )
        },
    },
]

/**
 * Combat cards played from the hand (Behind You) and the Govern agent's choices.
 */

function giveBehindYou(fight: Fight, player: Player, minion: Vampire, level: DisciplineLevel) {
    minion.minionAttrs.disciplines[Discipline.Obfuscate] = level
    const card = player.library.cards.find(candidate => candidate.krcgId == BEHIND_YOU_ID)
    if (!card) {
        throw new ScenarioFailure('No Behind You in the library')
    }
    fight.gameState.moveCardToRegion(card, player.hand)
    return card
}

function getCombatDecision(fight: Fight, player: Player) {
    const decision = getDecisionPoint(fight.gameState, player)
    if (!decision) {
        throw new ScenarioFailure(`${player.name} has no decision`)
    }
    return decision
}

const CARD_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'Behind You at inferior is a maneuver, played from the hand in the range step only',
        run() {
            const fight = createFight(3, 3)
            const card = giveBehindYou(
                fight,
                fight.actingPlayer,
                fight.acting,
                DisciplineLevel.INFERIOR,
            )
            const handSize = fight.actingPlayer.hand.length

            // Not in the first step
            const early = getCombatDecision(fight, fight.actingPlayer)
            expectEqual(optionsOfType(early.options, 'combatManeuver').length, 0, 'before range')

            passUntil(fight, CombatStep.DetermineRange)
            const decision = getCombatDecision(fight, fight.actingPlayer)
            const [option] = optionsOfType(decision.options, 'combatManeuver')
            expectEqual(!!option, true, 'maneuver offered')
            expectEqual(optionsOfType(decision.options, 'combatStrike').length, 0, 'no strike')

            applyOption(decision, option)
            expectEqual(getCombat(fight).range, CombatRange.Long, 'range')
            expectEqual(card.isIn.ready, true, 'the card is played')
            expectEqual(fight.actingPlayer.hand.length, handSize, 'replacement drawn')
        },
    },
    {
        name: 'Behind You at superior is a dodge in the strike step, and is not offered in round 2',
        run() {
            const fight = createFight(3, 3)
            const card = giveBehindYou(
                fight,
                fight.defendingPlayer,
                fight.defending,
                DisciplineLevel.SUPERIOR,
            )
            passUntil(fight, CombatStep.Strike)
            must(
                gameMutations.COMBAT_chooseStrike.act(fight.actingPlayer, {
                    minion: fight.acting,
                    strike: createHandStrike(getCombat(fight).acting),
                }),
                'acting strikes',
            )
            const decision = getCombatDecision(fight, fight.defendingPlayer)
            // The random starting hand may hold other copies of the card
            const dodges = optionsOfType(decision.options, 'combatStrike').filter(
                option => option.strike.dodge && option.card == card,
            )
            expectEqual(dodges.length, 1, 'dodge offered')
            expectEqual(dodges[0].strike.source?.oid, dodges[0].card?.oid, 'strike source')

            // First round only
            getCombat(fight).round = 2
            const later = getCombatDecision(fight, fight.defendingPlayer)
            expectEqual(
                optionsOfType(later.options, 'combatStrike').filter(option => option.strike.dodge)
                    .length,
                0,
                'dodge in round 2',
            )
        },
    },
    {
        name: 'Govern dodges a hand strike with Behind You, and takes no damage',
        run() {
            const fight = createFight(3, 3)
            giveBehindYou(fight, fight.defendingPlayer, fight.defending, DisciplineLevel.SUPERIOR)
            passUntil(fight, CombatStep.Strike)
            must(
                gameMutations.COMBAT_chooseStrike.act(fight.actingPlayer, {
                    minion: fight.acting,
                    strike: createHandStrike(getCombat(fight).acting),
                }),
                'acting strikes',
            )
            const decision = getCombatDecision(fight, fight.defendingPlayer)
            const chosen = new GovernAgent().choose(decision)
            expectEqual(chosen.type == 'combatStrike' && chosen.strike.dodge, true, 'dodge chosen')
            applyOption(decision, chosen)
            passUntil(fight, null)
            expectEqual(fight.defending.blood, 3, 'defending blood')
        },
    },
    {
        name: 'once the combat is over, the combat cards of both bots go to the ash heap',
        run() {
            const fight = createFight(3, 3)
            const card = giveBehindYou(
                fight,
                fight.defendingPlayer,
                fight.defending,
                DisciplineLevel.SUPERIOR,
            )
            passUntil(fight, CombatStep.Strike)
            must(
                gameMutations.COMBAT_chooseStrike.act(fight.actingPlayer, {
                    minion: fight.acting,
                    strike: createHandStrike(getCombat(fight).acting),
                }),
                'acting strikes',
            )
            const decision = getCombatDecision(fight, fight.defendingPlayer)
            const dodge = decision.options.find(
                option => option.type == 'combatStrike' && option.card == card,
            )
            if (!dodge) {
                throw new ScenarioFailure('Behind You is not offered')
            }
            applyOption(decision, dodge)
            expectEqual(card.region == fight.defendingPlayer.ready, true, 'still in play')
            for (let i = 0; i < 40 && fight.gameState.combat; i++) {
                const combat = fight.gameState.combat
                const current = getCombatDecision(fight, combat.impulsePlayer)
                const pass = current.options.find(option => option.type == 'combatPass')
                if (!pass) {
                    throw new ScenarioFailure('Cannot pass')
                }
                applyOption(current, pass)
            }
            expectEqual(fight.gameState.combat, null, 'combat over')
            expectEqual(card.region == fight.defendingPlayer.ashHeap, true, 'in the ash heap')
        },
    },
    {
        name: 'Govern does not dodge when the opposing strike is out of range',
        run() {
            const fight = createFight(3, 3)
            giveBehindYou(fight, fight.defendingPlayer, fight.defending, DisciplineLevel.SUPERIOR)
            getCombat(fight).range = CombatRange.Long
            passUntil(fight, CombatStep.Strike)
            must(
                gameMutations.COMBAT_chooseStrike.act(fight.actingPlayer, {
                    minion: fight.acting,
                    strike: createHandStrike(getCombat(fight).acting),
                }),
                'acting strikes',
            )
            const decision = getCombatDecision(fight, fight.defendingPlayer)
            const chosen = new GovernAgent().choose(decision)
            expectEqual(chosen.type == 'combatStrike' && chosen.strike.dodge, false, 'no dodge')
        },
    },
    {
        name: 'Govern maneuvers to long range when it is the weaker minion, not when it is stronger',
        run() {
            const weak = createFight(3, 3)
            giveBehindYou(weak, weak.actingPlayer, weak.acting, DisciplineLevel.INFERIOR)
            getCombat(weak).defending.strength = 3
            passUntil(weak, CombatStep.DetermineRange)
            const decision = getCombatDecision(weak, weak.actingPlayer)
            const chosen = new GovernAgent().choose(decision)
            expectEqual(chosen.type, 'combatManeuver', 'weaker minion maneuvers')

            const strong = createFight(3, 3)
            giveBehindYou(strong, strong.actingPlayer, strong.acting, DisciplineLevel.INFERIOR)
            getCombat(strong).acting.strength = 3
            passUntil(strong, CombatStep.DetermineRange)
            const strongChoice = new GovernAgent().choose(
                getCombatDecision(strong, strong.actingPlayer),
            )
            expectEqual(strongChoice.type, 'combatPass', 'stronger minion stays close')
        },
    },
]

/**
 * The damage to a human minion is left to the human.
 */

function createHumanDefender(blood: number): Fight {
    const fight = createFight(3, blood)
    fight.defendingPlayer.permId = 'human'
    return fight
}

const HUMAN_DAMAGE_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'the damage to a human minion is not applied when the window closes',
        run() {
            const fight = createHumanDefender(1)
            damageResolution(fight, fight.defending, 3, 0)
            mustRefuse(
                gameMutations.COMBAT_applyDamage.act(fight.actingPlayer, { minion: fight.acting }),
                'apply damage without damage or impulse',
            )
            pass(fight.defendingPlayer, 'pass')
            expectEqual(fight.defending.blood, 1, 'defending blood')
            expectRegion(fight.defending, 'ready')
            expectEqual(getCombat(fight).defending.pendingDamage.regular, 0, 'pending damage')
            expectEqual(getCombat(fight).step, CombatStep.Press, 'step')
        },
    },
    {
        name: 'apply damage applies it to a human minion now, torpor included',
        run() {
            const fight = createHumanDefender(1)
            damageResolution(fight, fight.defending, 3, 0)
            must(
                gameMutations.COMBAT_applyDamage.act(fight.defendingPlayer, {
                    minion: fight.defending,
                }),
                'apply damage',
            )
            expectEqual(fight.defending.blood, 0, 'defending blood')
            expectRegion(fight.defending, 'torpor')
            mustRefuse(
                gameMutations.COMBAT_applyDamage.act(fight.defendingPlayer, {
                    minion: fight.defending,
                }),
                'apply damage twice',
            )
            pass(fight.defendingPlayer, 'pass')
            expectStep(fight, CombatStep.EndOfRound)
        },
    },
    {
        name: 'the damage to a bot minion is still applied automatically',
        run() {
            const fight = createFight(3, 1)
            damageResolution(fight, fight.defending, 3, 0)
            pass(fight.defendingPlayer, 'pass')
            expectRegion(fight.defending, 'torpor')
        },
    },
]

/**
 * Bounce cards (Deflection): the bled player declines to block, then changes the target of
 * the bleed. The new target gets a fresh chance to block. Also the Govern agent's behaviour
 * when bled, and its habit of keeping the youngest minion unlocked.
 */

type Bounce = {
    gameState: GameState
    bleeder: Player
    bled: Player
    // The bled player's prey: the only valid new target of a bounce (3 players)
    third: Player | undefined
    reactor: Vampire
    deflection: LibraryCard
}

function emptyHand(gameState: GameState, player: Player): void {
    for (const card of [...player.hand.cards]) {
        gameState.moveCardToRegion(card, player.library)
    }
}

function giveCard(gameState: GameState, player: Player, krcgId: string): LibraryCard {
    const card = player.library.cards.find(candidate => candidate.krcgId == krcgId)
    if (!card) {
        throw new ScenarioFailure(`Card ${krcgId} not in the library`)
    }
    gameState.moveCardToRegion(card, player.hand)
    return card
}

// The first player declares a bleed (or a hunt) against its prey. The prey has one ready
// vampire with the Dominate level, and Deflection as its only card.
function createBounce(
    level: DisciplineLevel,
    nbPlayers = 3,
    actionType = MinionActionType.Bleed,
): Bounce {
    const { gameState, players } = createHeadlessGame(
        Array.from({ length: nbPlayers }, () => GovernDeck),
    )
    createdGames.push(gameState)
    const bleeder = gameState.activePlayer
    const bled = bleeder?.prey
    if (!bleeder || !bled || !players.includes(bleeder)) {
        throw new ScenarioFailure('No active player or no prey')
    }
    const third = nbPlayers >= 3 ? bled.prey : undefined
    for (const player of players) {
        emptyHand(gameState, player)
    }
    gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Minion)
    gameState.turnResources.unlocked = true

    const bleeding = readyVampire(gameState, bleeder, 5)
    const reactor = readyVampire(gameState, bled, 3)
    if (third) {
        readyVampire(gameState, third, 3)
    }
    reactor.minionAttrs.disciplines[Discipline.Dominate] = level
    const deflection = giveCard(gameState, bled, DEFLECTION_ID)

    const decision = getDecisionPoint(gameState, bleeder)
    const declare =
        decision ?
            optionsOfType(decision.options, 'declareAction').find(
                option =>
                    option.action.type == actionType && option.action.actingMinion == bleeding,
            )
        :   undefined
    if (!decision || !declare) {
        throw new ScenarioFailure(`The ${actionType} is not offered`)
    }
    applyOption(decision, declare)
    return { gameState, bleeder, bled, third, reactor, deflection }
}

function decideWith(gameState: GameState, player: Player, type: BotOption['type']) {
    const decision = getDecisionPoint(gameState, player)
    if (!decision) {
        throw new ScenarioFailure(`${player.name} has no decision`)
    }
    applyOption(decision, findOption(decision.options, type))
}

// The bleeder passes, the bled player declines to block, the bleeder passes again:
// the bled player is back with a decision to make
function declineBlock(bounce: Bounce): DecisionPoint {
    const { gameState, bleeder, bled } = bounce
    decideWith(gameState, bleeder, 'noModifier')
    const first = getDecisionPoint(gameState, bled)
    if (!first) {
        throw new ScenarioFailure('The bled player has no decision')
    }
    expectEqual(
        optionsOfType(first.options, 'playReaction').length,
        0,
        'reaction offered before the block was declined',
    )
    applyOption(first, findOption(first.options, 'noBlock'))
    decideWith(gameState, bleeder, 'noModifier')

    const decision = getDecisionPoint(gameState, bled)
    if (!decision) {
        throw new ScenarioFailure('The bled player has no decision after declining')
    }
    return decision
}

function getBounceOption(decision: DecisionPoint, level: DisciplineLevel) {
    const option = optionsOfType(decision.options, 'playReaction').find(
        candidate => candidate.usage.disciplines?.[0]?.level == level,
    )
    if (!option) {
        throw new ScenarioFailure(`Deflection at ${level} is not offered`)
    }
    return option
}

const BOUNCE_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'Deflection is offered after the block is declined, to the prey of the bled player only',
        run() {
            const bounce = createBounce(DisciplineLevel.SUPERIOR)
            const decision = declineBlock(bounce)
            const options = optionsOfType(decision.options, 'playReaction')
            // Superior and inferior, one new target each: never the bleeder, never the bled player
            expectEqual(options.length, 2, 'Deflection options')
            for (const option of options) {
                expectEqual(option.effect.target, bounce.third, 'new target')
            }
            expectEqual(optionsOfType(decision.options, 'noBlock').length, 0, 'noBlock again')
        },
    },
    {
        name: 'Deflection is never offered in a 2-player game, nor against an action that is not a bleed',
        run() {
            const duel = createBounce(DisciplineLevel.SUPERIOR, 2)
            expectEqual(
                optionsOfType(declineBlock(duel).options, 'playReaction').length,
                0,
                'Deflection offered with 2 players',
            )

            const hunt = createBounce(DisciplineLevel.SUPERIOR, 3, MinionActionType.Hunt)
            expectEqual(
                optionsOfType(declineBlock(hunt).options, 'playReaction').length,
                0,
                'Deflection offered against a hunt',
            )
        },
    },
    {
        name: 'Deflection at superior bounces the bleed without locking, the new target can block',
        run() {
            const bounce = createBounce(DisciplineLevel.SUPERIOR)
            const { gameState, bleeder, bled, third, reactor, deflection } = bounce
            if (!third) {
                throw new ScenarioFailure('No third player')
            }
            const bloodBefore = reactor.blood
            const pools = { bleeder: bleeder.pool, bled: bled.pool, third: third.pool }
            const decision = declineBlock(bounce)

            applyOption(decision, getBounceOption(decision, DisciplineLevel.SUPERIOR))
            expectEqual(gameState.action?.minionAction.target, third, 'new target')
            expectEqual(reactor.isLocked, false, 'reacting vampire locked')
            expectEqual(reactor.blood, bloodBefore - 1, 'Deflection costs 1 blood')
            expectEqual(deflection.isIn.ready, true, 'Deflection played')
            expectEqual(gameState.action?.blockingDecisions.length, 0, 'block decisions reset')
            expectEqual(getDecidingPlayer(gameState), bleeder, 'impulse back to the bleeder')

            // The bleeder passes, the new target may block even if nobody else could
            decideWith(gameState, bleeder, 'noModifier')
            const thirdDecision = getDecisionPoint(gameState, third)
            expectEqual(
                optionsOfType(thirdDecision?.options ?? [], 'block').length > 0,
                true,
                'new target can block',
            )
            applyOption(
                thirdDecision as DecisionPoint,
                findOption((thirdDecision as DecisionPoint).options, 'noReaction'),
            )

            expectEqual(gameState.action, null, 'action in progress')
            expectEqual(third.pool < pools.third, true, 'the new target is bled')
            expectEqual(bled.pool, pools.bled, 'the previous target is not bled')
            expectEqual(bleeder.pool, pools.bleeder, 'the bleeder pool')
            expectEqual(deflection.isIn.ashHeap, true, 'Deflection put away')
        },
    },
    {
        name: 'Deflection at inferior locks the reacting vampire',
        run() {
            const bounce = createBounce(DisciplineLevel.INFERIOR)
            const decision = declineBlock(bounce)
            const options = optionsOfType(decision.options, 'playReaction')
            expectEqual(options.length, 1, 'only the inferior level')
            applyOption(decision, getBounceOption(decision, DisciplineLevel.INFERIOR))
            expectEqual(bounce.reactor.isLocked, true, 'reacting vampire locked')
            expectEqual(bounce.gameState.action?.minionAction.target, bounce.third, 'new target')
        },
    },
    {
        name: 'the new target is offered a block even after the first target declined',
        run() {
            const bounce = createBounce(DisciplineLevel.SUPERIOR)
            const { gameState, bleeder, third } = bounce
            if (!third) {
                throw new ScenarioFailure('No third player')
            }
            readyVampire(gameState, third, 3)
            const decision = declineBlock(bounce)
            applyOption(decision, getBounceOption(decision, DisciplineLevel.SUPERIOR))
            decideWith(gameState, bleeder, 'noModifier')
            // Every ready unlocked vampire of the new target may attempt the block
            const blocks = optionsOfType(getDecisionPoint(gameState, third)?.options ?? [], 'block')
            expectEqual(blocks.length, third.minionsReadyUnlocked.length, 'block options')
        },
    },
    {
        name: 'a bounce can only be applied on an action aimed at a Methuselah, away from the acting one',
        run() {
            const bounce = createBounce(DisciplineLevel.SUPERIOR)
            const { gameState, bleeder, bled, third } = bounce
            if (!third) {
                throw new ScenarioFailure('No third player')
            }
            mustRefuse(
                gameMutations.ACTION_changeTarget.act(bled, { target: bleeder }),
                'to the bleeder',
            )
            mustRefuse(
                gameMutations.ACTION_changeTarget.act(bled, { target: bled }),
                'to the same target',
            )
            must(
                gameMutations.ACTION_changeTarget.act(bled, { target: third }),
                'to a third player',
            )
            expectEqual(gameState.action?.minionAction.target, third, 'new target')
        },
    },
    {
        name: 'the Govern agent declines to block, then bounces the bleed to its prey',
        run() {
            const bounce = createBounce(DisciplineLevel.SUPERIOR)
            const { gameState, bleeder, bled, third, reactor, deflection } = bounce
            if (!third) {
                throw new ScenarioFailure('No third player')
            }
            const pools = { bleeder: bleeder.pool, bled: bled.pool, third: third.pool }
            const agent = new GovernAgent()
            const steps: string[] = []
            for (let i = 0; i < 30 && gameState.action; i++) {
                const player = getDecidingPlayer(gameState)
                if (!player) {
                    throw new ScenarioFailure('Nobody has the impulse during the action')
                }
                const step = stepBot(player, agent)
                steps.push(`${player.name}:${step?.option.type}`)
            }
            expectEqual(gameState.action, null, 'action in progress')
            expectEqual(steps.includes(`${bled.name}:noBlock`), true, 'the bled agent declined')
            expectEqual(steps.includes(`${bled.name}:playReaction`), true, 'the bled agent bounced')
            expectEqual(third.pool < pools.third, true, 'the prey is bled')
            expectEqual(bled.pool, pools.bled, 'the bled agent is not bled')
            expectEqual(bleeder.pool, pools.bleeder, 'the bleeder pool')
            expectEqual(reactor.isLocked, false, 'superior does not lock')
            expectEqual(deflection.isIn.ashHeap, true, 'Deflection put away')
        },
    },
    {
        name: 'a bot passing on the bleed of a human gives the impulse back to the human, the action stays',
        run() {
            const bounce = createBounce(DisciplineLevel.SUPERIOR)
            const { gameState, bleeder, bled } = bounce
            bleeder.permId = 'human'
            gameState.moveCardToRegion(bounce.deflection, bled.library)
            const pool = bled.pool

            expectEqual(getDecidingPlayer(gameState), bleeder, 'the human holds the impulse')
            decideWith(gameState, bleeder, 'noModifier')
            expectEqual(getDecidingPlayer(gameState), bled, 'the bot holds the impulse')

            const step = stepBot(bled, new GovernAgent())
            expectEqual(step?.option.type, 'noReaction', 'the bot passes')
            expectEqual(getDecidingPlayer(gameState), bleeder, 'the human holds the impulse again')
            expectEqual(gameState.action !== null, true, 'the human ends the action by hand')
            expectEqual(bled.pool, pool, 'the bleed is not applied for the human')
        },
    },
    {
        name: 'the Govern agent bounces the bleed of a human once the human passes the impulse',
        run() {
            const bounce = createBounce(DisciplineLevel.SUPERIOR)
            const { gameState, bleeder, bled, third } = bounce
            bleeder.permId = 'human'
            const agent = new GovernAgent()

            // The bot declines the block, the human passes again, the bot bounces
            decideWith(gameState, bleeder, 'noModifier')
            expectEqual(stepBot(bled, agent)?.option.type, 'noBlock', 'the bot declines to block')
            expectEqual(getDecidingPlayer(gameState), bleeder, 'back to the human')
            decideWith(gameState, bleeder, 'noModifier')
            expectEqual(stepBot(bled, agent)?.option.type, 'playReaction', 'the bot bounces')
            expectEqual(gameState.action?.minionAction.target, third, 'new target')
            expectEqual(getDecidingPlayer(gameState), bleeder, 'back to the human')
        },
    },
    {
        name: 'the Govern agent keeps the youngest of more than 2 ready minions unlocked',
        run() {
            const { gameState, players } = createHeadlessGame([GovernDeck, GovernDeck])
            createdGames.push(gameState)
            const player = gameState.activePlayer
            if (!player || !players.includes(player)) {
                throw new ScenarioFailure('No active player')
            }
            emptyHand(gameState, player)
            giveCard(gameState, player, GOVERN_ID)
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Minion)
            gameState.turnResources.unlocked = true

            const [youngest, middle, oldest] = [4, 6, 8].map(capacity => {
                const vampire = readyVampire(gameState, player, 3)
                vampire.minionAttrs.capacity = capacity
                vampire.minionAttrs.disciplines[Discipline.Dominate] = DisciplineLevel.SUPERIOR
                return vampire
            })
            const agent = new GovernAgent()
            const actingMinion = () => {
                const decision = getDecisionPoint(gameState, player)
                const option = decision ? agent.choose(decision) : null
                return option?.type == 'declareAction' ? option.action.actingMinion : null
            }

            expectEqual(actingMinion(), oldest, 'the oldest acts first')
            oldest.isLocked = true
            expectEqual(actingMinion(), middle, 'then the next one')
            middle.isLocked = true
            expectEqual(actingMinion(), null, 'the youngest stays unlocked, the phase ends')
            expectEqual(youngest.isLocked, false, 'the youngest is unlocked')

            // With 2 ready minions only, nothing is reserved
            gameState.moveCardToRegion(oldest, player.torpor)
            expectEqual(actingMinion(), youngest, 'with 2 ready minions the youngest acts')
        },
    },
]

type ScenarioResult = { name: string; error: string | null }

function runCombatScenarios(): ScenarioResult[] {
    return [
        ...SCENARIOS,
        ...TORPOR_SCENARIOS,
        ...COST_SCENARIOS,
        ...DECLARE_SCENARIOS,
        ...FAR_MASTERY_SCENARIOS,
        ...CARD_SCENARIOS,
        ...HUMAN_DAMAGE_SCENARIOS,
        ...BOUNCE_SCENARIOS,
    ].map(({ name, run }) => {
        try {
            run()
            return { name, error: null }
        } catch (error) {
            return { name, error: error instanceof Error ? error.message : String(error) }
        } finally {
            createdGames.splice(0).forEach(gameState => deleteGameState(gameState.gameId))
        }
    })
}

registerLogger({
    captureException: error => console.error(error),
    captureMessage: message => console.warn(message),
})
await initWasmHasher()
setGameResources('cardbase', JSON.parse(readFileSync('public/assets/cardbase.json', 'utf-8')))
registerSyncMutationTrigger()

const results = runCombatScenarios()
for (const { name, error } of results) {
    console.log(`${error ? 'FAIL' : 'ok  '} ${name}${error ? `\n       ${error}` : ''}`)
}
const failures = results.filter(result => result.error)
console.log(`\n${results.length} scenarios, ${failures.length} failures`)
process.exit(failures.length > 0 ? 1 : 0)
