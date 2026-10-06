// Hand-built bot scenarios (combat, actions, reactions, master cards, hand size, uniqueness...)
// checked against the rulebook. Run from the repo root:
//   npx tsx script/botScenarios.ts [--filter text]
// --filter keeps only the scenarios whose name contains the text (case-insensitive).
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
    ActionProperty,
    CombatRange,
    CombatState,
    CombatStep,
    CombatStrike,
    DisciplineUse,
    GameType,
    LibraryCardUsage,
    MinionAction,
    MinionActionType,
    Validity,
} from '@/shared/types/state.ts'
import {
    Discipline,
    DisciplineLevel,
    LEAVE_TORPOR_COST,
    Sect,
    TurnPhase,
    TurnSequence,
} from '@/shared/const/model.ts'
import { CARD_HEIGHT, TORPOR_ZONE_Y } from '@/shared/const/game.ts'
import { Disciplines } from '@/shared/types/resources.ts'
import { getBlockingMinion } from '@/shared/state/actionState.ts'
import { getAttachedCards, getHost, isAttached } from '@/shared/state/attachments.ts'
import { addEventObserver, emitEvent } from '@/shared/state/events.ts'
import { getTriggerKey } from '@/shared/state/triggers.ts'
import {
    ABRAHAM_MELLON_ID,
    ASYLUM_HUNTING_GROUND_ID,
    BEHIND_YOU_ID,
    BLOOD_DOLL_ID,
    DEFLECTION_ID,
    ELDER_LIBRARY_ID,
    FAR_MASTERY_ID,
    GOVERN_ID,
    LOST_IN_CROWDS_ID,
} from '@/shared/cardImpl/cardIds.ts'
import { MasterCardImplementation } from '@/shared/cardImpl/base.ts'
import { MASTER_CARD_IMPLEMENTATIONS } from '@/shared/cardImpl/index.ts'
import {
    getAttachedCombatOptions,
    getCombatCardOptions,
    getUnlockEffectOptions,
} from '@/shared/bot/cardOptions.ts'
import {
    getAttachCandidates,
    getMinionIntercept,
    getMinionStrength,
    matchesMinionFilter,
} from '@/shared/cardImpl/catalog/attached.ts'
import { actionImplementation } from '@/shared/cardImpl/catalog/interpreter.ts'
import {
    aMinion,
    attachToMinion,
    aVampire,
    defineCard,
    strength as strengthEffect,
} from '@/shared/cardImpl/catalog/builders.ts'
import { MinionFilter } from '@/shared/cardImpl/catalog/types.ts'
import { canDeclare } from '@/shared/state/minionActions.ts'
import { hasUniqueCopyInPlay } from '@/shared/state/cardRequirements.ts'
import { chooseThroughView, createPlayerView } from '@/shared/bot/playerView.ts'
import { findOption } from '@/shared/bot/helpers.ts'
import {
    createActionCardAction,
    createBleedAction,
    createHuntAction,
    createLeaveTorporAction,
    createRescueFromTorporAction,
} from '@/shared/state/minionActionFactories.ts'
import { GovernAgent } from '@/shared/bot/agents/governAgent.ts'
import {
    createHeadlessGame,
    registerQueuedMutationTrigger,
    registerSyncMutationTrigger,
} from './harness.ts'
import { AttachDeck } from './attachDeck.ts'
import { BrujahDeck, GovernDeck, MalkavDeck } from '@/shared/bot/decks.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { applyOption, getDecidingPlayer, getDecisionPoint } from '@/shared/bot/referee.ts'
import { stepBot } from '@/shared/bot/driver.ts'
import { BaseAgent } from '@/shared/bot/agents/baseAgent.ts'
import {
    BotOption,
    BotOptionOf,
    CombatCardOption,
    DecisionKind,
    DecisionPoint,
    optionsOfType,
} from '@/shared/bot/types.ts'

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

// A given crypt card, still in the crypt or among the uncontrolled vampires, made ready
function readySpecific(
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

function createFight(actingBlood: number, defendingBlood: number, deck = GovernDeck): Fight {
    const { gameState, players } = createHeadlessGame([deck, deck])
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
            const poor = createMinionPhase(1, LEAVE_TORPOR_COST - 1)
            expectEqual(
                getActionOptions(poor, MinionActionType.LeaveTorpor).options.length,
                0,
                'options',
            )

            const turn = createMinionPhase(1, 3)
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
    {
        name: 'an empty ready unlocked vampire must hunt: only its hunt is offered, no endPhase',
        run() {
            const turn = createMinionPhase(0, 3)
            const decision = getDecisionPoint(turn.gameState, turn.player)
            if (!decision) {
                throw new ScenarioFailure('No decision point')
            }
            expectEqual(decision.options.length, 1, 'options')
            const [option] = decision.options
            if (
                option.type != 'declareAction' ||
                option.action.type != MinionActionType.Hunt ||
                option.action.actingMinion != turn.ready
            ) {
                throw new ScenarioFailure('The only option is not the hunt of the empty vampire')
            }

            applyOption(decision, option)
            resolveAction(turn)
            const next = getDecisionPoint(turn.gameState, turn.player)
            if (!next) {
                throw new ScenarioFailure('No decision point after the hunt')
            }
            expectEqual(
                next.options.some(candidate => candidate.type == 'endPhase'),
                true,
                'endPhase offered once the vampire has hunted',
            )
        },
    },
    {
        name: 'a vampire with blood is free to do anything, the phase can be ended',
        run() {
            const turn = createMinionPhase(1, 3)
            const decision = getDecisionPoint(turn.gameState, turn.player)
            if (!decision) {
                throw new ScenarioFailure('No decision point')
            }
            expectEqual(
                decision.options.some(option => option.type == 'endPhase'),
                true,
                'endPhase offered',
            )
            expectEqual(
                getActionOptions(turn, MinionActionType.Hunt).options.length > 0,
                true,
                'hunt offered',
            )
        },
    },
    {
        name: 'a locked empty vampire does not have to hunt',
        run() {
            const turn = createMinionPhase(0, 3)
            turn.ready.lock()
            const decision = getDecisionPoint(turn.gameState, turn.player)
            expectEqual(
                decision?.options.some(option => option.type == 'endPhase'),
                true,
                'endPhase offered',
            )
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
    giveCard(turn.gameState, turn.player, GOVERN_ID)
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

// The setup deals a random hand, so a card can be in the library or already in the hand
function findCard(player: Player, krcgId: string): LibraryCard {
    const card = [...player.library.cards, ...player.hand.cards].find(
        candidate => candidate.krcgId == krcgId,
    )
    if (!(card instanceof LibraryCard)) {
        throw new ScenarioFailure(`Card ${krcgId} is neither in the library nor in the hand`)
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
    const card = findCard(turn.player, FAR_MASTERY_ID)
    giveCard(turn.gameState, turn.player, FAR_MASTERY_ID)
    const retainer = findCard(victim, CAMARILLA_VITAE_SLAVE_ID)
    const ally = findCard(victim, ABYSSAL_HUNTER_ID)
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
            // The retainer is attached to the acting minion, close to it
            expectEqual(getHost(retainer), turn.ready, 'the retainer is attached')
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
    return giveCard(fight.gameState, player, BEHIND_YOU_ID)
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
            expectEqual(
                fight.actingPlayer.hand.length,
                fight.actingPlayer.handSize,
                'drawn back to the hand size',
            )
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
            expectEqual(getCombat(fight).step, CombatStep.AdditionalStrikes, 'step')
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

// A bot always draws back up to its hand size: a scenario that wants a controlled hand takes
// the rest of the library out of reach once the cards it needs are in hand
function sealLibrary(gameState: GameState, player: Player): void {
    for (const card of [...player.library.cards]) {
        gameState.moveCardToRegion(card, player.removed)
    }
}

// Cards handed out by a scenario stay in hand
const givenCards = new WeakSet<LibraryCard>()

// A bot over its hand size has to discard first: the hand stays at its size, so a card given
// takes the place of one dealt by the setup
function giveCard(gameState: GameState, player: Player, krcgId: string): LibraryCard {
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

// The first player declares a bleed (or a hunt) against its prey. The prey has one ready
// vampire with the Dominate level, and Deflection as its only card.
function createBounce(
    level: DisciplineLevel,
    nbPlayers = 3,
    actionType = MinionActionType.Bleed,
    copies = 1,
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

    // The bleeder is the stronger one: the Govern agent would lose the combat of a block, so it
    // does not block and falls back on Deflection
    const bleeding = readyVampire(gameState, bleeder, 5)
    bleeding.minionAttrs.strength = 2
    const reactor = readyVampire(gameState, bled, 3)
    if (third) {
        readyVampire(gameState, third, 3)
    }
    reactor.minionAttrs.disciplines[Discipline.Dominate] = level
    const deflection = giveCard(gameState, bled, DEFLECTION_ID)
    for (let copy = 1; copy < copies; copy++) {
        giveCard(gameState, bled, DEFLECTION_ID)
    }
    for (const player of players) {
        sealLibrary(gameState, player)
    }

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
                expectEqual(
                    option.effect.type == 'changeTarget' ? option.effect.target : null,
                    bounce.third,
                    'new target',
                )
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
        name: 'a minion plays a reaction card once per action, whatever the copies in hand; another minion still can',
        run() {
            const bounce = createBounce(DisciplineLevel.SUPERIOR, 3, MinionActionType.Bleed, 2)
            const { gameState, bled, third, reactor } = bounce
            if (!third) {
                throw new ScenarioFailure('No third player')
            }
            const other = readyVampire(gameState, bled, 3)
            other.minionAttrs.disciplines[Discipline.Dominate] = DisciplineLevel.SUPERIOR
            const decision = declineBlock(bounce)
            applyOption(
                decision,
                optionsOfType(decision.options, 'playReaction').find(
                    option =>
                        option.minion == reactor &&
                        option.usage.disciplines?.[0]?.level == DisciplineLevel.SUPERIOR,
                ) ?? getBounceOption(decision, DisciplineLevel.SUPERIOR),
            )

            // The bleed comes back to the first target, which still holds a Deflection
            must(gameMutations.ACTION_changeTarget.act(third, { target: bled }), 'back to the bled')
            const minions = optionsOfType(declineBlock(bounce).options, 'playReaction').map(
                option => option.minion,
            )
            expectEqual(minions.includes(reactor), false, 'the same minion played it twice')
            expectEqual(minions.includes(other), true, 'another minion cannot play it')
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
            gameState.moveCardToRegion(bounce.deflection, bled.removed)
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

/**
 * Master cards: Elder Library (cost 1 pool, location, +1 hand size), played in the
 * master phase with the master phase action of the turn.
 */

type MasterTurn = { gameState: GameState; player: Player; library: LibraryCard }

// The active player is in the master phase with Elder Library and 6 other cards in hand
function createMasterPhase(): MasterTurn {
    const { gameState, players } = createHeadlessGame([GovernDeck, GovernDeck])
    createdGames.push(gameState)
    const player = gameState.activePlayer
    if (!player || !players.includes(player)) {
        throw new ScenarioFailure('No active player')
    }
    emptyHand(gameState, player)
    const library = giveCard(gameState, player, ELDER_LIBRARY_ID)
    const others = player.library.cards.filter(card => card.krcgId != ELDER_LIBRARY_ID)
    for (const card of others.slice(0, 6)) {
        gameState.moveCardToRegion(card, player.hand)
    }
    gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Master)
    gameState.turnResources.unlocked = true
    return { gameState, player, library }
}

function getMasterDecision(turn: MasterTurn): DecisionPoint {
    const decision = getDecisionPoint(turn.gameState, turn.player)
    if (!decision) {
        throw new ScenarioFailure('No decision point')
    }
    return decision
}

const countMasterOptions = (turn: MasterTurn) =>
    optionsOfType(getMasterDecision(turn).options, 'playMaster').length

// Abraham Mellon is in the crypt or among the uncontrolled vampires, depending on the draw
function getAbraham(player: Player) {
    const abraham = [...player.crypt.cards, ...player.uncontrolled.cards].find(
        card => card.krcgId == ABRAHAM_MELLON_ID,
    )
    if (!abraham) {
        throw new ScenarioFailure('Abraham Mellon is not in the crypt')
    }
    return abraham
}

type AsylumTurn = MasterTurn & { asylum: LibraryCard }

// The master phase of a player with Asylum Hunting Ground as their only card in hand
function createAsylumTurn(): AsylumTurn {
    const { gameState, player } = createMasterPhase()
    emptyHand(gameState, player)
    const asylum = giveCard(gameState, player, ASYLUM_HUNTING_GROUND_ID)
    return { gameState, player, library: asylum, asylum }
}

// A vampire of the clan still in the crypt or among the uncontrolled ones ( never Abraham
// Mellon, whose hand size bonus would skew the scenarios )
function getVampireOfClan(player: Player, clan: string): Vampire {
    const vampire = [...player.crypt.cards, ...player.uncontrolled.cards].find(
        card =>
            card.isVampire() && card.vampireAttrs.clan == clan && card.krcgId != ABRAHAM_MELLON_ID,
    )
    if (!vampire?.isVampire()) {
        throw new ScenarioFailure(`No ${clan} vampire left`)
    }
    return vampire
}

const countUnlockEffects = (turn: MasterTurn) =>
    optionsOfType(getMasterDecision(turn).options, 'unlockEffect').length

const FORGERS_HAMMER_ID = '100767'

// A card of the player that is not in play yet ( hand or library )
function findHeldCard(player: Player, krcgId: string): LibraryCard {
    const card = [...player.hand.cards, ...player.library.cards].find(
        candidate => candidate.krcgId == krcgId,
    )
    if (!(card instanceof LibraryCard)) {
        throw new ScenarioFailure(`Card ${krcgId} is not in hand or library`)
    }
    return card
}

type UniqueTurn = MasterTurn & { other: Player; theirs: LibraryCard }

// The master phase of a player holding Elder Library, while the other player has theirs in play
function createUniqueTurn(): UniqueTurn {
    const turn = createMasterPhase()
    const other = turn.gameState.orderedPlayers.find(candidate => candidate != turn.player)
    if (!other) {
        throw new ScenarioFailure('No other player')
    }
    const theirs = findHeldCard(other, ELDER_LIBRARY_ID)
    turn.gameState.moveCardToRegion(theirs, other.ready)
    return { ...turn, other, theirs }
}

const MASTER_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'Elder Library is offered with a master phase action and more pool than its cost',
        run() {
            const turn = createMasterPhase()
            const { gameState, player } = turn
            const decision = getMasterDecision(turn)
            expectEqual(decision.kind, DecisionKind.Master, 'decision kind')
            expectEqual(countMasterOptions(turn), 1, 'options in the master phase')
            findOption(decision.options, 'endPhase')

            gameState.turnResources.mpa = 0
            expectEqual(countMasterOptions(turn), 0, 'options without a master phase action')
            gameState.turnResources.mpa = 1

            player.pool = 1
            expectEqual(countMasterOptions(turn), 0, 'options when the pool would be emptied')
            player.pool = 2
            expectEqual(countMasterOptions(turn), 1, 'options with 2 pool')

            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Minion)
            const minionPhase = getMasterDecision(turn)
            expectEqual(
                optionsOfType(minionPhase.options, 'playMaster').length,
                0,
                'master options in the minion phase',
            )

            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Master)
            emptyHand(gameState, player)
            expectEqual(countMasterOptions(turn), 0, 'options when not in hand')
        },
    },
    {
        name: 'playing Elder Library: 1 pool, the action, +1 hand size, draws back to 8, stays in play',
        run() {
            const turn = createMasterPhase()
            const { gameState, player, library } = turn
            const pool = player.pool
            const libraryLength = player.library.length
            expectEqual(player.hand.length, 7, 'hand before')
            expectEqual(player.handSize, 7, 'hand size before')

            const decision = getMasterDecision(turn)
            applyOption(decision, findOption(decision.options, 'playMaster'))

            expectEqual(player.pool, pool - 1, 'pool')
            expectEqual(gameState.turnResources.mpa, 0, 'master phase action')
            expectEqual(player.handSize, 8, 'hand size')
            expectEqual(player.hand.length, 8, 'hand after the draw')
            expectEqual(player.library.length, libraryLength - 2, 'library after two draws')
            expectEqual(library.isIn.ready, true, 'in play')
            expectEqual(player.ashHeap.length, 0, 'ash heap')

            const next = getMasterDecision(turn)
            expectEqual(next.kind, DecisionKind.Master, 'no cleanup for a location')
            expectEqual(next.options.length, 1, 'only the way out is left')
        },
    },
    {
        name: 'the Govern agent plays Elder Library as soon as it is in hand, then ends the phase',
        run() {
            const turn = createMasterPhase()
            const { gameState, player } = turn
            const agent = new GovernAgent()
            expectEqual(stepBot(player, agent)?.option.type, 'playMaster', 'first step')
            expectEqual(stepBot(player, agent)?.option.type, 'endPhase', 'second step')
            expectEqual(gameState.turnPhase, TurnPhase.Minion, 'next phase')
        },
    },
    {
        name: 'a master card that does not stay in play goes to the ash heap at the cleanup',
        run() {
            class Discarded extends MasterCardImplementation {
                get staysInPlay() {
                    return false
                }
            }
            const original = MASTER_CARD_IMPLEMENTATIONS[ELDER_LIBRARY_ID]
            MASTER_CARD_IMPLEMENTATIONS[ELDER_LIBRARY_ID] = Discarded
            try {
                const turn = createMasterPhase()
                const { player, library } = turn
                const decision = getMasterDecision(turn)
                applyOption(decision, findOption(decision.options, 'playMaster'))
                expectEqual(library.isIn.ready, true, 'visible after the play')

                const cleanup = getMasterDecision(turn)
                expectEqual(cleanup.kind, DecisionKind.Cleanup, 'cleanup decision')
                applyOption(cleanup, findOption(cleanup.options, 'cleanup'))
                expectEqual(library.isIn.ashHeap, true, 'in the ash heap')
                expectEqual(player.ready.length, 0, 'nothing left in play')
            } finally {
                MASTER_CARD_IMPLEMENTATIONS[ELDER_LIBRARY_ID] = original
            }
        },
    },
    {
        name: 'the master phase action refuses to be spent when there is none',
        run() {
            const { gameState, player } = createMasterPhase()
            gameState.turnResources.mpa = 0
            mustRefuse(gameMutations.spendMasterPhaseAction.act(player, { player }), 'spend (none)')
        },
    },
    {
        name: 'the hand size follows Elder Library: burned or stolen, the bonus is gone or goes with it',
        run() {
            const turn = createMasterPhase()
            const { gameState, player, library } = turn
            const other = gameState.orderedPlayers.find(candidate => candidate != player)
            if (!other) {
                throw new ScenarioFailure('No other player')
            }
            expectEqual(player.handSize, 7, 'before')
            const decision = getMasterDecision(turn)
            applyOption(decision, findOption(decision.options, 'playMaster'))
            expectEqual(player.handSize, 8, 'in play')

            must(
                gameMutations.takeControl.act(other, { card: library, controller: other }),
                'steal',
            )
            expectEqual(player.handSize, 7, 'stolen: the owner loses it')
            expectEqual(other.handSize, 8, 'stolen: the thief gets it')

            must(
                gameMutations.takeControl.act(other, { card: library, controller: undefined }),
                'back',
            )
            expectEqual(player.handSize, 8, 'control reverted')
            expectEqual(other.handSize, 7, 'control reverted: the thief loses it')

            gameState.moveCardToRegion(library, player.ashHeap)
            expectEqual(player.handSize, 7, 'burned')
            // Humans discard by hand: only a bot is made to
            player.permId = 'human'
            expectEqual(
                getDecisionPoint(gameState, player)?.kind,
                DecisionKind.Master,
                'a human is not asked',
            )
        },
    },
    {
        name: 'Abraham Mellon gives +1 hand size only while he is in the ready region',
        run() {
            const { gameState, player } = createMasterPhase()
            const abraham = getAbraham(player)
            expectEqual(player.handSize, 7, 'not in play')
            gameState.moveCardToRegion(abraham, player.ready)
            expectEqual(player.handSize, 8, 'ready')
            gameState.moveCardToRegion(abraham, player.torpor)
            expectEqual(player.handSize, 7, 'torpor')
            gameState.moveCardToRegion(abraham, player.ready)
            expectEqual(player.handSize, 8, 'out of torpor')
            gameState.moveCardToRegion(abraham, player.ashHeap)
            expectEqual(player.handSize, 7, 'dead')
        },
    },
    {
        name: 'Elder Library and Abraham Mellon stack, and a bot draws when a vampire gets out of torpor',
        run() {
            const turn = createMasterPhase()
            const { gameState, player } = turn
            const abraham = getAbraham(player)
            gameState.moveCardToRegion(abraham, player.torpor)
            const decision = getMasterDecision(turn)
            applyOption(decision, findOption(decision.options, 'playMaster'))
            expectEqual(player.handSize, 8, 'library only')
            expectEqual(player.hand.length, 8, 'hand after the library')

            gameState.moveCardToRegion(abraham, player.ready)
            expectEqual(player.handSize, 9, 'both')
            // The next decision of any bot ends with the draw
            const next = getMasterDecision(turn)
            applyOption(next, findOption(next.options, 'endPhase'))
            expectEqual(player.hand.length, 9, 'drawn after the vampire came back')
        },
    },
    {
        name: 'a bot over its hand size discards at once, even out of its turn, without using the discard action',
        run() {
            const turn = createMasterPhase()
            const { gameState, player } = turn
            const abraham = getAbraham(player)
            gameState.moveCardToRegion(abraham, player.ready)
            const draw = player.library.cards[0]
            gameState.moveCardToRegion(draw, player.hand)
            expectEqual(player.hand.length, 8, 'hand')

            // Abraham goes to torpor during the turn of the OTHER player
            const other = gameState.orderedPlayers.find(candidate => candidate != player)
            if (!other) {
                throw new ScenarioFailure('No other player')
            }
            gameState.activePlayerIndex = gameState.competingPlayers.indexOf(other)
            gameState.moveCardToRegion(abraham, player.torpor)
            expectEqual(player.handSize, 7, 'hand size')
            expectEqual(getDecidingPlayer(gameState), player, 'the bot decides first')

            const decision = getMasterDecision({ ...turn, player })
            expectEqual(decision.kind, DecisionKind.DiscardExcess, 'decision kind')
            expectEqual(decision.options.length, 8, 'one option per card')
            const ash = player.ashHeap.length
            const dpa = gameState.turnResources.dpa
            applyOption(decision, decision.options[0])
            expectEqual(player.hand.length, 7, 'hand after')
            expectEqual(player.ashHeap.length, ash + 1, 'ash heap')
            expectEqual(gameState.turnResources.dpa, dpa, 'discard phase action untouched')
            expectEqual(getDecidingPlayer(gameState), other, 'the game goes on')
        },
    },
    {
        name: 'the Govern agent discards the excess but keeps its Govern cards',
        run() {
            const { gameState, player } = createMasterPhase()
            emptyHand(gameState, player)
            const govern = giveCard(gameState, player, GOVERN_ID)
            const others = player.library.cards.filter(card => card.krcgId != GOVERN_ID)
            for (const card of others.slice(0, 7)) {
                gameState.moveCardToRegion(card, player.hand)
            }
            expectEqual(player.hand.length, 8, 'hand')
            const step = stepBot(player, new GovernAgent())
            expectEqual(step?.option.type, 'discardExcess', 'step')
            expectEqual(govern.isIn.hand, true, 'Govern kept')
            expectEqual(player.hand.length, 7, 'hand after')
        },
    },
    {
        name: 'the hand size is part of the player view',
        run() {
            const { gameState, player } = createMasterPhase()
            const abraham = getAbraham(player)
            gameState.moveCardToRegion(abraham, player.ready)
            const view = createPlayerView(gameState, player)
            try {
                expectEqual(view.player.handSize, 8, 'hand size in the view')
            } finally {
                view.dispose()
            }
        },
    },
    {
        name: 'Asylum Hunting Ground requires a ready Malkavian vampire',
        run() {
            const turn = createAsylumTurn()
            const { gameState, player } = turn
            expectEqual(countMasterOptions(turn), 0, 'no ready vampire')

            const nosferatu = getVampireOfClan(player, 'Nosferatu')
            gameState.moveCardToRegion(nosferatu, player.ready)
            expectEqual(countMasterOptions(turn), 0, 'a ready Nosferatu')

            const malkavian = getVampireOfClan(player, 'Malkavian')
            gameState.moveCardToRegion(malkavian, player.torpor)
            expectEqual(countMasterOptions(turn), 0, 'a Malkavian in torpor')

            gameState.moveCardToRegion(malkavian, player.ready)
            expectEqual(countMasterOptions(turn), 1, 'a ready Malkavian')

            player.pool = 2
            expectEqual(countMasterOptions(turn), 0, 'pool of 2 would be emptied')
        },
    },
    {
        name: 'playing Asylum Hunting Ground: 2 pool, the action, stays in play',
        run() {
            const turn = createAsylumTurn()
            const { gameState, player, asylum } = turn
            gameState.moveCardToRegion(getVampireOfClan(player, 'Malkavian'), player.ready)
            const pool = player.pool

            const decision = getMasterDecision(turn)
            applyOption(decision, findOption(decision.options, 'playMaster'))
            expectEqual(player.pool, pool - 2, 'pool')
            expectEqual(gameState.turnResources.mpa, 0, 'master phase action')
            expectEqual(asylum.isIn.ready, true, 'in play')
            expectEqual(player.handSize, 7, 'no hand size bonus')
            expectEqual(getMasterDecision(turn).kind, DecisionKind.Master, 'no cleanup')
        },
    },
    {
        name: 'Asylum Hunting Ground gives 1 blood once per turn, never above the capacity',
        run() {
            const turn = createAsylumTurn()
            const { gameState, player, asylum } = turn
            gameState.moveCardToRegion(asylum, player.ready)
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Unlock)

            const [low, high, full] = [1, 3, 5].map(blood => {
                const vampire = readyVampire(gameState, player, blood)
                vampire.minionAttrs.capacity = 5
                return vampire
            })
            gameState.turnResources.unlocked = false
            expectEqual(countUnlockEffects(turn), 0, 'nothing before the unlock')
            gameState.turnResources.unlocked = true
            expectEqual(countUnlockEffects(turn), 2, 'the full vampire is not a target')

            // A vampire in torpor is not ready
            gameState.moveCardToRegion(getVampireOfClan(player, 'Malkavian'), player.torpor)
            expectEqual(countUnlockEffects(turn), 2, 'a torpid vampire is not a target')

            const decision = getMasterDecision(turn)
            const option = optionsOfType(decision.options, 'unlockEffect').find(
                candidate => candidate.vampire == high,
            )
            if (!option) {
                throw new ScenarioFailure('No unlock effect on the vampire')
            }
            applyOption(decision, option)
            expectEqual(high.blood, 4, 'blood gained')
            expectEqual(low.blood, 1, 'the other vampire is untouched')
            expectEqual(full.blood, 5, 'the full vampire is untouched')
            expectEqual(countUnlockEffects(turn), 0, 'once per turn')
            mustRefuse(
                gameMutations.markCardUsed.act(player, { player, card: asylum }),
                'used twice',
            )

            gameState.setNewTurnResources()
            gameState.turnResources.unlocked = true
            expectEqual(countUnlockEffects(turn), 2, 'available again the next turn')
        },
    },
    {
        name: 'Asylum Hunting Ground effect is only for the controller, in play and in the unlock phase',
        run() {
            const turn = createAsylumTurn()
            const { gameState, player, asylum } = turn
            const other = gameState.orderedPlayers.find(candidate => candidate != player)
            if (!other) {
                throw new ScenarioFailure('No other player')
            }
            readyVampire(gameState, player, 1)
            readyVampire(gameState, other, 1)
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Unlock)
            gameState.turnResources.unlocked = true
            expectEqual(countUnlockEffects(turn), 0, 'in hand')

            gameState.moveCardToRegion(asylum, player.ready)
            expectEqual(countUnlockEffects(turn), 1, 'in play')
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Minion)
            expectEqual(countUnlockEffects(turn), 0, 'not in the unlock phase')

            // Stolen: the thief unlocks it, on their own vampires
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Unlock)
            must(gameMutations.takeControl.act(other, { card: asylum, controller: other }), 'steal')
            expectEqual(countUnlockEffects(turn), 0, 'stolen: the owner loses it')
            const targets = getUnlockEffectOptions(other)
            expectEqual(targets.length, 1, 'stolen: the thief gets it')
            expectEqual(targets[0].vampire.controller, other, 'on a vampire of the thief')
        },
    },
    {
        name: 'the Govern agent plays Asylum Hunting Ground once it can, Elder Library first',
        run() {
            const turn = createAsylumTurn()
            const { gameState, player } = turn
            const agent = new GovernAgent()
            expectEqual(
                getMasterDecision(turn).options.length,
                1,
                'only the way out without a Malkavian',
            )
            gameState.moveCardToRegion(getVampireOfClan(player, 'Malkavian'), player.ready)
            expectEqual(stepBot(player, agent)?.option.type, 'playMaster', 'plays it')
            expectEqual(stepBot(player, agent)?.option.type, 'endPhase', 'then ends the phase')

            const both = createAsylumTurn()
            const malkavian = getVampireOfClan(both.player, 'Malkavian')
            both.gameState.moveCardToRegion(malkavian, both.player.ready)
            const library = giveCard(both.gameState, both.player, ELDER_LIBRARY_ID)
            const step = stepBot(both.player, agent)
            if (step?.option.type != 'playMaster') {
                throw new ScenarioFailure('The agent does not play a master card')
            }
            expectEqual(step.option.card, library, 'Elder Library first')
        },
    },
    {
        name: 'the Govern agent unlocks first, then feeds the vampire with the least blood',
        run() {
            const turn = createAsylumTurn()
            const { gameState, player, asylum } = turn
            gameState.moveCardToRegion(asylum, player.ready)
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Unlock)
            gameState.turnResources.unlocked = false
            const [high, low] = [4, 2].map(blood => {
                const vampire = readyVampire(gameState, player, blood)
                vampire.minionAttrs.capacity = 5
                return vampire
            })
            const agent = new GovernAgent()

            expectEqual(stepBot(player, agent)?.option.type, 'unlockAll', 'unlocks first')
            expectEqual(stepBot(player, agent)?.option.type, 'unlockEffect', 'then the effect')
            expectEqual(low.blood, 3, 'the emptiest vampire gets the blood')
            expectEqual(high.blood, 4, 'the other one does not')
            expectEqual(stepBot(player, agent)?.option.type, 'endPhase', 'then ends the phase')

            // Everybody is full: no vampire is chosen
            const full = createAsylumTurn()
            full.gameState.moveCardToRegion(full.asylum, full.player.ready)
            full.gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Unlock)
            full.gameState.turnResources.unlocked = false
            const vampire = readyVampire(full.gameState, full.player, 5)
            vampire.minionAttrs.capacity = 5
            expectEqual(stepBot(full.player, agent)?.option.type, 'unlockAll', 'unlocks first')
            expectEqual(stepBot(full.player, agent)?.option.type, 'endPhase', 'no vampire to feed')
            expectEqual(vampire.blood, 5, 'never above the capacity')
        },
    },
    {
        name: 'with queued mutations ( the browser ) the draw to hand size ends and queues the right count',
        run() {
            const turn = createMasterPhase()
            const { player } = turn
            const queue = registerQueuedMutationTrigger()
            try {
                const decision = getMasterDecision(turn)
                applyOption(decision, findOption(decision.options, 'playMaster'))
                queue.flush()
                expectEqual(player.handSize, 8, 'hand size')
                expectEqual(player.hand.length, 6, 'hand before the draw')

                // The next decision draws back: it must not loop on the hand length
                const next = getMasterDecision(turn)
                applyOption(next, findOption(next.options, 'endPhase'))
                expectEqual(queue.queued() >= 2, true, 'draws queued')
                queue.flush()
                expectEqual(player.hand.length, 8, 'hand after the draw')
            } finally {
                registerSyncMutationTrigger()
            }
        },
    },
    {
        name: 'a card is unique when its first line says so, and not when it says non-unique',
        run() {
            const { gameState, players } = createHeadlessGame([
                { ...GovernDeck, [FORGERS_HAMMER_ID]: 1 },
                GovernDeck,
            ])
            createdGames.push(gameState)
            const [player] = players
            expectEqual(findHeldCard(player, ELDER_LIBRARY_ID).isUnique, true, 'Elder Library')
            expectEqual(findHeldCard(player, ASYLUM_HUNTING_GROUND_ID).isUnique, true, 'Asylum')
            expectEqual(findHeldCard(player, GOVERN_ID).isUnique, false, 'Govern')
            expectEqual(findHeldCard(player, DEFLECTION_ID).isUnique, false, 'Deflection')
            expectEqual(findHeldCard(player, FORGERS_HAMMER_ID).isUnique, false, 'non-unique text')
        },
    },
    {
        name: 'a unique master is not offered while another copy is in play, whoever has it',
        run() {
            const turn = createUniqueTurn()
            const { gameState, player, other, theirs, library } = turn
            expectEqual(countMasterOptions(turn), 0, 'a copy in another play area')

            gameState.moveCardToRegion(theirs, other.ashHeap)
            expectEqual(countMasterOptions(turn), 1, 'the other copy is burned')

            gameState.moveCardToRegion(theirs, other.library)
            expectEqual(countMasterOptions(turn), 1, 'the other copy is not in play')

            gameState.moveCardToRegion(theirs, player.ready)
            expectEqual(countMasterOptions(turn), 0, 'a copy in its own play area')
            expectEqual(library.isIn.hand, true, 'the card stays in hand')
        },
    },
    {
        name: 'the Govern agent does not play a dead unique master',
        run() {
            const turn = createUniqueTurn()
            const step = stepBot(turn.player, new GovernAgent())
            expectEqual(step?.option.type, 'endPhase', 'ends the master phase')
            expectEqual(turn.library.isIn.hand, true, 'still in hand')
        },
    },
    {
        name: 'the Govern agent discards a dead unique card in its discard phase, then draws back',
        run() {
            const turn = createUniqueTurn()
            const { gameState, player, library } = turn
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Discard)
            const dpa = gameState.turnResources.dpa
            const ash = player.ashHeap.length
            const libraryLength = player.library.length
            expectEqual(player.hand.length, 7, 'hand before')
            expectEqual(getMasterDecision(turn).kind, DecisionKind.Discard, 'decision kind')

            const step = stepBot(player, new GovernAgent())
            expectEqual(step?.option.type, 'discard', 'step')
            expectEqual(library.isIn.ashHeap, true, 'in the ash heap')
            expectEqual(player.ashHeap.length, ash + 1, 'ash heap')
            expectEqual(gameState.turnResources.dpa, dpa - 1, 'discard phase action spent')
            expectEqual(player.hand.length, 7, 'drawn back to the hand size')
            expectEqual(player.library.length, libraryLength - 1, 'one card drawn')

            const next = getMasterDecision(turn)
            expectEqual(next.options.length, 1, 'no discard left')
            findOption(next.options, 'endTurn')
        },
    },
    {
        name: 'the Govern agent discards the dead unique card even when it holds Govern',
        run() {
            const turn = createUniqueTurn()
            const { gameState, player, library } = turn
            const govern = giveCard(gameState, player, GOVERN_ID)
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Discard)
            const step = stepBot(player, new GovernAgent())
            if (step?.option.type != 'discard') {
                throw new ScenarioFailure('The agent does not discard')
            }
            expectEqual(step.option.card, library, 'the dead card')
            expectEqual(govern.isIn.hand, true, 'Govern kept')
        },
    },
    {
        name: 'the Govern agent keeps a unique card that can still be played',
        run() {
            const turn = createUniqueTurn()
            const { gameState, player, other, theirs, library } = turn
            gameState.moveCardToRegion(theirs, other.ashHeap)
            giveCard(gameState, player, GOVERN_ID)
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Discard)
            const step = stepBot(player, new GovernAgent())
            expectEqual(step?.option.type, 'endTurn', 'discards nothing')
            expectEqual(library.isIn.hand, true, 'still in hand')
        },
    },
    {
        name: 'a bot over its hand size discards the dead unique card first',
        run() {
            const turn = createUniqueTurn()
            const { gameState, player, library } = turn
            giveCard(gameState, player, GOVERN_ID)
            const extra = player.library.cards.find(
                card => card.krcgId != GOVERN_ID && card.krcgId != ELDER_LIBRARY_ID,
            )
            if (!extra) {
                throw new ScenarioFailure('No card left to draw')
            }
            gameState.moveCardToRegion(extra, player.hand)
            expectEqual(player.hand.length, 8, 'hand')
            const step = stepBot(player, new GovernAgent())
            if (step?.option.type != 'discardExcess') {
                throw new ScenarioFailure('The agent does not discard the excess')
            }
            expectEqual(step.option.card, library, 'the dead card')
        },
    },
]

type ScenarioResult = { name: string; error: string | null }

/**
 * Cards described in the catalog ( the Malkavian precon ): conditions, the limited rule, plays of
 * several kinds, per level plays.
 */

const CONDITIONING_ID = '100401'
const BONDING_ID = '100236'
const FORESHADOWING_ID = '100765'
const SWALLOWED_ID = '101913'
const TELEPATHIC_ID = '101949'
const CLOAK_ID = '100362'
const QUI_VIVE_ID = '101321'
const BARRENS_ID = '100135'
const WIDER_VIEW_ID = '102180'
const FACELESS_NIGHT_ID = '100687'
const EYES_OF_ARGUS_ID = '100680'
const LIFE_IN_THE_CITY_ID = '101104'

// The influence phase of a player with Wider View in play and the transfers
function createWiderViewTurn(transfers: number) {
    const { gameState } = createHeadlessGame([MalkavDeck, MalkavDeck])
    createdGames.push(gameState)
    const player = gameState.activePlayer
    if (!player) {
        throw new ScenarioFailure('No active player')
    }
    const card = giveCard(gameState, player, WIDER_VIEW_ID)
    gameState.moveCardToRegion(card, player.ready)
    gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Influence)
    gameState.turnResources.unlocked = true
    gameState.turnResources.transfers = transfers
    const decision = getDecisionPoint(gameState, player)
    if (!decision) {
        throw new ScenarioFailure('No decision point')
    }
    return { gameState, player, card, decision }
}

// The master phase of a player holding Life in the City, with two ready vampires
function createLifeInTheCityTurn(bloods: [number, number]) {
    const { gameState } = createHeadlessGame([MalkavDeck, MalkavDeck])
    createdGames.push(gameState)
    const player = gameState.activePlayer
    if (!player) {
        throw new ScenarioFailure('No active player')
    }
    emptyHand(gameState, player)
    const card = giveCard(gameState, player, LIFE_IN_THE_CITY_ID)
    const vampires = bloods.map(blood => readyVampire(gameState, player, blood))
    gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Master)
    gameState.turnResources.unlocked = true
    const decision = getDecisionPoint(gameState, player)
    if (!decision) {
        throw new ScenarioFailure('No decision point')
    }
    return { gameState, player, card, vampires, decision }
}

type CatalogBleedSetup = {
    discipline: Discipline
    level: DisciplineLevel
    // The hand of the acting player
    cards: string[]
    actionType?: MinionActionType
    // The hand of the prey and the discipline of its vampire
    preyCards?: string[]
    preyDiscipline?: [Discipline, DisciplineLevel]
    // Malkavian by default
    deck?: DeckList
    // The crypt cards to use instead of the first uncontrolled vampires
    bleederId?: string
    preyVampireId?: string
}

type CatalogBleed = {
    gameState: GameState
    bleeder: Player
    bled: Player
    third: Player
    bleeding: Vampire
    blocker: Vampire
}

// The first player declares an action ( a bleed ) against its prey, with a vampire that has the
// discipline at the level. The prey has one ready vampire. Three players.
function createCatalogBleed(setup: CatalogBleedSetup): CatalogBleed {
    const deck = setup.deck ?? MalkavDeck
    const { gameState, players } = createHeadlessGame([deck, deck, deck])
    createdGames.push(gameState)
    const bleeder = gameState.activePlayer
    const bled = bleeder?.prey
    const third = bled?.prey
    if (!bleeder || !bled || !third) {
        throw new ScenarioFailure('No active player or no prey')
    }
    for (const player of players) {
        emptyHand(gameState, player)
    }
    gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Minion)
    gameState.turnResources.unlocked = true

    const bleeding =
        setup.bleederId ?
            readySpecific(gameState, bleeder, setup.bleederId, 5)
        :   readyVampire(gameState, bleeder, 5)
    bleeding.minionAttrs.disciplines[setup.discipline] = setup.level
    bleeding.minionAttrs.disciplines[Discipline.Obfuscate] ??= DisciplineLevel.INFERIOR
    const blocker =
        setup.preyVampireId ?
            readySpecific(gameState, bled, setup.preyVampireId, 3)
        :   readyVampire(gameState, bled, 3)
    if (setup.preyDiscipline) {
        blocker.minionAttrs.disciplines[setup.preyDiscipline[0]] = setup.preyDiscipline[1]
    }
    for (const id of setup.cards) {
        giveCard(gameState, bleeder, id)
    }
    for (const id of setup.preyCards ?? []) {
        giveCard(gameState, bled, id)
    }
    for (const player of players) {
        sealLibrary(gameState, player)
    }

    const actionType = setup.actionType ?? MinionActionType.Bleed
    const decision = getDecisionPoint(gameState, bleeder)
    const declare = decision?.options.find(
        option =>
            option.type == 'declareAction' &&
            option.action.type == actionType &&
            option.action.actingMinion == bleeding,
    )
    if (!decision || !declare) {
        throw new ScenarioFailure(`The ${actionType} is not offered`)
    }
    applyOption(decision, declare)
    return { gameState, bleeder, bled, third, bleeding, blocker }
}

// The players pass ( no block, no reaction ) until the player has a decision to make
function passUntilDecides(gameState: GameState, who: Player): DecisionPoint {
    for (let i = 0; i < 8; i++) {
        const decider = getDecidingPlayer(gameState)
        const decision = decider && getDecisionPoint(gameState, decider)
        if (!decider || !decision) {
            throw new ScenarioFailure('Nobody has a decision')
        }
        if (decider == who) {
            return decision
        }
        const pass = decision.options.find(option =>
            ['noBlock', 'noReaction', 'noModifier'].includes(option.type),
        )
        if (!pass) {
            throw new ScenarioFailure(`${decider.name} cannot pass`)
        }
        applyOption(decision, pass)
    }
    throw new ScenarioFailure(`${who.name} never has a decision`)
}

const modifierOptionsOf = (decision: DecisionPoint, krcgId: string) =>
    optionsOfType(decision.options, 'playModifier').filter(
        option => option.modifier.card.krcgId == krcgId,
    )

const modifierLevel = (option: ReturnType<typeof modifierOptionsOf>[number]) =>
    option.modifier.usage.disciplines?.[0]?.level

const CATALOG_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'Conditioning is offered at both levels during a bleed, the superior one adds 3 bleed and costs a blood',
        run() {
            const game = createCatalogBleed({
                discipline: Discipline.Dominate,
                level: DisciplineLevel.SUPERIOR,
                cards: [CONDITIONING_ID],
            })
            const decision = passUntilDecides(game.gameState, game.bleeder)
            const options = modifierOptionsOf(decision, CONDITIONING_ID)
            expectEqual(options.length, 2, 'both levels')
            const superior = options.find(
                option => modifierLevel(option) == DisciplineLevel.SUPERIOR,
            )
            if (!superior) {
                throw new ScenarioFailure('The superior level is not offered')
            }
            const before = game.gameState.action?.bleed ?? 0
            applyOption(decision, superior)
            expectEqual(game.gameState.action?.bleed, before + 3, 'bleed')
            expectEqual(game.bleeding.blood, 4, 'blood paid')
        },
    },
    {
        name: 'a minion with the inferior level only is offered the inferior Conditioning, +2 bleed',
        run() {
            const game = createCatalogBleed({
                discipline: Discipline.Dominate,
                level: DisciplineLevel.INFERIOR,
                cards: [CONDITIONING_ID],
            })
            const decision = passUntilDecides(game.gameState, game.bleeder)
            const options = modifierOptionsOf(decision, CONDITIONING_ID)
            expectEqual(options.length, 1, 'one level')
            const before = game.gameState.action?.bleed ?? 0
            applyOption(decision, options[0])
            expectEqual(game.gameState.action?.bleed, before + 2, 'bleed')
        },
    },
    {
        name: 'Conditioning is not offered when the action is not a bleed, other modifiers still are',
        run() {
            const game = createCatalogBleed({
                discipline: Discipline.Dominate,
                level: DisciplineLevel.SUPERIOR,
                cards: [CONDITIONING_ID, LOST_IN_CROWDS_ID],
                actionType: MinionActionType.Hunt,
            })
            const decision = passUntilDecides(game.gameState, game.bleeder)
            expectEqual(modifierOptionsOf(decision, CONDITIONING_ID).length, 0, 'Conditioning')
            expectEqual(
                modifierOptionsOf(decision, LOST_IN_CROWDS_ID).length > 0,
                true,
                'Lost in Crowds is the proof that modifiers were offered',
            )
        },
    },
    {
        name: 'only one limited bleed bonus per action: a second one is refused, other modifiers are not',
        run() {
            const game = createCatalogBleed({
                discipline: Discipline.Dominate,
                level: DisciplineLevel.SUPERIOR,
                cards: [CONDITIONING_ID, BONDING_ID, LOST_IN_CROWDS_ID],
            })
            const decision = passUntilDecides(game.gameState, game.bleeder)
            expectEqual(modifierOptionsOf(decision, BONDING_ID).length, 2, 'Bonding before')
            applyOption(decision, modifierOptionsOf(decision, CONDITIONING_ID)[0])

            const next = getDecisionPoint(game.gameState, game.bleeder)
            if (!next) {
                throw new ScenarioFailure('The acting player lost the impulse')
            }
            expectEqual(modifierOptionsOf(next, BONDING_ID).length, 0, 'Bonding after')
            expectEqual(
                modifierOptionsOf(next, LOST_IN_CROWDS_ID).length > 0,
                true,
                'Lost in Crowds',
            )
        },
    },
    {
        name: 'Foreshadowing Destruction superior is only offered against a Methuselah with 9 pool or less',
        run() {
            for (const [pool, superiorOffered] of [
                [10, false],
                [9, true],
            ] as const) {
                const game = createCatalogBleed({
                    discipline: Discipline.Dominate,
                    level: DisciplineLevel.SUPERIOR,
                    cards: [FORESHADOWING_ID],
                })
                game.bled.pool = pool
                const decision = passUntilDecides(game.gameState, game.bleeder)
                const levels = modifierOptionsOf(decision, FORESHADOWING_ID).map(modifierLevel)
                expectEqual(levels.includes(DisciplineLevel.INFERIOR), true, `inferior at ${pool}`)
                expectEqual(
                    levels.includes(DisciplineLevel.SUPERIOR),
                    superiorOffered,
                    `superior at ${pool}`,
                )
            }
        },
    },
    {
        name: 'Swallowed by the Night is a stealth modifier at inferior only: no superior modifier',
        run() {
            const game = createCatalogBleed({
                discipline: Discipline.Obfuscate,
                level: DisciplineLevel.SUPERIOR,
                cards: [SWALLOWED_ID],
            })
            const decision = passUntilDecides(game.gameState, game.bleeder)
            const options = modifierOptionsOf(decision, SWALLOWED_ID)
            expectEqual(options.length, 1, 'modifier options')
            expectEqual(modifierLevel(options[0]), DisciplineLevel.INFERIOR, 'level')
            const before = game.gameState.action?.stealth ?? 0
            applyOption(decision, options[0])
            expectEqual(game.gameState.action?.stealth, before + 1, 'stealth')
        },
    },
    {
        name: 'Life in the City is offered once per ready vampire below capacity, and gives the chosen one 1 blood',
        run() {
            const turn = createLifeInTheCityTurn([1, 1])
            const [first, second] = turn.vampires
            expectEqual(optionsOfType(turn.decision.options, 'playMaster').length, 2, 'options')
            second.blood = second.minionAttrs.capacity
            const decision = getDecisionPoint(turn.gameState, turn.player)
            if (!decision) {
                throw new ScenarioFailure('No decision point')
            }
            const options = optionsOfType(decision.options, 'playMaster')
            expectEqual(options.length, 1, 'options: the full vampire is not a target')
            expectEqual(options[0].target, first, 'target')
            applyOption(decision, options[0])
            expectEqual(first.blood, 2, 'blood of the target')
            expectEqual(second.blood, second.minionAttrs.capacity, 'blood of the other')
            expectEqual(turn.gameState.turnResources.mpa, 0, 'master phase action')
        },
    },
    {
        name: 'Life in the City is not offered when no ready vampire can gain blood',
        run() {
            const turn = createLifeInTheCityTurn([1, 1])
            for (const vampire of turn.vampires) {
                vampire.blood = vampire.minionAttrs.capacity
            }
            const decision = getDecisionPoint(turn.gameState, turn.player)
            if (!decision) {
                throw new ScenarioFailure('No decision point')
            }
            expectEqual(optionsOfType(decision.options, 'playMaster').length, 0, 'options')
        },
    },
    {
        name: 'The Barrens: lock it to discard a card of the hand, which is drawn back up; not offered while locked',
        run() {
            const { gameState } = createHeadlessGame([MalkavDeck, MalkavDeck])
            createdGames.push(gameState)
            const player = gameState.activePlayer
            if (!player) {
                throw new ScenarioFailure('No active player')
            }
            const barrens = giveCard(gameState, player, BARRENS_ID)
            gameState.moveCardToRegion(barrens, player.ready)
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Master)
            gameState.turnResources.unlocked = true

            const decision = getDecisionPoint(gameState, player)
            if (!decision) {
                throw new ScenarioFailure('No decision point')
            }
            const options = optionsOfType(decision.options, 'lockEffect')
            expectEqual(options.length, player.hand.length, 'one option per card of the hand')
            const ashHeap = player.ashHeap.length
            applyOption(decision, options[0])
            expectEqual(barrens.isLocked, true, 'locked')
            expectEqual(player.ashHeap.length, ashHeap + 1, 'ash heap')
            expectEqual(player.hand.length, player.handSize, 'hand drawn back up')

            const next = getDecisionPoint(gameState, player)
            expectEqual(
                next ? optionsOfType(next.options, 'lockEffect').length : -1,
                0,
                'not offered while locked',
            )
        },
    },
    {
        name: 'Faceless Night superior locks the minion whose block fails, inferior does not',
        run() {
            for (const [level, locked] of [
                [DisciplineLevel.SUPERIOR, true],
                [DisciplineLevel.INFERIOR, false],
            ] as const) {
                const game = createCatalogBleed({
                    discipline: Discipline.Obfuscate,
                    level,
                    cards: [FACELESS_NIGHT_ID],
                })
                const { gameState, bleeder, bled, blocker } = game
                blocker.minionAttrs.intercept = 0
                const first = passUntilDecides(gameState, bled)
                applyOption(
                    first,
                    optionsOfType(first.options, 'block').find(
                        option => option.minion == blocker,
                    ) ?? findOption(first.options, 'block'),
                )
                const decision = getDecisionPoint(gameState, bleeder)
                const played =
                    decision ?
                        modifierOptionsOf(decision, FACELESS_NIGHT_ID).find(
                            option => modifierLevel(option) == level,
                        )
                    :   undefined
                if (!decision || !played) {
                    throw new ScenarioFailure('Faceless Night is not offered')
                }
                applyOption(decision, played)
                expectEqual(blocker.isLocked, false, 'not locked yet, the block is not resolved')

                // Everybody passes until the action is over
                for (let i = 0; i < 12 && gameState.action; i++) {
                    const decider = getDecidingPlayer(gameState)
                    const next = decider && getDecisionPoint(gameState, decider)
                    // A standing block is kept: "no reaction" comes before "no block"
                    const pass = ['noModifier', 'noReaction', 'noBlock']
                        .map(type => next?.options.find(option => option.type == type))
                        .find(Boolean)
                    if (!next || !pass) {
                        throw new ScenarioFailure('Nobody can pass')
                    }
                    applyOption(next, pass)
                }
                expectEqual(gameState.action, null, 'the action is over')
                expectEqual(blocker.isLocked, locked, `blocker locked at ${level}`)
            }
        },
    },
    {
        name: 'Wider View: 1 transfer draws a crypt card and removes an uncontrolled one from the game',
        run() {
            const turn = createWiderViewTurn(2)
            const { gameState, player, decision } = turn
            const options = optionsOfType(decision.options, 'transferEffect').filter(
                option => option.ability == 0,
            )
            expectEqual(
                options.length,
                player.uncontrolled.length,
                'one removal option per uncontrolled card',
            )
            expectEqual(
                optionsOfType(decision.options, 'transferEffect').length,
                options.length,
                'the burn needs 4 transfers',
            )
            const removed = options[0].removed
            const crypt = player.crypt.length
            const uncontrolled = player.uncontrolled.length
            applyOption(decision, options[0])
            expectEqual(gameState.turnResources.transfers, 1, 'transfers')
            expectEqual(player.crypt.length, crypt - 1, 'crypt')
            expectEqual(player.uncontrolled.length, uncontrolled, 'uncontrolled: one in, one out')
            expectEqual(removed?.isIn.removed, true, 'removed from the game')
        },
    },
    {
        name: 'Wider View with no uncontrolled card removes the card drawn, 4 transfers burn it for 2 pool',
        run() {
            const turn = createWiderViewTurn(4)
            const { gameState, player, card } = turn
            for (const vampire of [...player.uncontrolled.cards]) {
                gameState.moveCardToRegion(vampire, player.crypt)
            }
            const decision = getDecisionPoint(gameState, player)
            if (!decision) {
                throw new ScenarioFailure('No decision point')
            }
            const draws = optionsOfType(decision.options, 'transferEffect').filter(
                option => option.ability == 0,
            )
            expectEqual(draws.length, 1, 'the card drawn is removed')
            expectEqual(draws[0].removed, undefined, 'no removal choice')
            const crypt = player.crypt.length
            applyOption(decision, draws[0])
            expectEqual(player.crypt.length, crypt - 1, 'crypt')
            expectEqual(player.removed.length, 1, 'removed from the game')
            expectEqual(player.uncontrolled.length, 0, 'nothing uncontrolled')

            const next = getDecisionPoint(gameState, player)
            const burn = next?.options.filter(
                option => option.type == 'transferEffect' && option.ability == 1,
            )
            expectEqual(burn?.length, 0, 'burn: 3 transfers left, 4 needed')
            gameState.turnResources.transfers = 4
            const again = getDecisionPoint(gameState, player)
            const burns = again ? optionsOfType(again.options, 'transferEffect') : []
            const burning = burns.find(option => option.ability == 1)
            if (!again || !burning) {
                throw new ScenarioFailure('The burn is not offered with 4 transfers')
            }
            const pool = player.pool
            applyOption(again, burning)
            expectEqual(gameState.turnResources.transfers, 0, 'transfers')
            expectEqual(player.pool, pool + 2, 'pool')
            expectEqual(card.isIn.ashHeap, true, 'burned')
        },
    },
    {
        name: 'Cloak the Gathering superior is played by another ready vampire, which gives the action +1 stealth',
        run() {
            const game = createCatalogBleed({
                discipline: Discipline.Dominate,
                level: DisciplineLevel.INFERIOR,
                cards: [CLOAK_ID],
            })
            const other = readyVampire(game.gameState, game.bleeder, 4)
            other.minionAttrs.disciplines[Discipline.Obfuscate] = DisciplineLevel.SUPERIOR
            other.lock()
            const decision = passUntilDecides(game.gameState, game.bleeder)
            const options = modifierOptionsOf(decision, CLOAK_ID)
            const byOther = options.filter(option => option.modifier.by == other)
            expectEqual(byOther.length, 1, 'options by the other vampire')
            expectEqual(
                options.some(option => option.modifier.by == undefined),
                true,
                'the acting minion plays the inferior level',
            )
            const before = game.gameState.action?.stealth ?? 0
            applyOption(decision, byOther[0])
            expectEqual(game.gameState.action?.stealth, before + 1, 'stealth')
            expectEqual(other.isLocked, true, 'the locked vampire stays locked')
        },
    },
    {
        name: 'Cloak the Gathering superior is not offered to the acting minion, nor to a vampire with the inferior level only',
        run() {
            const game = createCatalogBleed({
                discipline: Discipline.Obfuscate,
                level: DisciplineLevel.SUPERIOR,
                cards: [CLOAK_ID],
            })
            const other = readyVampire(game.gameState, game.bleeder, 4)
            other.minionAttrs.disciplines[Discipline.Obfuscate] = DisciplineLevel.INFERIOR
            const decision = passUntilDecides(game.gameState, game.bleeder)
            const options = modifierOptionsOf(decision, CLOAK_ID)
            expectEqual(options.length, 1, 'options')
            expectEqual(options[0].modifier.by, undefined, 'played by the acting minion')
            expectEqual(modifierLevel(options[0]), DisciplineLevel.INFERIOR, 'level')
        },
    },
    {
        name: 'Swallowed by the Night is a maneuver in combat at superior, and nothing at inferior',
        run() {
            for (const [level, offered] of [
                [DisciplineLevel.SUPERIOR, true],
                [DisciplineLevel.INFERIOR, false],
            ] as const) {
                const fight = createFight(3, 3, MalkavDeck)
                fight.acting.minionAttrs.disciplines[Discipline.Obfuscate] = level
                const card = giveCard(fight.gameState, fight.actingPlayer, SWALLOWED_ID)
                passUntil(fight, CombatStep.DetermineRange)
                const decision = getCombatDecision(fight, fight.actingPlayer)
                const maneuvers = optionsOfType(decision.options, 'combatManeuver').filter(
                    option => option.card == card,
                )
                expectEqual(maneuvers.length, offered ? 1 : 0, `maneuver at ${level}`)
            }
        },
    },
    {
        name: 'Telepathic Misdirection inferior adds intercept, only while the own block attempt stands',
        run() {
            const game = createCatalogBleed({
                discipline: Discipline.Dominate,
                level: DisciplineLevel.INFERIOR,
                cards: [],
                preyCards: [TELEPATHIC_ID],
                preyDiscipline: [Discipline.Auspex, DisciplineLevel.INFERIOR],
            })
            const { gameState, bleeder, bled, blocker } = game
            const first = passUntilDecides(gameState, bled)
            expectEqual(optionsOfType(first.options, 'playReaction').length, 0, 'before the block')

            applyOption(
                first,
                optionsOfType(first.options, 'block').find(option => option.minion == blocker) ??
                    findOption(first.options, 'block'),
            )
            decideWith(gameState, bleeder, 'noModifier')
            const decision = getDecisionPoint(gameState, bled)
            const reactions = decision ? optionsOfType(decision.options, 'playReaction') : []
            expectEqual(reactions.length, 1, 'reaction options')
            const before = gameState.action?.intercept ?? 0
            if (decision) {
                applyOption(decision, reactions[0])
            }
            expectEqual(gameState.action?.intercept, before + 1, 'intercept')
            expectEqual(blocker.blood, 2, 'blood paid')
        },
    },
    {
        name: 'Telepathic Misdirection superior bounces the bleed like Deflection and locks the vampire',
        run() {
            const game = createCatalogBleed({
                discipline: Discipline.Dominate,
                level: DisciplineLevel.INFERIOR,
                cards: [],
                preyCards: [TELEPATHIC_ID],
                preyDiscipline: [Discipline.Auspex, DisciplineLevel.SUPERIOR],
            })
            const { gameState, bled, third, blocker } = game
            // The prey declines to block, then the bounce is possible
            const first = passUntilDecides(gameState, bled)
            applyOption(first, findOption(first.options, 'noBlock'))
            const decision = passUntilDecides(gameState, bled)
            const options = optionsOfType(decision.options, 'playReaction')
            const bounce = options.find(
                option => option.effect.type == 'changeTarget' && option.effect.target == third,
            )
            if (!bounce) {
                throw new ScenarioFailure('The bounce is not offered')
            }
            applyOption(decision, bounce)
            expectEqual(gameState.action?.minionAction.target, third, 'new target')
            expectEqual(blocker.isLocked, true, 'locked')
        },
    },
    {
        name: 'On the Qui Vive wakes a locked minion, which can then attempt to block',
        run() {
            const game = createCatalogBleed({
                discipline: Discipline.Dominate,
                level: DisciplineLevel.INFERIOR,
                cards: [],
                preyCards: [QUI_VIVE_ID],
            })
            const { gameState, bled, blocker } = game
            blocker.lock()
            const decision = passUntilDecides(gameState, bled)
            expectEqual(
                optionsOfType(decision.options, 'block').length,
                0,
                'a locked minion cannot block',
            )
            const wakes = optionsOfType(decision.options, 'playReaction').filter(
                option => option.effect.type == 'wake' && option.minion == blocker,
            )
            expectEqual(wakes.length, 1, 'wake options')
            applyOption(decision, wakes[0])
            expectEqual(blocker.isLocked, true, 'still locked')
            expectEqual(
                gameState.playedSinceUnlock[blocker.oid]?.includes(QUI_VIVE_ID),
                true,
                'the play is remembered',
            )

            const next = passUntilDecides(gameState, bled)
            expectEqual(
                optionsOfType(next.options, 'block').filter(option => option.minion == blocker)
                    .length,
                1,
                'the woken minion can block',
            )
            expectEqual(
                optionsOfType(next.options, 'playReaction').length,
                0,
                'no second wake for the same minion',
            )
        },
    },
    {
        name: 'On the Qui Vive is for locked minions only, once between unlock phases',
        run() {
            const game = createCatalogBleed({
                discipline: Discipline.Dominate,
                level: DisciplineLevel.INFERIOR,
                cards: [],
                preyCards: [QUI_VIVE_ID],
            })
            const { gameState, bled, blocker } = game
            const wakeOptions = (decision: DecisionPoint) =>
                optionsOfType(decision.options, 'playReaction').filter(
                    option => option.effect.type == 'wake',
                )
            expectEqual(
                wakeOptions(passUntilDecides(gameState, bled)).length,
                0,
                'an unlocked minion',
            )

            blocker.lock()
            gameState.playedSinceUnlock[blocker.oid] = [QUI_VIVE_ID]
            expectEqual(
                wakeOptions(passUntilDecides(gameState, bled)).length,
                0,
                'already played since the unlock phase',
            )

            gameMutations.unlockAll.act(bled, { player: bled })
            expectEqual(gameState.playedSinceUnlock[blocker.oid], undefined, 'forgotten at unlock')
        },
    },
    {
        name: 'Eyes of Argus superior wakes a locked vampire, inferior adds 2 intercept to an unlocked blocker',
        run() {
            const woken = createCatalogBleed({
                discipline: Discipline.Dominate,
                level: DisciplineLevel.INFERIOR,
                cards: [],
                preyCards: [EYES_OF_ARGUS_ID],
                preyDiscipline: [Discipline.Auspex, DisciplineLevel.SUPERIOR],
            })
            woken.blocker.lock()
            const decision = passUntilDecides(woken.gameState, woken.bled)
            const reactions = optionsOfType(decision.options, 'playReaction')
            expectEqual(reactions.length, 1, 'options for a locked vampire')
            expectEqual(reactions[0].effect.type, 'wake', 'the only thing it can do is wake')

            const inferior = createCatalogBleed({
                discipline: Discipline.Dominate,
                level: DisciplineLevel.INFERIOR,
                cards: [],
                preyCards: [EYES_OF_ARGUS_ID],
                preyDiscipline: [Discipline.Auspex, DisciplineLevel.INFERIOR],
            })
            const { gameState, bleeder, bled, blocker } = inferior
            const first = passUntilDecides(gameState, bled)
            expectEqual(optionsOfType(first.options, 'playReaction').length, 0, 'before the block')
            applyOption(
                first,
                optionsOfType(first.options, 'block').find(option => option.minion == blocker) ??
                    findOption(first.options, 'block'),
            )
            decideWith(gameState, bleeder, 'noModifier')
            const standing = getDecisionPoint(gameState, bled)
            const intercepts = standing ? optionsOfType(standing.options, 'playReaction') : []
            expectEqual(intercepts.length, 1, 'options during the block')
            const before = gameState.action?.intercept ?? 0
            if (standing) {
                applyOption(standing, intercepts[0])
            }
            expectEqual(gameState.action?.intercept, before + 2, 'intercept')
        },
    },
]

/**
 * Cards described in the catalog ( the Brujah precon ): requirements of the cardbase, variable
 * costs, combat cards.
 */

const ENCHANT_KINDRED_ID = '100640'
const MONKEY_WRENCH_ID = '101239'
const BAIT_AND_SWITCH_ID = '102218'
const WARZONE_ID = '102150'
const ROUNDHOUSE_ID = '102215'
const SLAM_ID = '101798'
const TORN_SIGNPOST_ID = '101993'
const OCTANE_ID = '201609'
const ATIENA_ID = '201579'
const RAYNE_ID = '201610'
const VALERIYA_ID = '201614'

// A fight between two Brujah in the first round, the acting one holding the card
function createBrujahFight(
    cardId: string,
    level: DisciplineLevel | null,
    actingBlood = 3,
    discipline = Discipline.Potence,
): Fight & { card: LibraryCard } {
    const fight = createFight(actingBlood, 3, BrujahDeck)
    // The vampire drawn may have a strength bonus (Valeriya, Theo Bell)
    fight.acting.minionAttrs.strength = 1
    getCombat(fight).acting.strength = 1
    fight.acting.minionAttrs.capacity = 10
    fight.acting.minionAttrs.disciplines = {} as Disciplines
    fight.defending.minionAttrs.strength = 1
    getCombat(fight).defending.strength = 1
    if (level) {
        fight.acting.minionAttrs.disciplines[discipline] = level
    }
    // A controlled hand: the card only, and nothing to draw
    emptyHand(fight.gameState, fight.actingPlayer)
    emptyHand(fight.gameState, fight.defendingPlayer)
    const card = giveCard(fight.gameState, fight.actingPlayer, cardId)
    sealLibrary(fight.gameState, fight.actingPlayer)
    sealLibrary(fight.gameState, fight.defendingPlayer)
    return { ...fight, card }
}

// The options of the acting player that come with the card
function cardOptionsOf<T extends CombatCardOption['type']>(
    fight: Fight,
    type: T,
    card: LibraryCard,
): Extract<CombatCardOption, { type: T }>[] {
    return getCombatDecision(fight, fight.actingPlayer).options.filter(
        (option): option is Extract<CombatCardOption, { type: T }> =>
            option.type == type && 'card' in option && option.card == card,
    )
}

// Plays the card with the first of its options of the type that the test accepts
function playCardOption<T extends CombatCardOption['type']>(
    fight: Fight,
    type: T,
    card: LibraryCard,
    accept: (option: Extract<CombatCardOption, { type: T }>) => boolean = () => true,
): void {
    const decision = getCombatDecision(fight, fight.actingPlayer)
    const option = decision.options.find(
        (candidate): candidate is Extract<CombatCardOption, { type: T }> =>
            candidate.type == type &&
            'card' in candidate &&
            candidate.card == card &&
            accept(candidate as Extract<CombatCardOption, { type: T }>),
    )
    if (!option) {
        throw new ScenarioFailure(`${type} of ${card.name} is not offered`)
    }
    applyOption(decision, option)
}

// The master phase of a player holding Warzone Hunting Ground as their only card
function createWarzoneTurn(cardId = WARZONE_ID): MasterTurn & { warzone: LibraryCard } {
    const { gameState } = createHeadlessGame([BrujahDeck, BrujahDeck])
    createdGames.push(gameState)
    const player = gameState.activePlayer
    if (!player) {
        throw new ScenarioFailure('No active player')
    }
    emptyHand(gameState, player)
    const warzone = giveCard(gameState, player, cardId)
    gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Master)
    gameState.turnResources.unlocked = true
    return { gameState, player, library: warzone, warzone }
}

const BRUJAH_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'Monkey Wrench is offered for X = 1, 2 and 3 to an Anarch, as many as its blood allows',
        run() {
            const game = createCatalogBleed({
                deck: BrujahDeck,
                bleederId: OCTANE_ID,
                discipline: Discipline.Presence,
                level: DisciplineLevel.SUPERIOR,
                cards: [MONKEY_WRENCH_ID],
            })
            passUntilDecides(game.gameState, game.bleeder)
            const xsAt = (blood: number) => {
                game.bleeding.blood = blood
                const decision = getDecisionPoint(game.gameState, game.bleeder)
                if (!decision) {
                    throw new ScenarioFailure('No decision point')
                }
                return modifierOptionsOf(decision, MONKEY_WRENCH_ID)
                    .map(option => option.modifier.usage.x)
                    .join()
            }
            expectEqual(xsAt(5), '1,2,3', 'X')
            expectEqual(xsAt(2), '1,2', 'X with 2 blood')
            expectEqual(xsAt(0), '', 'X with no blood')
        },
    },
    {
        name: 'Monkey Wrench pays X blood and adds X bleed, and needs an Anarch',
        run() {
            const game = createCatalogBleed({
                deck: BrujahDeck,
                bleederId: OCTANE_ID,
                discipline: Discipline.Presence,
                level: DisciplineLevel.SUPERIOR,
                cards: [MONKEY_WRENCH_ID],
            })
            const decision = passUntilDecides(game.gameState, game.bleeder)
            const three = modifierOptionsOf(decision, MONKEY_WRENCH_ID).find(
                option => option.modifier.usage.x == 3,
            )
            if (!three) {
                throw new ScenarioFailure('X = 3 is not offered')
            }
            const before = game.gameState.action?.bleed ?? 0
            applyOption(decision, three)
            expectEqual(game.gameState.action?.bleed, before + 3, 'bleed')
            expectEqual(game.bleeding.blood, 2, 'blood paid')

            const outsider = createCatalogBleed({
                deck: BrujahDeck,
                bleederId: OCTANE_ID,
                discipline: Discipline.Presence,
                level: DisciplineLevel.SUPERIOR,
                cards: [MONKEY_WRENCH_ID],
            })
            outsider.bleeding.vampireAttrs.sect = 'Camarilla'
            expectEqual(
                modifierOptionsOf(
                    passUntilDecides(outsider.gameState, outsider.bleeder),
                    MONKEY_WRENCH_ID,
                ).length,
                0,
                'a Camarilla vampire',
            )
        },
    },
    {
        name: 'Bait and Switch needs a baron: the bounce locks the baron, no offer for a plain Anarch',
        run() {
            const baron = createCatalogBleed({
                deck: BrujahDeck,
                discipline: Discipline.Presence,
                level: DisciplineLevel.SUPERIOR,
                cards: [],
                preyCards: [BAIT_AND_SWITCH_ID],
                preyVampireId: ATIENA_ID,
            })
            const { gameState, bled, third, blocker } = baron
            const first = passUntilDecides(gameState, bled)
            applyOption(first, findOption(first.options, 'noBlock'))
            const decision = passUntilDecides(gameState, bled)
            const bounce = optionsOfType(decision.options, 'playReaction').find(
                option => option.effect.type == 'changeTarget' && option.effect.target == third,
            )
            if (!bounce) {
                throw new ScenarioFailure('The bounce is not offered to a baron')
            }
            applyOption(decision, bounce)
            expectEqual(gameState.action?.minionAction.target, third, 'new target')
            expectEqual(blocker.isLocked, true, 'locked')

            const anarch = createCatalogBleed({
                deck: BrujahDeck,
                discipline: Discipline.Presence,
                level: DisciplineLevel.SUPERIOR,
                cards: [],
                preyCards: [BAIT_AND_SWITCH_ID],
                preyVampireId: RAYNE_ID,
            })
            const firstAnarch = passUntilDecides(anarch.gameState, anarch.bled)
            applyOption(firstAnarch, findOption(firstAnarch.options, 'noBlock'))
            const next = passUntilDecides(anarch.gameState, anarch.bled)
            expectEqual(
                optionsOfType(next.options, 'playReaction').length,
                0,
                'reactions for an Anarch that is not a baron',
            )
        },
    },
    {
        name: 'Enchant Kindred: a bleed at inferior, blood for a younger uncontrolled vampire at superior',
        run() {
            const turn = createMinionPhase(5, 0, BrujahDeck)
            turn.ready.minionAttrs.disciplines[Discipline.Presence] = DisciplineLevel.SUPERIOR
            turn.ready.minionAttrs.capacity = 6
            const young = turn.player.vampiresInUncontrolled[0]
            young.minionAttrs.capacity = 4
            young.blood = 1
            const card = giveCard(turn.gameState, turn.player, ENCHANT_KINDRED_ID)

            const { decision, options } = getActionOptions(
                turn,
                MinionActionType.ActionCardFromHand,
            )
            const mine = options.flatMap(option =>
                (
                    option.action.type == MinionActionType.ActionCardFromHand &&
                    option.action.card == card
                ) ?
                    [{ option, usage: option.action.usage }]
                :   [],
            )
            const level = (usage: LibraryCardUsage) => usage.disciplines?.[0]?.level
            const bleeds = mine.filter(({ usage }) => usage.target instanceof Player)
            expectEqual(bleeds.length, 1, 'bleed options')
            expectEqual(level(bleeds[0].usage), DisciplineLevel.INFERIOR, 'bleed level')
            const feed = mine.find(({ usage }) => usage.target == young)
            if (!feed) {
                throw new ScenarioFailure('The younger vampire is not a target')
            }
            expectEqual(level(feed.usage), DisciplineLevel.SUPERIOR, 'feed level')

            applyOption(decision, feed.option)
            resolveAction(turn)
            expectEqual(young.blood, 3, 'blood of the younger vampire')
        },
    },
    {
        name: 'Warzone Hunting Ground requires a ready Brujah and gives 1 blood in the unlock phase',
        run() {
            const turn = createWarzoneTurn()
            const { gameState, player, warzone } = turn
            expectEqual(countMasterOptions(turn), 0, 'no ready vampire')

            const octane = readySpecific(gameState, player, OCTANE_ID, 2)
            expectEqual(countMasterOptions(turn), 1, 'a ready Brujah')
            octane.vampireAttrs.clan = 'Malkavian'
            expectEqual(countMasterOptions(turn), 0, 'a ready Malkavian')
            octane.vampireAttrs.clan = 'Brujah'

            gameState.moveCardToRegion(warzone, player.ready)
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Unlock)
            expectEqual(countUnlockEffects(turn), 1, 'unlock effects')
            const decision = getMasterDecision(turn)
            applyOption(decision, findOption(decision.options, 'unlockEffect'))
            expectEqual(octane.blood, 3, 'blood gained')
        },
    },
    {
        name: 'Valeriya Zinovieva has +1 strength, which her hand strike deals',
        run() {
            const { gameState, players } = createHeadlessGame([BrujahDeck, BrujahDeck])
            createdGames.push(gameState)
            const valeriya = readySpecific(gameState, players[0], VALERIYA_ID, 5)
            const opponent = readySpecific(gameState, players[1], RAYNE_ID, 2)
            expectEqual(valeriya.minionAttrs.strength, 2, 'strength')
            expectEqual(opponent.minionAttrs.strength, 1, 'strength of a plain Anarch')
            gameState.combat = createCombatState(valeriya, opponent)
            expectEqual(
                createHandStrike(createCombatState(valeriya, opponent).acting).damage,
                2,
                'damage',
            )
        },
    },
    {
        name: 'Torn Signpost sets the strength before the range only, and only when it raises it',
        run() {
            const fight = createBrujahFight(TORN_SIGNPOST_ID, DisciplineLevel.SUPERIOR)
            const options = cardOptionsOf(fight, 'combatStrength', fight.card)
            expectEqual(options.map(option => option.amount).join(), '2,3', 'both levels')

            getCombat(fight).acting.strength = 2
            expectEqual(
                cardOptionsOf(fight, 'combatStrength', fight.card)
                    .map(option => option.amount)
                    .join(),
                '3',
                'a strength of 2 already',
            )

            getCombat(fight).acting.strength = 1
            playCardOption(fight, 'combatStrength', fight.card, option => option.amount == 3)
            expectEqual(getCombat(fight).acting.strength, 3, 'strength')
            expectEqual(getCombat(fight).step, CombatStep.BeforeRange, 'still before the range')
            expectEqual(getCombat(fight).impulsePlayer, fight.actingPlayer, 'impulse')
            expectEqual(fight.card.isIn.ready, true, 'the card is played')

            passUntil(fight, CombatStep.DetermineRange)
            expectEqual(
                cardOptionsOf(fight, 'combatStrength', fight.card).length,
                0,
                'in the range step',
            )
        },
    },
    {
        name: 'Torn Signpost strength lasts the combat: the hand strike deals it',
        run() {
            const fight = createBrujahFight(TORN_SIGNPOST_ID, DisciplineLevel.INFERIOR, 3)
            playCardOption(fight, 'combatStrength', fight.card)
            passUntil(fight, CombatStep.Strike)
            const decision = getCombatDecision(fight, fight.actingPlayer)
            const hand = optionsOfType(decision.options, 'combatStrike').find(
                option => !option.card,
            )
            expectEqual(hand?.strike.damage, 2, 'hand strike damage')
        },
    },
    {
        name: 'Roundhouse is a hand strike with 2 damage more at inferior, 3 at superior',
        run() {
            const inferior = createBrujahFight(ROUNDHOUSE_ID, DisciplineLevel.INFERIOR)
            passUntil(inferior, CombatStep.Strike)
            const options = cardOptionsOf(inferior, 'combatStrike', inferior.card)
            expectEqual(options.length, 1, 'inferior options')
            expectEqual(options[0].strike.damage, 3, 'inferior damage')
            expectEqual(options[0].strike.aggravated, false, 'aggravated')

            const superior = createBrujahFight(ROUNDHOUSE_ID, DisciplineLevel.SUPERIOR)
            passUntil(superior, CombatStep.Strike)
            const damages = cardOptionsOf(superior, 'combatStrike', superior.card)
                .map(option => option.strike.damage)
                .sort()
            expectEqual(damages.join(), '3,4', 'superior damages')
        },
    },
    {
        name: 'a Roundhouse strike deals its damage: more than the blood sends the vampire to torpor',
        run() {
            const fight = createBrujahFight(ROUNDHOUSE_ID, DisciplineLevel.SUPERIOR)
            passUntil(fight, CombatStep.Strike)
            playCardOption(fight, 'combatStrike', fight.card, option => option.strike.damage == 4)
            const decision = getCombatDecision(fight, fight.defendingPlayer)
            applyOption(decision, findOption(decision.options, 'combatStrike'))
            while (fight.gameState.combat) {
                const player = getDecidingPlayer(fight.gameState)
                const next = player && getDecisionPoint(fight.gameState, player)
                if (!next) {
                    throw new ScenarioFailure('The combat is stuck')
                }
                applyOption(next, findOption(next.options, 'combatPass'))
            }
            expectRegion(fight.defending, 'torpor')
        },
    },
    {
        name: 'Slam costs 1 blood; at superior its maneuver is only offered at long range, and brings the strike',
        run() {
            const inferior = createBrujahFight(SLAM_ID, DisciplineLevel.INFERIOR)
            getCombat(inferior).range = CombatRange.Long
            passUntil(inferior, CombatStep.DetermineRange)
            expectEqual(
                cardOptionsOf(inferior, 'combatManeuver', inferior.card).length,
                0,
                'maneuver at inferior',
            )
            passUntil(inferior, CombatStep.Strike)
            expectEqual(
                cardOptionsOf(inferior, 'combatStrike', inferior.card)[0]?.strike.damage,
                3,
                'inferior damage',
            )

            const close = createBrujahFight(SLAM_ID, DisciplineLevel.SUPERIOR)
            passUntil(close, CombatStep.DetermineRange)
            expectEqual(
                cardOptionsOf(close, 'combatManeuver', close.card).length,
                0,
                'maneuver at close range',
            )

            const far = createBrujahFight(SLAM_ID, DisciplineLevel.SUPERIOR)
            passUntil(far, CombatStep.DetermineRange)
            getCombat(far).range = CombatRange.Long
            const maneuvers = cardOptionsOf(far, 'combatManeuver', far.card)
            expectEqual(maneuvers.length, 1, 'maneuvers: the superior level only')
            playCardOption(far, 'combatManeuver', far.card)
            expectEqual(getCombat(far).range, CombatRange.Close, 'range')
            expectEqual(getCombat(far).acting.strike?.damage, 3, 'the maneuver chose the strike')
            expectEqual(far.acting.blood, 2, 'blood paid')
            expectEqual(far.card.isIn.ready, true, 'the card is played')
        },
    },
]

// The player with the impulse chooses the option of the type that the test accepts
function decideCombat<T extends CombatCardOption['type']>(
    fight: Fight,
    type: T,
    accept: (option: Extract<CombatCardOption, { type: T }>) => boolean = () => true,
): void {
    const player = getCombat(fight).impulsePlayer
    const decision = getCombatDecision(fight, player)
    const option = decision.options.find(
        (candidate): candidate is Extract<CombatCardOption, { type: T }> =>
            candidate.type == type && accept(candidate as Extract<CombatCardOption, { type: T }>),
    )
    if (!option) {
        throw new ScenarioFailure(`${type} is not offered at ${getCombat(fight).step}`)
    }
    applyOption(decision, option)
}

const countOptions = (fight: Fight, type: CombatCardOption['type']) =>
    getCombatDecision(fight, getCombat(fight).impulsePlayer).options.filter(
        option => option.type == type,
    ).length

const QUICKNESS_ID = '101532'
const PURSUIT_ID = '101523'
const DUST_UP_ID = '100597'
const GRAPPLE_ID = '100959'
const TASTE_OF_VITAE_ID = '101945'

const BRUJAH_COMBAT_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'Quickness is played after the pair of strikes: the minion strikes again alone, the opponent has no strike',
        run() {
            const fight = createBrujahFight(
                QUICKNESS_ID,
                DisciplineLevel.SUPERIOR,
                3,
                Discipline.Celerity,
            )
            expectEqual(countOptions(fight, 'combatAdditionalStrike'), 0, 'before the range')
            passUntil(fight, CombatStep.Strike)
            strikes(fight)
            passUntil(fight, CombatStep.AdditionalStrikes)
            expectEqual(fight.defending.blood, 2, 'blood of the defender after the first pair')
            expectEqual(
                countOptions(fight, 'combatAdditionalStrike'),
                2,
                'both levels: limited and not',
            )

            decideCombat(fight, 'combatAdditionalStrike', option => option.limited)
            const combat = getCombat(fight)
            expectEqual(combat.acting.additionalStrikes, 1, 'additional strikes')
            expectEqual(combat.acting.limitedAdditionalGained, true, 'limited gained')
            expectEqual(
                combat.playedThisRound[fight.acting.oid]?.includes(QUICKNESS_ID),
                true,
                'the play is remembered',
            )
            expectEqual(combat.impulsePlayer, fight.actingPlayer, 'impulse')

            passUntil(fight, CombatStep.Strike)
            expectEqual(combat.strikePair, 1, 'second pair')
            expectEqual(combat.defending.strikesInPair, false, 'the defender sits it out')
            expectEqual(combat.impulsePlayer, fight.actingPlayer, 'the acting minion chooses')
            decideCombat(fight, 'combatStrike')
            passUntil(fight, CombatStep.AdditionalStrikes)
            expectEqual(
                fight.defending.blood,
                1,
                'blood of the defender after the additional strike',
            )
            expectEqual(
                fight.acting.blood,
                2,
                'the acting minion took no damage in the second pair',
            )
            passUntil(fight, CombatStep.Press)
        },
    },
    {
        name: 'a limited additional strike is gained once per round, the unlimited level of Quickness is still offered',
        run() {
            const fight = createBrujahFight(
                QUICKNESS_ID,
                DisciplineLevel.SUPERIOR,
                3,
                Discipline.Celerity,
            )
            passUntil(fight, CombatStep.Strike)
            strikes(fight)
            passUntil(fight, CombatStep.AdditionalStrikes)
            getCombat(fight).acting.limitedAdditionalGained = true
            const options = optionsOfType(
                getCombatDecision(fight, fight.actingPlayer).options,
                'combatAdditionalStrike',
            )
            expectEqual(options.length, 1, 'options')
            expectEqual(options[0].limited, false, 'only the unlimited one')
        },
    },
    {
        name: 'Pursuit is a maneuver at inferior and a limited additional strike at superior',
        run() {
            const fight = createBrujahFight(
                PURSUIT_ID,
                DisciplineLevel.SUPERIOR,
                3,
                Discipline.Celerity,
            )
            passUntil(fight, CombatStep.DetermineRange)
            expectEqual(countOptions(fight, 'combatManeuver'), 1, 'maneuver')
            expectEqual(
                countOptions(fight, 'combatAdditionalStrike'),
                0,
                'no additional strike yet',
            )
            passUntil(fight, CombatStep.Strike)
            strikes(fight)
            passUntil(fight, CombatStep.AdditionalStrikes)
            const options = optionsOfType(
                getCombatDecision(fight, fight.actingPlayer).options,
                'combatAdditionalStrike',
            )
            expectEqual(options.length, 1, 'additional strike')
            expectEqual(options[0].limited, true, 'limited')
            expectEqual(countOptions(fight, 'combatManeuver'), 0, 'no maneuver in this window')
        },
    },
    {
        name: 'Dust Up with Animalism is an undodgeable hand strike +1: the dodge does not protect',
        run() {
            const fight = createBrujahFight(
                DUST_UP_ID,
                DisciplineLevel.INFERIOR,
                3,
                Discipline.Animalism,
            )
            passUntil(fight, CombatStep.Strike)
            const options = cardOptionsOf(fight, 'combatStrike', fight.card)
            expectEqual(options.length, 1, 'options')
            expectEqual(options[0].strike.damage, 2, 'damage')
            expectEqual(options[0].strike.undodgeable, true, 'undodgeable')
            playCardOption(fight, 'combatStrike', fight.card)
            must(
                gameMutations.COMBAT_chooseStrike.act(fight.defendingPlayer, {
                    minion: fight.defending,
                    strike: createDodgeStrike(),
                }),
                'the defender dodges',
            )
            passUntil(fight, CombatStep.AdditionalStrikes)
            expectEqual(fight.defending.blood, 1, 'the dodge did not protect: 2 damage')
        },
    },
    {
        name: 'Dust Up with Celerity is a dodge with one additional strike, if none was gained from a limited card',
        run() {
            const fight = createBrujahFight(
                DUST_UP_ID,
                DisciplineLevel.INFERIOR,
                3,
                Discipline.Celerity,
            )
            passUntil(fight, CombatStep.Strike)
            const [option] = cardOptionsOf(fight, 'combatStrike', fight.card)
            expectEqual(option.strike.dodge, true, 'dodge')
            expectEqual(option.additional?.limited, true, 'additional strike')

            getCombat(fight).acting.limitedAdditionalGained = true
            const [again] = cardOptionsOf(fight, 'combatStrike', fight.card)
            expectEqual(again.additional, undefined, 'no additional strike once the limit is used')
            getCombat(fight).acting.limitedAdditionalGained = false

            playCardOption(fight, 'combatStrike', fight.card)
            expectEqual(getCombat(fight).acting.additionalStrikes, 1, 'additional strikes')
            strikes(fight)
            passUntil(fight, CombatStep.AdditionalStrikes)
            expectEqual(fight.acting.blood, 3, 'the dodge protected the acting minion')
        },
    },
    {
        name: 'Immortal Grapple: before the strikes at close range only, then hand strikes only for the round',
        run() {
            const fight = createBrujahFight(GRAPPLE_ID, DisciplineLevel.SUPERIOR)
            expectEqual(countOptions(fight, 'combatGrapple'), 0, 'before the range')
            passUntil(fight, CombatStep.DetermineRange)
            expectEqual(countOptions(fight, 'combatGrapple'), 0, 'range step')
            passUntil(fight, CombatStep.BeforeStrikes)
            getCombat(fight).range = CombatRange.Long
            expectEqual(countOptions(fight, 'combatGrapple'), 0, 'long range')
            getCombat(fight).range = CombatRange.Close
            expectEqual(countOptions(fight, 'combatGrapple'), 2, 'both levels at close range')

            decideCombat(fight, 'combatGrapple', option => option.press)
            expectEqual(getCombat(fight).handStrikesOnly, true, 'hand strikes only')
            passUntil(fight, CombatStep.Strike)
            mustRefuse(
                gameMutations.COMBAT_chooseStrike.act(fight.actingPlayer, {
                    minion: fight.acting,
                    strike: createDodgeStrike(),
                }),
                'a dodge in a grappled round',
            )
            strikes(fight)
            passUntil(fight, CombatStep.Press)
        },
    },
    {
        name: 'a superior Immortal Grapple gives a press, and the next round is at close range with no range step',
        run() {
            const fight = createBrujahFight(GRAPPLE_ID, DisciplineLevel.SUPERIOR)
            passUntil(fight, CombatStep.BeforeStrikes)
            decideCombat(fight, 'combatGrapple', option => option.press)
            expectEqual(getCombat(fight).acting.pressesGranted, 1, 'press granted')
            passUntil(fight, CombatStep.Strike)
            strikes(fight)
            passUntil(fight, CombatStep.Press)

            expectEqual(countOptions(fight, 'combatPress'), 1, 'the granted press')
            decideCombat(fight, 'combatPress', option => !!option.granted)
            expectEqual(getCombat(fight).pressed, true, 'press to continue')
            expectEqual(getCombat(fight).acting.pressesGranted, 0, 'the press is used up')

            passUntil(fight, CombatStep.BeforeRange)
            const combat = getCombat(fight)
            expectEqual(combat.round, 2, 'round')
            expectEqual(combat.handStrikesOnly, false, 'the restriction ended with the round')
            passUntil(fight, CombatStep.BeforeStrikes)
            expectEqual(combat.round, 2, 'still round 2')
            expectEqual(combat.range, CombatRange.Close, 'close range')
            expectEqual(combat.closeNextRound, false, 'consumed')
        },
    },
    {
        name: 'Taste of Vitae gives back the blood the opponent lost to damage this round, at the end of the round',
        run() {
            const fight = createBrujahFight(TASTE_OF_VITAE_ID, null)
            getCombat(fight).acting.strength = 2
            passUntil(fight, CombatStep.Strike)
            expectEqual(
                countOptions(fight, 'combatGainBlood'),
                0,
                'not before the end of the round',
            )
            strikes(fight)
            passUntil(fight, CombatStep.EndOfRound)
            expectEqual(fight.defending.blood, 1, 'the defender mended 2')
            expectEqual(fight.acting.blood, 2, 'the acting minion mended 1')
            const options = optionsOfType(
                getCombatDecision(fight, fight.actingPlayer).options,
                'combatGainBlood',
            )
            expectEqual(options.length, 1, 'options')
            expectEqual(options[0].amount, 2, 'amount')
            decideCombat(fight, 'combatGainBlood')
            expectEqual(fight.acting.blood, 4, 'blood gained')
            expectEqual(countOptions(fight, 'combatGainBlood'), 0, 'once per round')
        },
    },
    {
        name: 'Taste of Vitae is not offered when the opponent lost no blood',
        run() {
            const fight = createBrujahFight(TASTE_OF_VITAE_ID, null)
            passUntil(fight, CombatStep.Strike)
            decideCombat(fight, 'combatStrike')
            must(
                gameMutations.COMBAT_chooseStrike.act(fight.defendingPlayer, {
                    minion: fight.defending,
                    strike: createDodgeStrike(),
                }),
                'the defender dodges',
            )
            passUntil(fight, CombatStep.EndOfRound)
            expectEqual(fight.defending.blood, 3, 'no damage dealt')
            expectEqual(countOptions(fight, 'combatGainBlood'), 0, 'options')
        },
    },
]

const LINE_BRAWL_ID = '102229'
const THEO_BELL_ID = '201613'

// The minion phase of a player holding Line Brawl, with an Anarch vampire that has the disciplines
// and a minion of the prey in play
function createLineBrawlTurn() {
    const turn = createMinionPhase(5, 0, BrujahDeck)
    const { gameState, player } = turn
    const victim = player.prey
    if (!victim) {
        throw new ScenarioFailure('No prey')
    }
    turn.ready.vampireAttrs.sect = 'Anarch'
    turn.ready.minionAttrs.disciplines = {} as Disciplines
    for (const discipline of [Discipline.Celerity, Discipline.Potence, Discipline.Presence]) {
        turn.ready.minionAttrs.disciplines[discipline] = DisciplineLevel.INFERIOR
    }
    emptyHand(gameState, player)
    const card = giveCard(gameState, player, LINE_BRAWL_ID)
    const target = readyVampire(gameState, victim, 4)
    return { ...turn, victim, card, target }
}

const lineBrawlOptions = (turn: ReturnType<typeof createLineBrawlTurn>) => {
    const { decision, options } = getActionOptions(turn, MinionActionType.ActionCardFromHand)
    return {
        decision,
        mine: options.flatMap(option =>
            (
                option.action.type == MinionActionType.ActionCardFromHand &&
                option.action.card == turn.card
            ) ?
                [{ option, usage: option.action.usage }]
            :   [],
        ),
    }
}

const BRUJAH_ACTION_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'Line Brawl: a bleed at +1, stealing pool and entering combat, each with its own discipline, needing an Anarch',
        run() {
            const turn = createLineBrawlTurn()
            const { mine } = lineBrawlOptions(turn)
            const kinds = (usage: LibraryCardUsage) =>
                usage.target instanceof Player ? 'player' : 'minion'
            const disciplines = mine.map(({ usage }) => usage.disciplines?.[0]?.discipline).sort()
            expectEqual(
                disciplines.filter(name => name == Discipline.Presence).length,
                1,
                'bleed options',
            )
            expectEqual(
                disciplines.filter(name => name == Discipline.Potence).length,
                1,
                'combat options (the only minion of the other Methuselah)',
            )
            expectEqual(
                mine.filter(({ usage }) => kinds(usage) == 'player').length >= 2,
                true,
                'bleed and steal pool aim at players',
            )

            turn.ready.vampireAttrs.sect = 'Camarilla'
            expectEqual(lineBrawlOptions(turn).mine.length, 0, 'a Camarilla vampire')
        },
    },
    {
        name: 'Line Brawl with Celerity steals 1 pool from another Methuselah',
        run() {
            const turn = createLineBrawlTurn()
            const { decision, mine } = lineBrawlOptions(turn)
            const steal = mine.find(
                ({ usage }) => usage.disciplines?.[0]?.discipline == Discipline.Celerity,
            )
            if (!steal) {
                throw new ScenarioFailure('The steal is not offered')
            }
            const victim = steal.usage.target
            if (!(victim instanceof Player)) {
                throw new ScenarioFailure('The steal does not aim at a Methuselah')
            }
            victim.pool = 5
            const own = turn.player.pool
            applyOption(decision, steal.option)
            resolveAction(turn)
            expectEqual(victim.pool, 4, 'pool of the victim')
            expectEqual(turn.player.pool, own + 1, 'pool of the thief')
        },
    },
    {
        name: 'Line Brawl with Potence enters combat with the minion: the combat starts, the card is paid',
        run() {
            const turn = createLineBrawlTurn()
            const { decision, mine } = lineBrawlOptions(turn)
            const brawl = mine.find(({ usage }) => usage.target == turn.target)
            if (!brawl) {
                throw new ScenarioFailure('The combat is not offered')
            }
            applyOption(decision, brawl.option)
            resolveAction(turn)
            const combat = turn.gameState.combat
            expectEqual(combat === null, false, 'combat in progress')
            expectEqual(combat?.acting.minion, turn.ready, 'acting minion')
            expectEqual(combat?.defending.minion, turn.target, 'defending minion')
        },
    },
    {
        name: 'Theo Bell can enter combat with a minion of another Methuselah as an action, others cannot',
        run() {
            const turn = createMinionPhase(5, 0, BrujahDeck)
            const victim = turn.player.prey
            if (!victim) {
                throw new ScenarioFailure('No prey')
            }
            const target = readyVampire(turn.gameState, victim, 4)
            // The ready vampire drawn at random may be Theo Bell himself
            const others = () =>
                getActionOptions(turn, MinionActionType.EnterCombat).options.filter(
                    option => option.action.actingMinion.krcgId != THEO_BELL_ID,
                )
            expectEqual(others().length, 0, 'an ordinary vampire')

            const theo =
                turn.ready.krcgId == THEO_BELL_ID ?
                    turn.ready
                :   readySpecific(turn.gameState, turn.player, THEO_BELL_ID, 5)
            expectEqual(theo.minionAttrs.strength, 2, 'strength')
            const { decision, options } = getActionOptions(turn, MinionActionType.EnterCombat)
            expectEqual(options.length, 1, 'options')
            expectEqual(options[0].action.actingMinion, theo, 'acting minion')
            expectEqual(options[0].action.target, target, 'target')

            applyOption(decision, options[0])
            resolveAction(turn)
            expectEqual(turn.gameState.combat?.defending.minion, target, 'combat started')
        },
    },
]

const ORGANIZED_RESISTANCE_ID = '102230'
const SHOW_OF_FORCE_ID = '101772'
const CARFAX_ID = '100297'
const ARIANE_ID = '200132'
const ELEN_ID = '201585'

// A bleed against a prey that holds Organized Resistance, a baron ( Atiena ) and a locked Anarch
function createResistance(baronLocked: boolean) {
    const game = createCatalogBleed({
        deck: BrujahDeck,
        discipline: Discipline.Presence,
        level: DisciplineLevel.SUPERIOR,
        cards: [],
        preyCards: [ORGANIZED_RESISTANCE_ID],
        preyVampireId: ATIENA_ID,
    })
    const anarch = readySpecific(game.gameState, game.bled, RAYNE_ID, 3)
    anarch.lock()
    if (baronLocked) {
        game.blocker.lock()
    }
    return { ...game, anarch }
}

const reactionsOf = (decision: DecisionPoint, type: string) =>
    optionsOfType(decision.options, 'playReaction').filter(option => option.effect.type == type)

const BRUJAH_REACTION_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'Organized Resistance unlocks a locked Anarch which attempts to block with +1 intercept',
        run() {
            const game = createResistance(false)
            const decision = passUntilDecides(game.gameState, game.bled)
            const unlocks = reactionsOf(decision, 'unlockBlock')
            expectEqual(unlocks.length, 1, 'unlock options')
            expectEqual(
                unlocks[0].effect.type == 'unlockBlock' && unlocks[0].effect.target == game.anarch,
                true,
                'target',
            )
            applyOption(decision, unlocks[0])
            expectEqual(game.anarch.isLocked, false, 'unlocked')
            expectEqual(game.gameState.action?.intercept, 1, 'intercept')
            const standing = getBlockingMinion(game.gameState)
            expectEqual(standing, game.anarch, 'the block attempt stands')
            expectEqual(game.blocker.isLocked, false, 'the baron is not locked by the card')
        },
    },
    {
        name: 'Organized Resistance is usable by a locked baron, and needs a baron',
        run() {
            const locked = createResistance(true)
            const decision = passUntilDecides(locked.gameState, locked.bled)
            // Rayne, and the baron herself: she is a locked Anarch too
            expectEqual(reactionsOf(decision, 'unlockBlock').length, 2, 'a locked baron')

            const plain = createCatalogBleed({
                deck: BrujahDeck,
                discipline: Discipline.Presence,
                level: DisciplineLevel.SUPERIOR,
                cards: [],
                preyCards: [ORGANIZED_RESISTANCE_ID],
                preyVampireId: RAYNE_ID,
            })
            readySpecific(plain.gameState, plain.bled, OCTANE_ID, 3).lock()
            const next = passUntilDecides(plain.gameState, plain.bled)
            expectEqual(optionsOfType(next.options, 'playReaction').length, 0, 'a plain Anarch')
        },
    },
    {
        name: 'Organized Resistance adds 1 intercept to the standing block of an Anarch, not once a block stands for the unlock',
        run() {
            const game = createResistance(false)
            const first = passUntilDecides(game.gameState, game.bled)
            expectEqual(reactionsOf(first, 'intercept').length, 0, 'before any block')
            applyOption(
                first,
                optionsOfType(first.options, 'block').find(
                    option => option.minion == game.blocker,
                ) ?? findOption(first.options, 'block'),
            )
            decideWith(game.gameState, game.bleeder, 'noModifier')
            const decision = getDecisionPoint(game.gameState, game.bled)
            if (!decision) {
                throw new ScenarioFailure('No decision after the block attempt')
            }
            expectEqual(
                reactionsOf(decision, 'unlockBlock').length,
                0,
                'no unlock while a block stands',
            )
            const intercepts = reactionsOf(decision, 'intercept')
            expectEqual(intercepts.length >= 1, true, 'intercept options')
            const before = game.gameState.action?.intercept ?? 0
            applyOption(decision, intercepts[0])
            expectEqual(game.gameState.action?.intercept, before + 1, 'intercept')
        },
    },
    {
        name: 'Show of Force: a bleed that gives its strength bonus to the first round of the combat if blocked',
        run() {
            const turn = createMinionPhase(5, 0, BrujahDeck)
            const { gameState, player } = turn
            const victim = player.prey
            if (!victim) {
                throw new ScenarioFailure('No prey')
            }
            turn.ready.vampireAttrs.sect = 'Anarch'
            turn.ready.minionAttrs.strength = 1
            turn.ready.minionAttrs.disciplines = {} as Disciplines
            turn.ready.minionAttrs.disciplines[Discipline.Potence] = DisciplineLevel.SUPERIOR
            turn.ready.minionAttrs.disciplines[Discipline.Presence] = DisciplineLevel.SUPERIOR
            emptyHand(gameState, player)
            const card = giveCard(gameState, player, SHOW_OF_FORCE_ID)
            const blocker = readyVampire(gameState, victim, 3)

            const { decision, options } = getActionOptions(
                turn,
                MinionActionType.ActionCardFromHand,
            )
            const mine = options.flatMap(option =>
                (
                    option.action.type == MinionActionType.ActionCardFromHand &&
                    option.action.card == card
                ) ?
                    [option]
                :   [],
            )
            expectEqual(mine.length, 2, 'both levels')
            const superior = mine.find(
                option =>
                    option.action.type == MinionActionType.ActionCardFromHand &&
                    option.action.usage.disciplines?.every(
                        use => use.level == DisciplineLevel.SUPERIOR,
                    ),
            )
            if (!superior) {
                throw new ScenarioFailure('The superior level is not offered')
            }
            applyOption(decision, superior)
            expectEqual(gameState.action?.bleed, 3, 'bleed: 1 + 2')

            const first = passUntilDecides(gameState, victim)
            applyOption(first, findOption(first.options, 'block'))
            // Everybody passes until the block is resolved
            for (let i = 0; i < 6 && !gameState.combat; i++) {
                const decider = getDecidingPlayer(gameState)
                const next = decider && getDecisionPoint(gameState, decider)
                const pass = next?.options.find(option =>
                    ['noModifier', 'noReaction'].includes(option.type),
                )
                if (!next || !pass) {
                    break
                }
                applyOption(next, pass)
            }
            const combat = gameState.combat
            if (!combat) {
                throw new ScenarioFailure('No combat after the block')
            }
            expectEqual(combat.acting.minion, turn.ready, 'acting minion')
            expectEqual(combat.defending.minion, blocker, 'blocked by')
            expectEqual(combat.acting.strengthBonus, 2, 'bonus')

            const combatDecision = getDecisionPoint(gameState, player)
            const bonus = combatDecision?.options.find(
                option => option.type == 'combatStrengthBonus',
            )
            if (!combatDecision || !bonus) {
                throw new ScenarioFailure('The bonus is not offered')
            }
            applyOption(combatDecision, bonus)
            expectEqual(combat.acting.strength, 3, 'strength')
            expectEqual(combat.acting.strengthBonus, 0, 'bonus used')
        },
    },
    {
        name: 'Carfax Abbey needs a ready Anarch and feeds an Anarch in the unlock phase, not another sect',
        run() {
            const turn = createWarzoneTurn(CARFAX_ID)
            const { gameState, player, warzone } = turn
            expectEqual(countMasterOptions(turn), 0, 'no ready vampire')
            const octane = readySpecific(gameState, player, OCTANE_ID, 2)
            expectEqual(countMasterOptions(turn), 1, 'a ready Anarch')
            octane.vampireAttrs.sect = 'Camarilla'
            expectEqual(countMasterOptions(turn), 0, 'a ready Camarilla vampire')
            octane.vampireAttrs.sect = 'Anarch'

            gameState.moveCardToRegion(warzone, player.ready)
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Unlock)
            const rayne = readySpecific(gameState, player, RAYNE_ID, 1)
            rayne.vampireAttrs.sect = 'Camarilla'
            expectEqual(countUnlockEffects(turn), 1, 'only the Anarch is a target')
            const decision = getMasterDecision(turn)
            applyOption(decision, findOption(decision.options, 'unlockEffect'))
            expectEqual(octane.blood, 3, 'blood gained')
            expectEqual(rayne.blood, 1, 'the other vampire gained nothing')
        },
    },
    {
        name: 'Ariane has 1 stealth less on undirected actions',
        run() {
            const turn = createMinionPhase(5, 0, BrujahDeck)
            const ariane = readySpecific(turn.gameState, turn.player, ARIANE_ID, 4)
            const { decision, options } = getActionOptions(turn, MinionActionType.Hunt)
            const hunt = options.find(option => option.action.actingMinion == ariane)
            if (!hunt) {
                throw new ScenarioFailure('Ariane cannot hunt')
            }
            applyOption(decision, hunt)
            expectEqual(turn.gameState.action?.stealth, 0, 'stealth of the hunt')
        },
    },
    {
        name: 'Elen Kamjian must bleed while her Methuselah controls a locked minion: nothing else, no end of phase',
        run() {
            const turn = createMinionPhase(5, 0, BrujahDeck)
            const elen = readySpecific(turn.gameState, turn.player, ELEN_ID, 4)
            const elenOptions = () => {
                const decision = getDecisionPoint(turn.gameState, turn.player)
                if (!decision) {
                    throw new ScenarioFailure('No decision point')
                }
                return {
                    decision,
                    actions: optionsOfType(decision.options, 'declareAction').filter(
                        option => option.action.actingMinion == elen,
                    ),
                }
            }
            const free = elenOptions()
            expectEqual(
                free.actions.some(option => option.action.type == MinionActionType.Hunt),
                true,
                'free to hunt',
            )
            expectEqual(
                free.decision.options.some(option => option.type == 'endPhase'),
                true,
                'free to end the phase',
            )

            // Another vampire is locked ( Elen herself may be the one drawn as ready )
            readyVampire(turn.gameState, turn.player, 3).lock()
            const forced = elenOptions()
            expectEqual(
                forced.actions.every(option => option.action.type == MinionActionType.Bleed),
                true,
                'bleed only',
            )
            expectEqual(forced.actions.length > 0, true, 'a bleed is offered')
            expectEqual(
                forced.decision.options.some(option => option.type == 'endPhase'),
                false,
                'no end of phase',
            )
        },
    },
]

// The names of the events announced from now on, until stop() is called
function watchEvents(): { names: string[]; stop: () => void } {
    const names: string[] = []
    const stop = addEventObserver((_gameState, event) => {
        names.push(event.type)
    })
    return { names, stop }
}

// Everybody passes ( a standing block is kept ) until the action is over
function passUntilActionOver(gameState: GameState): void {
    for (let i = 0; i < 12 && gameState.action; i++) {
        const decider = getDecidingPlayer(gameState)
        const next = decider && getDecisionPoint(gameState, decider)
        const pass = ['noModifier', 'noReaction', 'noBlock']
            .map(type => next?.options.find(option => option.type == type))
            .find(Boolean)
        if (!next || !pass) {
            throw new ScenarioFailure('Nobody can pass')
        }
        applyOption(next, pass)
    }
    expectEqual(gameState.action, null, 'the action is over')
}

function createEventBleed(blockerIntercept: number) {
    const game = createCatalogBleed({
        discipline: Discipline.Obfuscate,
        level: DisciplineLevel.INFERIOR,
        cards: [],
    })
    if (!game.gameState.action) {
        throw new ScenarioFailure('The bleed is not declared')
    }
    game.gameState.action.stealth = 1
    game.blocker.minionAttrs.intercept = blockerIntercept
    return game
}

function blockWithBlocker(game: ReturnType<typeof createEventBleed>): void {
    const first = passUntilDecides(game.gameState, game.bled)
    applyOption(
        first,
        optionsOfType(first.options, 'block').find(option => option.minion == game.blocker) ??
            findOption(first.options, 'block'),
    )
}

const EVENT_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'Events: an unblocked bleed announces actionResolving then actionResolved',
        run() {
            const game = createEventBleed(0)
            const watch = watchEvents()
            try {
                passUntilActionOver(game.gameState)
            } finally {
                watch.stop()
            }
            expectEqual(watch.names.join(','), 'actionResolving,actionResolved', 'events')
        },
    },
    {
        name: 'Events: a failed block announces blockFailed, then the action resolves',
        run() {
            const game = createEventBleed(0)
            const watch = watchEvents()
            try {
                blockWithBlocker(game)
                passUntilActionOver(game.gameState)
            } finally {
                watch.stop()
            }
            expectEqual(
                watch.names.join(','),
                'blockFailed,actionResolving,actionResolved',
                'events',
            )
        },
    },
    {
        name: 'Events: a block that succeeds starts a combat and announces nothing',
        run() {
            const game = createEventBleed(5)
            const watch = watchEvents()
            try {
                blockWithBlocker(game)
                passUntilActionOver(game.gameState)
            } finally {
                watch.stop()
            }
            expectEqual(watch.names.length, 0, 'events')
            expectEqual(game.gameState.combat != null, true, 'combat')
        },
    },
    {
        name: 'Faceless Night: a block that failed before the card was played is not locked, the armed trigger leaves with the action',
        run() {
            const game = createCatalogBleed({
                discipline: Discipline.Obfuscate,
                level: DisciplineLevel.SUPERIOR,
                cards: [FACELESS_NIGHT_ID],
            })
            const { gameState, bleeder, blocker } = game
            if (!gameState.action) {
                throw new ScenarioFailure('The bleed is not declared')
            }
            gameState.action.stealth = 1
            blocker.minionAttrs.intercept = 0
            blockWithBlocker({ ...game, blocker })
            // Both pass: the block is resolved, and fails
            for (let i = 0; i < 4 && getBlockingMinion(gameState); i++) {
                const decider = getDecidingPlayer(gameState)
                const next = decider && getDecisionPoint(gameState, decider)
                const pass = ['noModifier', 'noReaction']
                    .map(type => next?.options.find(option => option.type == type))
                    .find(Boolean)
                if (!next || !pass) {
                    throw new ScenarioFailure('Nobody can pass')
                }
                applyOption(next, pass)
            }
            expectEqual(getBlockingMinion(gameState), null, 'the failed block is resolved')
            const decision = getDecisionPoint(gameState, bleeder)
            const played =
                decision &&
                modifierOptionsOf(decision, FACELESS_NIGHT_ID).find(
                    option => modifierLevel(option) == DisciplineLevel.SUPERIOR,
                )
            if (!decision || !played) {
                throw new ScenarioFailure('Faceless Night is not offered after the failed block')
            }
            applyOption(decision, played)
            expectEqual(gameState.action?.armedTriggers.length, 1, 'armed trigger')
            passUntilActionOver(gameState)
            expectEqual(blocker.isLocked, false, 'the earlier block does not count')
            expectEqual(gameState.action, null, 'the action is over')
        },
    },
    {
        name: 'Events: an action ended by hand announces actionResolved only',
        run() {
            const game = createEventBleed(0)
            const watch = watchEvents()
            try {
                must(gameMutations.ACTION_endAction.act(game.bleeder, {}), 'end the action')
            } finally {
                watch.stop()
            }
            expectEqual(watch.names.join(','), 'actionResolved', 'events')
        },
    },
]

const ALINE_ID = '201576'

type AlineGame = ReturnType<typeof createEventBleed> & { aline: Vampire }

// The first player bleeds with Atiena ( an Anarch, by default ) while Aline, locked, sits in the
// ready region of the same player. The prey does not block unless the scenario says so.
function createAlineGame(
    setup: { actorSect?: Sect; alineBlood?: number; inTorpor?: boolean } = {},
): AlineGame {
    const game = createCatalogBleed({
        discipline: Discipline.Obfuscate,
        level: DisciplineLevel.INFERIOR,
        cards: [],
        deck: BrujahDeck,
        bleederId: ATIENA_ID,
    })
    game.bleeding.vampireAttrs.sect = setup.actorSect ?? Sect.Anarch
    const aline = readySpecific(game.gameState, game.bleeder, ALINE_ID, setup.alineBlood ?? 3)
    aline.vampireAttrs.sect = Sect.Anarch
    aline.lock()
    if (setup.inTorpor) {
        game.gameState.moveCardToRegion(aline, game.bleeder.torpor)
    }
    return { ...game, aline }
}

function getTriggerDecision(game: AlineGame): DecisionPoint {
    const decider = getDecidingPlayer(game.gameState)
    const decision = decider && getDecisionPoint(game.gameState, decider)
    if (!decision || decision.kind != DecisionKind.Trigger) {
        throw new ScenarioFailure('No trigger decision')
    }
    return decision
}

function expectNoTrigger(gameState: GameState, what: string): void {
    expectEqual(gameState.pendingTriggers.length, 0, what)
}

const ALINE_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'Aline Gadeke: after another Anarch of hers acts unblocked, she may unlock for 1 blood',
        run() {
            const game = createAlineGame()
            passUntilActionOver(game.gameState)
            const decision = getTriggerDecision(game)
            expectEqual(decision.player, game.bleeder, 'the controller decides')
            expectEqual(
                decision.options.map(option => option.type).join(','),
                'useTrigger,skipTrigger',
                'options',
            )
            applyOption(decision, findOption(decision.options, 'useTrigger'))
            expectEqual(game.aline.isLocked, false, 'unlocked')
            expectEqual(game.aline.blood, 2, 'blood burned')
            expectNoTrigger(game.gameState, 'pending')
            expectEqual(
                game.gameState.turnResources.usedTriggers.includes(getTriggerKey(game.aline, 0)),
                true,
                'used this turn',
            )
        },
    },
    {
        name: 'Aline Gadeke: the controller may opt out, nothing changes',
        run() {
            const game = createAlineGame()
            passUntilActionOver(game.gameState)
            const decision = getTriggerDecision(game)
            applyOption(decision, findOption(decision.options, 'skipTrigger'))
            expectEqual(game.aline.isLocked, true, 'still locked')
            expectEqual(game.aline.blood, 3, 'blood')
            expectNoTrigger(game.gameState, 'pending')
            expectEqual(game.gameState.turnResources.usedTriggers.length, 0, 'not used')
        },
    },
    {
        name: 'Aline Gadeke: a failed block still lets the action resolve, so it counts',
        run() {
            const game = createAlineGame()
            if (!game.gameState.action) {
                throw new ScenarioFailure('The bleed is not declared')
            }
            game.gameState.action.stealth = 1
            game.blocker.minionAttrs.intercept = 0
            blockWithBlocker(game)
            passUntilActionOver(game.gameState)
            getTriggerDecision(game)
        },
    },
    {
        name: 'Aline Gadeke: a block that succeeds starts a combat, nothing is pending',
        run() {
            const game = createAlineGame()
            if (!game.gameState.action) {
                throw new ScenarioFailure('The bleed is not declared')
            }
            game.gameState.action.stealth = 1
            game.blocker.minionAttrs.intercept = 5
            blockWithBlocker(game)
            passUntilActionOver(game.gameState)
            expectEqual(game.gameState.combat != null, true, 'combat')
            expectNoTrigger(game.gameState, 'pending')
        },
    },
    {
        name: 'Aline Gadeke: does not trigger on her own action, nor on a minion that is not an Anarch',
        run() {
            const own = createCatalogBleed({
                discipline: Discipline.Obfuscate,
                level: DisciplineLevel.INFERIOR,
                cards: [],
                deck: BrujahDeck,
                bleederId: ALINE_ID,
            })
            own.bleeding.lock()
            passUntilActionOver(own.gameState)
            expectNoTrigger(own.gameState, 'her own action')

            const camarilla = createAlineGame({ actorSect: Sect.Camarilla })
            passUntilActionOver(camarilla.gameState)
            expectNoTrigger(camarilla.gameState, 'a Camarilla vampire')

            // "Another Anarch YOU control": Aline of the prey does not react to the bleeder
            const others = createAlineGame()
            others.gameState.moveCardToRegion(others.aline, others.bled.ready)
            passUntilActionOver(others.gameState)
            expectNoTrigger(others.gameState, 'an Anarch of another Methuselah')
        },
    },
    {
        name: 'Aline Gadeke: not queued without a blood to burn, and only once per turn',
        run() {
            const empty = createAlineGame({ alineBlood: 0 })
            passUntilActionOver(empty.gameState)
            expectNoTrigger(empty.gameState, 'no blood')

            const game = createAlineGame()
            passUntilActionOver(game.gameState)
            const decision = getTriggerDecision(game)
            applyOption(decision, findOption(decision.options, 'useTrigger'))
            // Another action resolves the same turn
            game.aline.lock()
            emitEvent(game.gameState, {
                type: 'actionResolved',
                action: createBleedAction(game.bleeding, game.bled),
            })
            expectNoTrigger(game.gameState, 'once per turn')
        },
    },
    {
        name: 'Aline Gadeke: works from torpor too, the unlock leaves her in torpor',
        run() {
            const game = createAlineGame({ inTorpor: true })
            expectEqual(game.aline.isIn.torpor, true, 'in torpor')
            passUntilActionOver(game.gameState)
            const decision = getTriggerDecision(game)
            applyOption(decision, findOption(decision.options, 'useTrigger'))
            expectEqual(game.aline.isLocked, false, 'unlocked')
            expectEqual(game.aline.isIn.torpor, true, 'still in torpor')
        },
    },
    {
        name: 'Aline Gadeke: two copies ask one after the other, and the decision goes through the player view',
        run() {
            const game = createAlineGame()
            const second = [...game.bleeder.crypt.cards, ...game.bleeder.uncontrolled.cards].find(
                card => card.krcgId == ALINE_ID && card != game.aline,
            )
            if (!second?.isVampire()) {
                throw new ScenarioFailure('No second Aline')
            }
            game.gameState.moveCardToRegion(second, game.bleeder.ready)
            second.blood = 2
            second.lock()
            passUntilActionOver(game.gameState)
            expectEqual(game.gameState.pendingTriggers.length, 2, 'both pending')

            const first = getTriggerDecision(game)
            const viaView = chooseThroughView(first, {
                choose: decision => findOption(decision.options, 'useTrigger'),
            })
            expectEqual(viaView.type, 'useTrigger', 'chosen through the view')
            applyOption(first, viaView)
            expectEqual(game.gameState.pendingTriggers.length, 1, 'one left')
            const next = getTriggerDecision(game)
            applyOption(next, findOption(next.options, 'skipTrigger'))
            expectNoTrigger(game.gameState, 'all decided')
        },
    },
]

/**
 * A human acts, the bots block (Phase 2.5)
 */

type HumanTable = {
    gameState: GameState
    human: Player
    // The Methuselahs after the human, in turn order: [prey, predator] (just the prey at 2 players)
    others: Player[]
    acting: Vampire
    // The ready vampire of each other player, same order as `others`
    blockers: Vampire[]
    // The card given to the human, when asked
    card: LibraryCard | null
}

function createHumanTable(
    nbPlayers: number,
    humanCard?: string,
    deck: DeckList = GovernDeck,
): HumanTable {
    const { gameState, players } = createHeadlessGame(Array.from({ length: nbPlayers }, () => deck))
    createdGames.push(gameState)
    const human = gameState.activePlayer
    const prey = human?.prey
    if (!human || !prey || !players.includes(human)) {
        throw new ScenarioFailure('No active player or no prey')
    }
    human.permId = 'human'
    const others = nbPlayers >= 3 && prey.prey ? [prey, prey.prey] : [prey]
    for (const player of players) {
        emptyHand(gameState, player)
    }
    const card = humanCard ? giveCard(gameState, human, humanCard) : null
    for (const player of players) {
        sealLibrary(gameState, player)
    }
    gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Minion)
    gameState.turnResources.unlocked = true

    const acting = readyVampire(gameState, human, 3)
    const blockers = others.map(other => {
        const blocker = readyVampire(gameState, other, 3)
        blocker.minionAttrs.intercept = 1
        return blocker
    })
    return { gameState, human, others, acting, blockers, card }
}

function humanDeclares(table: HumanTable, minionAction: MinionAction): void {
    must(
        gameMutations.ACTION_declareAction.act(table.human, { minionAction }),
        `human ${minionAction.type}`,
    )
}

function inTorpor(gameState: GameState, vampire: Vampire, blood: number): void {
    gameState.moveCardToRegion(vampire, vampire.controller.torpor)
    vampire.blood = blood
}

const HUMAN_ACTION_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'a human bleed hands the impulse to the bot prey as soon as it is declared',
        run() {
            const table = createHumanTable(3)
            humanDeclares(table, createBleedAction(table.acting, table.others[0]))
            expectEqual(getDecidingPlayer(table.gameState), table.others[0], 'the prey decides')
        },
    },
    {
        name: 'a human hunt hands the impulse to the bot prey, then the predator once the prey has passed',
        run() {
            const table = createHumanTable(3)
            const [prey, predator] = table.others
            humanDeclares(table, createHuntAction(table.acting))
            expectEqual(getDecidingPlayer(table.gameState), prey, 'the prey decides first')
            // Its vampire does not intercept enough: the prey passes without a block
            table.blockers[0].minionAttrs.intercept = 0
            expectEqual(stepBot(prey, new GovernAgent())?.option.type, 'noReaction', 'prey passes')
            expectEqual(getDecidingPlayer(table.gameState), predator, 'the predator decides')
        },
    },
    {
        name: 'a human leaving torpor hands the impulse to the bot prey',
        run() {
            const table = createHumanTable(2)
            inTorpor(table.gameState, table.acting, LEAVE_TORPOR_COST)
            humanDeclares(table, createLeaveTorporAction(table.acting))
            expectEqual(getDecidingPlayer(table.gameState), table.others[0], 'the prey decides')
        },
    },
    {
        name: 'a human rescuing a bot vampire hands the impulse to that bot, not to the prey',
        run() {
            const table = createHumanTable(3)
            const [prey, predator] = table.others
            const rescued = readyVampire(table.gameState, predator, 4)
            inTorpor(table.gameState, rescued, 4)
            humanDeclares(table, createRescueFromTorporAction(table.acting, rescued, 1, 1))
            expectEqual(getDecidingPlayer(table.gameState), predator, 'the owner decides')
            expectEqual(prey == predator, false, 'a prey that differs from the owner')
        },
    },
    {
        name: 'a human diablerizing a bot vampire hands the impulse to that bot',
        run() {
            const table = createHumanTable(2)
            const [prey] = table.others
            const victim = readyVampire(table.gameState, prey, 4)
            inTorpor(table.gameState, victim, 4)
            humanDeclares(table, {
                type: MinionActionType.Diablerize,
                actingMinion: table.acting,
                target: victim,
            })
            expectEqual(getDecidingPlayer(table.gameState), prey, 'the owner decides')
        },
    },
    {
        name: 'a human action card waits for the human: the bot is not given the impulse',
        run() {
            const table = createHumanTable(2, GOVERN_ID)
            if (!table.card) {
                throw new ScenarioFailure('No card given')
            }
            humanDeclares(table, createActionCardAction(table.acting, table.card, {}))
            expectEqual(getDecidingPlayer(table.gameState), table.human, 'the human decides')
            expectEqual(table.gameState.action?.declared, false, 'not declared yet')
        },
    },
    {
        name: 'the Declare button of a human action card hands the impulse to the bot, which then blocks',
        run() {
            const table = createHumanTable(2, GOVERN_ID)
            const [prey] = table.others
            if (!table.card) {
                throw new ScenarioFailure('No card given')
            }
            humanDeclares(table, createActionCardAction(table.acting, table.card, {}))
            must(gameMutations.ACTION_completeDeclaration.act(table.human, {}), 'declare')
            expectEqual(table.gameState.action?.declared, true, 'declared')
            expectEqual(getDecidingPlayer(table.gameState), prey, 'the bot decides')
            expectEqual(stepBot(prey, new GovernAgent())?.option.type, 'block', 'the bot blocks')
            mustRefuse(
                gameMutations.ACTION_completeDeclaration.act(table.human, {}),
                'declared twice',
            )
        },
    },
    {
        name: 'a usage change after the bots passed gives them a new reason to react',
        run() {
            const table = createHumanTable(2, GOVERN_ID)
            const [prey] = table.others
            if (!table.card) {
                throw new ScenarioFailure('No card given')
            }
            table.acting.minionAttrs.strength = table.blockers[0].minionAttrs.strength + 1
            humanDeclares(table, createActionCardAction(table.acting, table.card, {}))
            must(gameMutations.ACTION_completeDeclaration.act(table.human, {}), 'declare')
            stepBot(prey, new GovernAgent())
            expectEqual(table.gameState.action?.reactionsPassed, true, 'all passed')
            must(gameMutations.ACTION_updateUsage.act(table.human, { usage: { x: 1 } }), 'usage')
            expectEqual(table.gameState.action?.reactionsPassed, false, 'new reason to react')
        },
    },
    {
        name: 'a bot action does not pass the impulse by itself, only the human action does',
        run() {
            const table = createHumanTable(2)
            table.human.permId = 'Bot1'
            humanDeclares(table, createBleedAction(table.acting, table.others[0]))
            expectEqual(getDecidingPlayer(table.gameState), table.human, 'the bleeder decides')
        },
    },
    {
        name: 'the Govern agent blocks the bleed of a human, and the successful block starts a combat',
        run() {
            const table = createHumanTable(2)
            const [prey] = table.others
            const agent = new GovernAgent()
            humanDeclares(table, createBleedAction(table.acting, prey))
            expectEqual(stepBot(prey, agent)?.option.type, 'block', 'the bot blocks')
            expectEqual(getDecidingPlayer(table.gameState), table.human, 'back to the human')

            decideWith(table.gameState, table.human, 'noModifier')
            expectEqual(stepBot(prey, agent)?.option.type, 'noReaction', 'the bot passes')
            expectEqual(table.gameState.action, null, 'the action is over')
            const combat = table.gameState.combat
            expectEqual(combat?.acting.minion, table.acting, 'the human minion is the one blocked')
            expectEqual(combat?.defending.minion, table.blockers[0], 'the bot minion blocked')
            expectEqual(table.blockers[0].isLocked, true, 'the blocker is locked')
        },
    },
    {
        name: 'the Govern agent blocks a human hunt with the prey, which intercepts as much as the stealth',
        run() {
            const table = createHumanTable(3)
            const [prey] = table.others
            humanDeclares(table, createHuntAction(table.acting))
            expectEqual(table.gameState.action?.stealth, 1, 'the stealth of an undirected action')
            expectEqual(stepBot(prey, new GovernAgent())?.option.type, 'block', 'the prey blocks')
        },
    },
    {
        name: 'the Govern agent does not block when the stealth is above the intercept',
        run() {
            const table = createHumanTable(2)
            const [prey] = table.others
            humanDeclares(table, createBleedAction(table.acting, prey))
            if (!table.gameState.action) {
                throw new ScenarioFailure('No action')
            }
            table.gameState.action.stealth = 2
            expectEqual(stepBot(prey, new GovernAgent())?.option.type, 'noReaction', 'no block')
        },
    },
    {
        name: 'the Govern agent does not block a stronger minion',
        run() {
            const table = createHumanTable(2)
            const [prey] = table.others
            table.acting.minionAttrs.strength = table.blockers[0].minionAttrs.strength + 1
            humanDeclares(table, createBleedAction(table.acting, prey))
            expectEqual(stepBot(prey, new GovernAgent())?.option.type, 'noReaction', 'no block')
        },
    },
    {
        name: 'the Govern agent blocks with the strongest of its minions',
        run() {
            const table = createHumanTable(2)
            const [prey] = table.others
            const strong = readyVampire(table.gameState, prey, 3)
            strong.minionAttrs.intercept = 1
            strong.minionAttrs.strength = 2
            humanDeclares(table, createBleedAction(table.acting, prey))
            const step = stepBot(prey, new GovernAgent())
            expectEqual(step?.option.type, 'block', 'the bot blocks')
            expectEqual(
                step?.option.type == 'block' ? step.option.minion : null,
                strong,
                'the strongest blocks',
            )
        },
    },
    {
        name: 'a block that fails against a raised stealth gives the impulse back and the action goes on',
        run() {
            const table = createHumanTable(2)
            const [prey] = table.others
            const agent = new GovernAgent()
            humanDeclares(table, createBleedAction(table.acting, prey))
            expectEqual(stepBot(prey, agent)?.option.type, 'block', 'the bot blocks')
            // The human plays a stealth modifier by hand, then passes
            if (!table.gameState.action) {
                throw new ScenarioFailure('No action')
            }
            table.gameState.action.stealth = 2
            decideWith(table.gameState, table.human, 'noModifier')
            stepBot(prey, agent)
            expectEqual(table.gameState.combat, null, 'no combat')
            expectEqual(table.gameState.action !== null, true, 'the human ends the action')
            expectEqual(getDecidingPlayer(table.gameState), table.human, 'the human decides')
            expectEqual(table.blockers[0].isLocked, false, 'the failed blocker stays unlocked')
        },
    },
    {
        name: 'a human resolves a bleed with the Resolve action button: the bled bot loses the bleed amount',
        run() {
            const table = createHumanTable(2)
            const [prey] = table.others
            table.acting.minionAttrs.strength = table.blockers[0].minionAttrs.strength + 1
            humanDeclares(table, createBleedAction(table.acting, prey))
            stepBot(prey, new GovernAgent())
            const pool = prey.pool
            must(gameMutations.ACTION_resolveAction.act(table.human, {}), 'resolve')
            expectEqual(table.gameState.action, null, 'the action is over')
            expectEqual(prey.pool, pool - table.acting.minionAttrs.bleed, 'the bleed went through')
        },
    },
    {
        name: 'a human cannot resolve an action the engine does not know, nor over a standing block, nor outside bot games',
        run() {
            const table = createHumanTable(2)
            const [prey] = table.others
            humanDeclares(table, createBleedAction(table.acting, prey))
            stepBot(prey, new GovernAgent())
            mustRefuse(gameMutations.ACTION_resolveAction.act(table.human, {}), 'a standing block')

            table.gameState.action = null
            table.gameState.gameType = GameType.Unset
            humanDeclares(table, createBleedAction(table.acting, prey))
            mustRefuse(gameMutations.ACTION_resolveAction.act(table.human, {}), 'outside bot games')

            table.gameState.action = null
            table.gameState.gameType = GameType.TrainBot
            humanDeclares(table, {
                type: MinionActionType.Diablerize,
                actingMinion: table.acting,
                target: table.blockers[0],
            })
            mustRefuse(gameMutations.ACTION_resolveAction.act(table.human, {}), 'a diablerie')
        },
    },
    {
        name: 'once the bots have passed, nothing is left to pass until the human changes the action',
        run() {
            const table = createHumanTable(2)
            const [prey] = table.others
            table.acting.minionAttrs.strength = table.blockers[0].minionAttrs.strength + 1
            humanDeclares(table, createBleedAction(table.acting, prey))
            expectEqual(table.gameState.action?.reactionsPassed, false, 'passed at declaration')
            stepBot(prey, new GovernAgent())
            expectEqual(getDecidingPlayer(table.gameState), table.human, 'back to the human')
            expectEqual(table.gameState.action?.reactionsPassed, true, 'all passed')

            must(
                gameMutations.ACTION_changeProperty.act(table.human, {
                    propertyName: ActionProperty.Bleed,
                    amount: 1,
                }),
                'raise the bleed',
            )
            expectEqual(table.gameState.action?.reactionsPassed, false, 'new reason to react')
        },
    },
]

/**
 * Attachment: an equipment or a retainer a bot plays stays in play attached to the minion that
 * took the action, once the action succeeded. What it does once attached: a weapon gives its
 * bearer a strike ( .44 Magnum ), a retainer gives life counters and intercept ( Raven Spy ).
 */

const MAGNUM_ID = '100001'
const RAVEN_SPY_ID = '101550'
// A unique equipment, which the catalog does not describe
const IVORY_BOW_ID = '101014'

const SPY_INFERIOR: DisciplineUse[] = [
    { discipline: Discipline.Animalism, level: DisciplineLevel.INFERIOR },
]

// The minion phase of a player holding only the card, with its ready vampire at a known place.
// The Animalism of the vampire is set when given ( null: it has none ).
function createEquipTurn(
    cardId: string,
    deck: DeckList = AttachDeck,
    animalism?: DisciplineLevel | null,
) {
    const turn = createMinionPhase(5, 0, deck)
    const { gameState, player } = turn
    emptyHand(gameState, player)
    const card = giveCard(gameState, player, cardId)
    turn.ready.x = 100
    turn.ready.y = 100
    if (animalism) {
        turn.ready.minionAttrs.disciplines[Discipline.Animalism] = animalism
    } else if (animalism === null) {
        turn.ready.minionAttrs.disciplines = Object.fromEntries(
            Object.entries(turn.ready.minionAttrs.disciplines).filter(
                ([name]) => name != Discipline.Animalism,
            ),
        ) as Disciplines
    }
    return { ...turn, card }
}

const equipOptions = (turn: ReturnType<typeof createEquipTurn>) => {
    const { decision, options } = getActionOptions(turn, MinionActionType.ActionCardFromHand)
    return {
        decision,
        mine: options.filter(
            option =>
                option.action.type == MinionActionType.ActionCardFromHand &&
                option.action.card == turn.card,
        ),
    }
}

const levelOf = (option: BotOptionOf<'declareAction'>) =>
    option.action.type == MinionActionType.ActionCardFromHand ?
        option.action.usage.disciplines?.[0]?.level
    :   undefined

// Puts the card in play attached to the minion, as an equip action would have
function attachInPlay(
    card: LibraryCard,
    minion: Minion,
    options: { life?: number; disciplines?: DisciplineUse[] } = {},
): void {
    const player = minion.controller
    player.gameState.moveCardToRegion(card, player.ready)
    must(
        gameMutations.attachCard.act(player, { card, minion, disciplines: options.disciplines }),
        'attach',
    )
    if (options.life) {
        card.blood = options.life
    }
}

// The cards of the other players are sealed away in the scenarios with a human table
function findAnyCard(player: Player, krcgId: string): LibraryCard {
    const card = [...player.library.cards, ...player.hand.cards, ...player.removed.cards].find(
        candidate => candidate.krcgId == krcgId,
    )
    if (!(card instanceof LibraryCard)) {
        throw new ScenarioFailure(`Card ${krcgId} not found`)
    }
    return card
}

const weaponManeuvers = (decision: DecisionPoint) =>
    optionsOfType(decision.options, 'combatManeuver').filter(option => option.weapon)

const ATTACHMENT_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'an equipment is offered as an undirected action of each ready minion, with no target',
        run() {
            const turn = createEquipTurn(MAGNUM_ID)
            const { mine } = equipOptions(turn)
            expectEqual(mine.length, 1, 'options')
            expectEqual(mine[0].action.actingMinion, turn.ready, 'acting minion')
            expectEqual(mine[0].action.target, undefined, 'target')
        },
    },
    {
        name: 'a resolved equip action attaches the card under its minion, shifted to the top-right, and pays the pool',
        run() {
            const turn = createEquipTurn(MAGNUM_ID)
            const { decision, mine } = equipOptions(turn)
            const pool = turn.player.pool
            applyOption(decision, mine[0])
            expectEqual(isAttached(turn.card), false, 'attached before the action succeeds')
            resolveAction(turn)

            expectEqual(getHost(turn.card), turn.ready, 'host')
            expectEqual(getAttachedCards(turn.ready).length, 1, 'attached cards')
            expectEqual(turn.card.region, turn.player.ready, 'region')
            expectEqual(turn.card.position < turn.ready.position, true, 'drawn under the minion')
            expectEqual(turn.card.x > turn.ready.x, true, 'shifted to the right')
            expectEqual(turn.card.y < turn.ready.y, true, 'shifted to the top')
            expectEqual(turn.player.pool, pool - 2, 'pool')

            // The card is kept: nothing to clean up
            const next = getDecisionPoint(turn.gameState, turn.player)
            expectEqual(next?.kind == DecisionKind.Cleanup, false, 'cleanup')
            expectEqual(turn.card.isIn.ready, true, 'still in play')
        },
    },
    {
        name: 'two cards on the same minion stick out one after the other, both under it',
        run() {
            const turn = createEquipTurn(MAGNUM_ID)
            const second = giveCard(turn.gameState, turn.player, RAVEN_SPY_ID)
            for (const card of [turn.card, second]) {
                turn.gameState.moveCardToRegion(card, turn.player.ready)
                must(
                    gameMutations.attachCard.act(turn.player, { card, minion: turn.ready }),
                    'attach',
                )
            }
            expectEqual(getAttachedCards(turn.ready).length, 2, 'attached cards')
            expectEqual(second.x > turn.card.x, true, 'the second sticks out further')
            expectEqual(second.y < turn.card.y, true, 'the second is higher')
            expectEqual(
                Math.max(turn.card.position, second.position) < turn.ready.position,
                true,
                'both under the minion',
            )
        },
    },
    {
        name: 'a retainer needs the discipline: no Animalism, no Raven Spy',
        run() {
            const turn = createEquipTurn(RAVEN_SPY_ID, AttachDeck, null)
            expectEqual(equipOptions(turn).mine.length, 0, 'options')
        },
    },
    {
        name: 'an inferior Raven Spy is paid with blood and comes in play with 1 life',
        run() {
            const turn = createEquipTurn(RAVEN_SPY_ID, AttachDeck, DisciplineLevel.INFERIOR)
            const { decision, mine } = equipOptions(turn)
            expectEqual(mine.length, 1, 'options')
            expectEqual(levelOf(mine[0]), DisciplineLevel.INFERIOR, 'level')
            applyOption(decision, mine[0])
            resolveAction(turn)
            expectEqual(getHost(turn.card), turn.ready, 'host')
            expectEqual(turn.ready.blood, 4, 'blood after the 1 blood cost')
            expectEqual(turn.card.blood, 1, 'life of the retainer')
            expectEqual(
                turn.gameState.attachmentUsages[turn.card.oid]?.[0]?.level,
                DisciplineLevel.INFERIOR,
                'the version is remembered',
            )
        },
    },
    {
        name: 'a superior minion can play Raven Spy at both levels, the superior one has 2 life',
        run() {
            const turn = createEquipTurn(RAVEN_SPY_ID, AttachDeck, DisciplineLevel.SUPERIOR)
            const { decision, mine } = equipOptions(turn)
            expectEqual(mine.length, 2, 'options')
            const superior = mine.find(option => levelOf(option) == DisciplineLevel.SUPERIOR)
            if (!superior) {
                throw new ScenarioFailure('No superior option')
            }
            applyOption(decision, superior)
            resolveAction(turn)
            expectEqual(turn.card.blood, 2, 'life of the retainer')
            expectEqual(
                turn.gameState.attachmentUsages[turn.card.oid]?.[0]?.level,
                DisciplineLevel.SUPERIOR,
                'the version is remembered',
            )
        },
    },
    {
        name: 'an equip action that fails leaves nothing paid and the card goes to the ash heap',
        run() {
            const turn = createEquipTurn(MAGNUM_ID)
            const { decision, mine } = equipOptions(turn)
            const pool = turn.player.pool
            applyOption(decision, mine[0])
            must(gameMutations.ACTION_endAction.act(turn.player, {}), 'end the action')

            const cleanup = getDecisionPoint(turn.gameState, turn.player)
            if (cleanup?.kind != DecisionKind.Cleanup) {
                throw new ScenarioFailure(`Expected a cleanup, got ${cleanup?.kind}`)
            }
            applyOption(cleanup, cleanup.options[0])
            expectEqual(turn.card.isIn.ashHeap, true, 'the card is discarded')
            expectEqual(isAttached(turn.card), false, 'attached')
            expectEqual(turn.player.pool, pool, 'pool')
        },
    },
    {
        name: 'a unique equipment is seen as in play while another copy is, whoever has it',
        run() {
            const deck = { ...AttachDeck, [IVORY_BOW_ID]: 2 }
            const turn = createEquipTurn(IVORY_BOW_ID, deck)
            expectEqual(hasUniqueCopyInPlay(turn.player, turn.card), false, 'no copy in play')

            const other = turn.gameState.competingPlayers.find(player => player != turn.player)
            if (!other) {
                throw new ScenarioFailure('No other player')
            }
            const copy = findCard(other, IVORY_BOW_ID)
            attachInPlay(copy, readyVampire(turn.gameState, other, 3))
            expectEqual(hasUniqueCopyInPlay(turn.player, turn.card), true, 'a copy is attached')
        },
    },
    {
        name: 'the attached cards follow their minion to torpor and burn with it',
        run() {
            const turn = createEquipTurn(MAGNUM_ID)
            const { gameState, player, card, ready } = turn
            attachInPlay(card, ready, { disciplines: SPY_INFERIOR })

            must(
                gameMutations.moveCardToRegion.act(player, {
                    card: ready,
                    fromCardRegion: player.ready,
                    toCardRegion: player.torpor,
                    x: 0,
                    y: TORPOR_ZONE_Y,
                }),
                'to torpor',
            )
            expectEqual(card.isIn.torpor, true, 'the card follows to torpor')
            expectEqual(getHost(card), ready, 'still attached')
            expectEqual(card.position < ready.position, true, 'under the minion')

            must(
                gameMutations.moveCardToRegion.act(player, {
                    card: ready,
                    fromCardRegion: player.torpor,
                    toCardRegion: player.ashHeap,
                    x: 0,
                    y: 0,
                }),
                'burn the minion',
            )
            expectEqual(card.isIn.ashHeap, true, 'the card burns with the minion')
            expectEqual(isAttached(card), false, 'attached')
            expectEqual(Object.keys(gameState.attachments).length, 0, 'no attachment left')
            expectEqual(Object.keys(gameState.attachmentUsages).length, 0, 'no usage left')
        },
    },
    {
        name: 'a minion that goes to torpor in combat takes its attached cards with it',
        run() {
            const fight = createFight(3, 1, AttachDeck)
            const { defendingPlayer, defending } = fight
            const card = findCard(defendingPlayer, MAGNUM_ID)
            attachInPlay(card, defending)
            strikeRoundToEnd(fight, createStrike('Quick', { damage: 2, firstStrike: true }))
            expectRegion(defending, 'torpor')
            expectEqual(card.isIn.torpor, true, 'the card follows to torpor')
            expectEqual(getHost(card), defending, 'still attached')
        },
    },
    {
        name: 'an attached card that leaves play is detached, its minion stays',
        run() {
            const turn = createEquipTurn(MAGNUM_ID)
            const { gameState, player, card, ready } = turn
            attachInPlay(card, ready)
            gameState.moveCardToRegion(card, player.ashHeap)
            expectEqual(isAttached(card), false, 'attached')
            expectEqual(ready.isIn.ready, true, 'the minion stays')
        },
    },
    {
        name: 'a minion cannot be attached, nor a card to itself',
        run() {
            const turn = createEquipTurn(MAGNUM_ID)
            const { player, ready, torpid } = turn
            mustRefuse(
                gameMutations.attachCard.act(player, { card: torpid, minion: ready }),
                'a minion',
            )
            mustRefuse(
                gameMutations.attachCard.act(player, { card: ready, minion: ready }),
                'itself',
            )
        },
    },
    {
        name: 'with queued mutations ( the browser ) a retainer still ends attached, with its life',
        run() {
            const turn = createEquipTurn(RAVEN_SPY_ID, AttachDeck, DisciplineLevel.INFERIOR)
            const queue = registerQueuedMutationTrigger()
            const flush = () => {
                while (queue.queued() > 0) {
                    queue.flush()
                }
            }
            try {
                const { decision, mine } = equipOptions(turn)
                applyOption(decision, mine[0])
                flush()
                const agent = new PassiveAgent()
                for (let i = 0; i < 20 && turn.gameState.action; i++) {
                    const player = getDecidingPlayer(turn.gameState)
                    if (!player) {
                        throw new ScenarioFailure('Nobody has the impulse during the action')
                    }
                    stepBot(player, agent)
                    flush()
                }
                expectEqual(turn.gameState.action, null, 'action in progress')
                expectEqual(getHost(turn.card), turn.ready, 'host')
                expectEqual(turn.card.position < turn.ready.position, true, 'under the minion')
                expectEqual(turn.card.blood, 1, 'life of the retainer')
                expectEqual(
                    turn.gameState.attachmentUsages[turn.card.oid]?.[0]?.level,
                    DisciplineLevel.INFERIOR,
                    'the version is remembered',
                )
            } finally {
                registerSyncMutationTrigger()
            }
        },
    },
    {
        name: 'the equipment a human plays is not attached by the engine',
        run() {
            const table = createHumanTable(2, MAGNUM_ID, AttachDeck)
            const card = table.card
            if (!card) {
                throw new ScenarioFailure('The human has no card')
            }
            humanDeclares(table, createActionCardAction(table.acting, card, {}))
            // The human puts the card on the table by hand
            table.gameState.moveCardToRegion(card, table.human.ready)
            const pool = table.human.pool
            must(gameMutations.ACTION_resolveAction.act(table.human, {}), 'resolve')
            expectEqual(table.human.pool, pool - 2, 'the cost is paid')
            expectEqual(isAttached(card), false, 'attached')
            expectEqual(card.isIn.ready, true, 'the human keeps the card where it is')
        },
    },
    {
        name: '.44 Magnum: its bearer gets a free ranged strike of 2 and a maneuver that chooses it, not the opposing minion',
        run() {
            const fight = createFight(3, 3, AttachDeck)
            const magnum = findCard(fight.actingPlayer, MAGNUM_ID)
            attachInPlay(magnum, fight.acting)

            passUntil(fight, CombatStep.DetermineRange)
            const maneuvers = weaponManeuvers(getCombatDecision(fight, fight.actingPlayer))
            expectEqual(maneuvers.length, 1, 'weapon maneuvers')
            expectEqual(maneuvers[0].weapon, magnum, 'weapon')
            expectEqual(maneuvers[0].card, undefined, 'no card to play')
            expectEqual(maneuvers[0].strike?.damage, 2, 'damage')
            expectEqual(maneuvers[0].strike?.ranged, true, 'ranged')
            expectEqual(maneuvers[0].strike?.source, magnum, 'source')

            passUntil(fight, CombatStep.Strike)
            const strikes = optionsOfType(
                getCombatDecision(fight, fight.actingPlayer).options,
                'combatStrike',
            )
            const weapon = strikes.filter(option => option.strike.source == magnum)
            expectEqual(weapon.length, 1, 'weapon strikes')
            expectEqual(weapon[0].card, undefined, 'no card to play')
            expectEqual(
                strikes.some(option => option.strike.isHand),
                true,
                'the hand strike',
            )
            expectEqual(getAttachedCombatOptions(fight.defending).length, 0, 'the opponent')
        },
    },
    {
        name: '.44 Magnum: the maneuver goes to long range and chooses the strike, which hits where hands cannot',
        run() {
            const fight = createFight(3, 3, AttachDeck)
            const magnum = findCard(fight.actingPlayer, MAGNUM_ID)
            attachInPlay(magnum, fight.acting)

            passUntil(fight, CombatStep.DetermineRange)
            const decision = getCombatDecision(fight, fight.actingPlayer)
            applyOption(decision, weaponManeuvers(decision)[0])
            expectEqual(getCombat(fight).range, CombatRange.Long, 'range')
            expectEqual(getCombat(fight).acting.strike?.source, magnum, 'the strike is chosen')
            expectEqual(getCombat(fight).weaponManeuvers.includes(magnum.oid), true, 'recorded')

            strikeRoundToEnd(fight)
            passUntil(fight, null)
            expectEqual(fight.defending.blood, 1, 'defending blood (the 2R strike)')
            expectEqual(fight.acting.blood, 3, 'acting blood (the hand strike is out of range)')
        },
    },
    {
        name: '.44 Magnum: the maneuver is given once per combat, the strike stays available',
        run() {
            const fight = createFight(3, 3, AttachDeck)
            const magnum = findCard(fight.actingPlayer, MAGNUM_ID)
            attachInPlay(magnum, fight.acting)

            passUntil(fight, CombatStep.DetermineRange)
            const decision = getCombatDecision(fight, fight.actingPlayer)
            const maneuver = weaponManeuvers(decision)[0]
            applyOption(decision, maneuver)

            // Back to a fresh window of the range step: the weapon has already given its maneuver
            const combat = getCombat(fight)
            combat.acting.strike = null
            combat.lastPlayedBy = null
            combat.impulsePlayer = fight.actingPlayer
            mustRefuse(
                gameMutations.COMBAT_maneuver.act(fight.actingPlayer, {
                    minion: fight.acting,
                    strike: maneuver.strike,
                    weapon: magnum,
                }),
                'a second maneuver of the weapon',
            )
            expectEqual(
                weaponManeuvers(getCombatDecision(fight, fight.actingPlayer)).length,
                0,
                'offered again',
            )

            passUntil(fight, CombatStep.Strike)
            const strikes = optionsOfType(
                getCombatDecision(fight, fight.actingPlayer).options,
                'combatStrike',
            )
            expectEqual(
                strikes.some(option => option.strike.source == magnum),
                true,
                'the strike',
            )
        },
    },
    {
        name: '.44 Magnum: only hand strikes under a grapple',
        run() {
            const fight = createFight(3, 3, AttachDeck)
            const magnum = findCard(fight.actingPlayer, MAGNUM_ID)
            attachInPlay(magnum, fight.acting)
            passUntil(fight, CombatStep.Strike)
            getCombat(fight).handStrikesOnly = true
            const strikes = optionsOfType(
                getCombatDecision(fight, fight.actingPlayer).options,
                'combatStrike',
            )
            expectEqual(
                strikes.some(option => option.strike.source == magnum),
                false,
                'weapon',
            )
            expectEqual(
                strikes.some(option => option.strike.isHand),
                true,
                'hand strike',
            )
        },
    },
    {
        name: '.44 Magnum: the Govern agent strikes with it when it hits harder than its hands',
        run() {
            const fight = createFight(3, 3, AttachDeck)
            const magnum = findCard(fight.actingPlayer, MAGNUM_ID)
            attachInPlay(magnum, fight.acting)
            passUntil(fight, CombatStep.Strike)
            const step = stepBot(fight.actingPlayer, new GovernAgent())
            expectEqual(step?.option.type, 'combatStrike', 'option')
            expectEqual(
                step?.option.type == 'combatStrike' ? step.option.strike.source : null,
                magnum,
                'the weapon strikes',
            )
        },
    },
    {
        name: '.44 Magnum: the Govern agent that is weaker uses the maneuver of the weapon to shoot from afar',
        run() {
            const fight = createFight(3, 3, AttachDeck)
            const magnum = findCard(fight.actingPlayer, MAGNUM_ID)
            attachInPlay(magnum, fight.acting)
            getCombat(fight).acting.strength = 1
            getCombat(fight).defending.strength = 2
            passUntil(fight, CombatStep.DetermineRange)
            const step = stepBot(fight.actingPlayer, new GovernAgent())
            expectEqual(step?.option.type, 'combatManeuver', 'option')
            expectEqual(
                step?.option.type == 'combatManeuver' ? step.option.weapon : null,
                magnum,
                'the weapon maneuvers',
            )
            expectEqual(getCombat(fight).range, CombatRange.Long, 'range')
        },
    },
    {
        name: 'Raven Spy: its employer gets +1 intercept, whatever the version, as long as it is attached',
        run() {
            const turn = createEquipTurn(RAVEN_SPY_ID, AttachDeck, DisciplineLevel.INFERIOR)
            const { ready, card } = turn
            const base = ready.minionAttrs.intercept
            expectEqual(getMinionIntercept(ready), base, 'unattached')

            attachInPlay(card, ready, { life: 1, disciplines: SPY_INFERIOR })
            expectEqual(getMinionIntercept(ready), base + 1, 'inferior')

            turn.gameState.attachmentUsages[card.oid] = [
                { discipline: Discipline.Animalism, level: DisciplineLevel.SUPERIOR },
            ]
            expectEqual(getMinionIntercept(ready), base + 1, 'superior')

            // A retainer with no record ( stolen from a human ) counts as its first version
            delete turn.gameState.attachmentUsages[card.oid]
            expectEqual(getMinionIntercept(ready), base + 1, 'no record')

            turn.gameState.moveCardToRegion(card, turn.player.ashHeap)
            expectEqual(getMinionIntercept(ready), base, 'once gone')
        },
    },
    {
        name: 'Raven Spy: the intercept counts when its employer blocks',
        run() {
            const table = createHumanTable(2, undefined, AttachDeck)
            const [prey] = table.others
            const blocker = table.blockers[0]
            attachInPlay(findAnyCard(prey, RAVEN_SPY_ID), blocker, {
                life: 1,
                disciplines: SPY_INFERIOR,
            })
            humanDeclares(table, createBleedAction(table.acting, prey))
            if (!table.gameState.action) {
                throw new ScenarioFailure('No action')
            }
            // Alone, the intercept of the blocker would not be enough
            table.gameState.action.stealth = 2
            const step = stepBot(prey, new GovernAgent())
            expectEqual(step?.option.type, 'block', 'the bot blocks')
            expectEqual(table.gameState.action?.intercept, 2, 'intercept of the block attempt')
        },
    },
    {
        name: 'Raven Spy: a strike aimed at it burns its life, not the blood of its employer',
        run() {
            const fight = createFight(3, 3, AttachDeck)
            const spy = findCard(fight.defendingPlayer, RAVEN_SPY_ID)
            attachInPlay(spy, fight.defending, { life: 2, disciplines: SPY_INFERIOR })

            const aimed = getAttachedCombatOptions(fight.acting).find(
                option => option.type == 'combatStrike' && option.strike.retainer == spy,
            )
            if (aimed?.type != 'combatStrike') {
                throw new ScenarioFailure('The strike at the retainer is not offered')
            }
            strikeRoundToEnd(fight, aimed.strike)
            expectEqual(spy.blood, 1, 'life of the retainer')
            expectEqual(getHost(spy), fight.defending, 'still attached')
            expectEqual(fight.defending.blood, 3, 'the employer is not hurt')
            expectEqual(fight.acting.blood, 2, 'the hand strike of the employer')
        },
    },
    {
        name: 'Raven Spy: a retainer with no life left is burned, its employer loses the intercept',
        run() {
            const fight = createFight(3, 3, AttachDeck)
            const spy = findCard(fight.defendingPlayer, RAVEN_SPY_ID)
            attachInPlay(spy, fight.defending, { life: 1, disciplines: SPY_INFERIOR })
            const base = fight.defending.minionAttrs.intercept
            expectEqual(getMinionIntercept(fight.defending), base + 1, 'before')

            const aimed = getAttachedCombatOptions(fight.acting).find(
                option => option.type == 'combatStrike' && option.strike.retainer == spy,
            )
            if (aimed?.type != 'combatStrike') {
                throw new ScenarioFailure('The strike at the retainer is not offered')
            }
            strikeRoundToEnd(fight, aimed.strike)
            expectEqual(spy.isIn.ashHeap, true, 'burned')
            expectEqual(isAttached(spy), false, 'attached')
            expectEqual(Object.keys(fight.gameState.attachmentUsages).length, 0, 'usage left')
            expectEqual(getMinionIntercept(fight.defending), base, 'after')
            expectEqual(fight.defending.blood, 3, 'the employer is not hurt')
        },
    },
    {
        name: 'Raven Spy: a dodge protects it from the strike aimed at it',
        run() {
            const fight = createFight(3, 3, AttachDeck)
            const spy = findCard(fight.defendingPlayer, RAVEN_SPY_ID)
            attachInPlay(spy, fight.defending, { life: 1, disciplines: SPY_INFERIOR })
            const aimed = getAttachedCombatOptions(fight.acting).find(
                option => option.type == 'combatStrike' && option.strike.retainer == spy,
            )
            if (aimed?.type != 'combatStrike') {
                throw new ScenarioFailure('The strike at the retainer is not offered')
            }
            strikeRoundToEnd(fight, aimed.strike, createDodgeStrike())
            expectEqual(spy.blood, 1, 'life of the retainer')
            expectEqual(getHost(spy), fight.defending, 'still attached')
        },
    },
    {
        name: 'a strike can only be aimed at a retainer of the opposing minion',
        run() {
            const fight = createFight(3, 3, AttachDeck)
            const ownSpy = findCard(fight.actingPlayer, RAVEN_SPY_ID)
            const spy = findCard(fight.defendingPlayer, RAVEN_SPY_ID)
            const magnum = findCard(fight.defendingPlayer, MAGNUM_ID)
            attachInPlay(ownSpy, fight.acting, { life: 1, disciplines: SPY_INFERIOR })
            attachInPlay(spy, fight.defending, { life: 1, disciplines: SPY_INFERIOR })
            attachInPlay(magnum, fight.defending)

            const aimed = getAttachedCombatOptions(fight.acting).flatMap(option =>
                option.type == 'combatStrike' && option.strike.retainer ?
                    [option.strike.retainer]
                :   [],
            )
            expectEqual(aimed.length, 1, 'the strikes aimed at a retainer')
            expectEqual(aimed[0], spy, 'the retainer of the opposing minion')

            passUntil(fight, CombatStep.Strike)
            mustRefuse(
                gameMutations.COMBAT_chooseStrike.act(fight.actingPlayer, {
                    minion: fight.acting,
                    strike: { ...createHandStrike(getCombat(fight).acting), retainer: ownSpy },
                }),
                'a strike at an own retainer',
            )
        },
    },
]

/**
 * Cards put on a minion that are neither equipment nor retainers: a master card that goes on one of
 * the player's vampires ( Blood Doll ), an action card that goes on the acting vampire
 * ( Preternatural Strength ).
 */

const PRETERNATURAL_ID = '101483'

// The master phase of a player holding a Blood Doll as their only card, with ready vampires of the
// given blood and one vampire in torpor
function createDollTurn(bloods: number[]) {
    const { gameState } = createHeadlessGame([AttachDeck, AttachDeck])
    createdGames.push(gameState)
    const player = gameState.activePlayer
    if (!player) {
        throw new ScenarioFailure('No active player')
    }
    emptyHand(gameState, player)
    const doll = giveCard(gameState, player, BLOOD_DOLL_ID)
    const vampires = bloods.map(blood => readyVampire(gameState, player, blood))
    const torpid = player.vampiresInUncontrolled[0]
    gameState.moveCardToRegion(torpid, player.torpor)
    torpid.blood = 1
    gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Master)
    gameState.turnResources.unlocked = true
    return { gameState, player, library: doll, doll, vampires, torpid }
}

// Plays the doll on the vampire through the master phase decision
function playDoll(turn: ReturnType<typeof createDollTurn>, target: Vampire): void {
    const decision = getMasterDecision(turn)
    const play = optionsOfType(decision.options, 'playMaster').find(
        option => option.card == turn.doll && option.target == target,
    )
    if (!play) {
        throw new ScenarioFailure(`The doll cannot be put on ${target.name}`)
    }
    applyOption(decision, play)
}

const moveBloodOptions = (turn: ReturnType<typeof createDollTurn>) =>
    optionsOfType(getMasterDecision(turn).options, 'moveBlood')

// Moves blood to the pool or to the vampire with the first doll that can
function applyMoveBlood(turn: ReturnType<typeof createDollTurn>, toPool: boolean): void {
    const decision = getMasterDecision(turn)
    const move = optionsOfType(decision.options, 'moveBlood').find(
        option => option.toPool == toPool,
    )
    if (!move) {
        throw new ScenarioFailure(`No move ${toPool ? 'to the pool' : 'to the vampire'}`)
    }
    applyOption(decision, move)
}

function setPotence(vampire: Vampire, level: DisciplineLevel | null): void {
    vampire.minionAttrs.disciplines = Object.fromEntries(
        Object.entries(vampire.minionAttrs.disciplines).filter(
            ([name]) => name != Discipline.Potence,
        ),
    ) as Disciplines
    if (level) {
        vampire.minionAttrs.disciplines[Discipline.Potence] = level
    }
}

const createStrengthTurn = (level: DisciplineLevel | null) => {
    const turn = createEquipTurn(PRETERNATURAL_ID)
    setPotence(turn.ready, level)
    return turn
}

const POTENCE_SUPERIOR: DisciplineUse[] = [
    { discipline: Discipline.Potence, level: DisciplineLevel.SUPERIOR },
]

const PUT_ON_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'Blood Doll can be put on each vampire of the player, ready or in torpor, and on no other',
        run() {
            const turn = createDollTurn([2, 3])
            const targets = optionsOfType(getMasterDecision(turn).options, 'playMaster').map(
                option => option.target,
            )
            expectEqual(targets.length, 3, 'options')
            expectEqual(
                [...turn.vampires, turn.torpid].every(vampire => targets.includes(vampire)),
                true,
                'targets',
            )
        },
    },
    {
        name: 'Blood Doll is put under its vampire for the master phase action ( it costs nothing ), and stays in play',
        run() {
            const turn = createDollTurn([2, 3])
            const { gameState, player, doll } = turn
            const pool = player.pool
            const mpa = gameState.turnResources.mpa
            playDoll(turn, turn.vampires[0])

            expectEqual(getHost(doll), turn.vampires[0], 'host')
            expectEqual(doll.region, player.ready, 'region')
            expectEqual(doll.position < turn.vampires[0].position, true, 'drawn under the vampire')
            expectEqual(player.pool, pool, 'pool')
            expectEqual(gameState.turnResources.mpa, mpa - 1, 'master phase action')
            expectEqual(
                getDecisionPoint(gameState, player)?.kind == DecisionKind.Cleanup,
                false,
                'cleanup',
            )
        },
    },
    {
        name: 'Blood Doll on a vampire in torpor follows it there, and still works',
        run() {
            const turn = createDollTurn([2])
            playDoll(turn, turn.torpid)
            expectEqual(turn.doll.isIn.torpor, true, 'in torpor with the vampire')
            expectEqual(getHost(turn.doll), turn.torpid, 'host')
            expectEqual(
                moveBloodOptions(turn).every(option => option.vampire == turn.torpid),
                true,
                'the options are for the vampire in torpor',
            )
            expectEqual(moveBloodOptions(turn).length > 0, true, 'usable in torpor')
        },
    },
    {
        name: 'Blood Doll moves 1 blood to the pool or to the vampire, once per turn, and again the next turn',
        run() {
            const turn = createDollTurn([2])
            const [vampire] = turn.vampires
            const { gameState, player } = turn
            playDoll(turn, vampire)
            const pool = player.pool

            expectEqual(moveBloodOptions(turn).length, 2, 'both directions')
            applyMoveBlood(turn, true)
            expectEqual(vampire.blood, 1, 'blood of the vampire')
            expectEqual(player.pool, pool + 1, 'pool')
            expectEqual(moveBloodOptions(turn).length, 0, 'used this turn')

            gameState.setNewTurnResources()
            gameState.turnResources.unlocked = true
            applyMoveBlood(turn, false)
            expectEqual(vampire.blood, 2, 'blood of the vampire')
            expectEqual(player.pool, pool, 'pool')
        },
    },
    {
        name: 'Blood Doll never takes blood from an empty vampire, overfills one, nor takes the last pool',
        run() {
            const turn = createDollTurn([0, 4])
            const [empty, full] = turn.vampires
            full.minionAttrs.capacity = 4
            for (const vampire of turn.vampires) {
                attachInPlay(findCard(turn.player, BLOOD_DOLL_ID), vampire)
            }
            const options = moveBloodOptions(turn)
            const of = (vampire: Vampire) => options.filter(option => option.vampire == vampire)
            expectEqual(
                of(empty)
                    .map(option => option.toPool)
                    .join(),
                'false',
                'empty vampire',
            )
            expectEqual(
                of(full)
                    .map(option => option.toPool)
                    .join(),
                'true',
                'full vampire',
            )

            turn.player.pool = 1
            expectEqual(
                moveBloodOptions(turn).filter(option => !option.toPool).length,
                0,
                'the last pool is kept',
            )
        },
    },
    {
        name: 'Blood Doll is used without a master phase action, which only playing it needs',
        run() {
            const turn = createDollTurn([2])
            turn.gameState.turnResources.mpa = 0
            expectEqual(
                optionsOfType(getMasterDecision(turn).options, 'playMaster').length,
                0,
                'cannot be played',
            )
            attachInPlay(turn.doll, turn.vampires[0])
            expectEqual(moveBloodOptions(turn).length, 2, 'can be used')
        },
    },
    {
        name: 'Blood Doll burns with its vampire',
        run() {
            const turn = createDollTurn([2])
            playDoll(turn, turn.vampires[0])
            turn.gameState.moveCardToRegion(turn.vampires[0], turn.player.ashHeap)
            expectEqual(turn.doll.isIn.ashHeap, true, 'burned')
            expectEqual(isAttached(turn.doll), false, 'attached')
        },
    },
    {
        name: 'with queued mutations ( the browser ) Blood Doll is still put on its vampire, and moves blood',
        run() {
            const turn = createDollTurn([2])
            const [vampire] = turn.vampires
            const pool = turn.player.pool
            const queue = registerQueuedMutationTrigger()
            const flush = () => {
                while (queue.queued() > 0) {
                    queue.flush()
                }
            }
            try {
                playDoll(turn, vampire)
                flush()
                expectEqual(getHost(turn.doll), vampire, 'host')
                expectEqual(turn.doll.region, turn.player.ready, 'region')

                applyMoveBlood(turn, true)
                flush()
                expectEqual(vampire.blood, 1, 'blood of the vampire')
                expectEqual(turn.player.pool, pool + 1, 'pool')
            } finally {
                registerSyncMutationTrigger()
            }
        },
    },
    {
        name: 'the Govern agent puts a Blood Doll on its biggest vampire, then banks the blood past half its capacity',
        run() {
            const turn = createDollTurn([2, 6])
            const [small, big] = turn.vampires
            small.minionAttrs.capacity = 6
            big.minionAttrs.capacity = 9
            turn.torpid.minionAttrs.capacity = 3
            const agent = new GovernAgent()

            const first = stepBot(turn.player, agent)
            expectEqual(first?.option.type, 'playMaster', 'first option')
            expectEqual(getHost(turn.doll), big, 'the doll goes on the biggest vampire')

            const second = stepBot(turn.player, agent)
            expectEqual(second?.option.type, 'moveBlood', 'second option')
            expectEqual(big.blood, 5, 'blood moved to the pool')

            expectEqual(stepBot(turn.player, agent)?.option.type, 'endPhase', 'then nothing to do')
        },
    },
    {
        name: 'a card is put on the minions that fit its filter: vampire or minion, clan, sect, capacity, not in torpor',
        run() {
            const turn = createDollTurn([2, 3])
            const [ventrue, toreador] = turn.vampires
            ventrue.vampireAttrs.clan = 'Ventrue'
            ventrue.vampireAttrs.sect = 'Camarilla'
            ventrue.minionAttrs.capacity = 8
            toreador.vampireAttrs.clan = 'Toreador'
            toreador.vampireAttrs.sect = 'Anarch'
            toreador.minionAttrs.capacity = 5

            const matches = (vampire: Vampire, filter: MinionFilter) =>
                matchesMinionFilter(vampire, filter)
            expectEqual(matches(ventrue, aVampire({ clan: 'Ventrue', minCapacity: 8 })), true, 'a')
            expectEqual(matches(ventrue, aVampire({ clan: 'ventrue' })), true, 'case')
            expectEqual(matches(ventrue, aVampire({ clan: 'Ventrue', minCapacity: 9 })), false, 'b')
            expectEqual(matches(toreador, aVampire({ clan: 'Ventrue' })), false, 'clan')
            expectEqual(matches(toreador, aMinion({ maxCapacity: 5 })), true, 'max capacity')
            expectEqual(matches(toreador, aMinion({ maxCapacity: 4 })), false, 'too big')
            expectEqual(matches(toreador, aVampire({ sect: 'Anarch' })), true, 'sect')
            expectEqual(matches(ventrue, aVampire({ sect: 'Anarch' })), false, 'other sect')

            const fitting = (filter: MinionFilter) => getAttachCandidates(turn.player, filter)
            expectEqual(fitting(aVampire()).length, 3, 'any vampire, torpor included')
            expectEqual(fitting(aVampire({ ready: true })).includes(turn.torpid), false, 'ready')
            expectEqual(
                fitting(aVampire({ clan: 'Ventrue', minCapacity: 8 }))
                    .map(minion => minion.name)
                    .join(),
                ventrue.name,
                'clan and capacity',
            )
        },
    },
    {
        name: 'an action card put on a chosen minion has the minions that fit as targets, and goes on its target',
        run() {
            const turn = createDollTurn([3, 3])
            const [ventrue, toreador] = turn.vampires
            ventrue.vampireAttrs.clan = 'Ventrue'
            toreador.vampireAttrs.clan = 'Toreador'
            const def = defineCard('999999', 'Test card', [
                attachToMinion([strengthEffect(1)], undefined, {
                    to: aVampire({ clan: 'Ventrue' }),
                    onePerMinion: true,
                }),
            ])
            const Implementation = actionImplementation(def)

            const targets = new Implementation(toreador, {}).getTargets()
            expectEqual(targets.length == 1 && targets[0] == ventrue, true, 'targets')
            const onVentrue = new Implementation(toreador, { target: ventrue })
            must(onVentrue.canDeclare(), 'on the Ventrue')
            expectEqual(onVentrue.attachHost, ventrue, 'the card goes on its target')
            mustRefuse(new Implementation(toreador, { target: toreador }).canDeclare(), 'clan')
            mustRefuse(new Implementation(toreador, {}).canDeclare(), 'no target')
        },
    },
    {
        name: 'Preternatural Strength is offered to a vampire with Potence, at each level it has',
        run() {
            expectEqual(equipOptions(createStrengthTurn(null)).mine.length, 0, 'no Potence')
            expectEqual(
                equipOptions(createStrengthTurn(DisciplineLevel.INFERIOR)).mine.length,
                1,
                'inferior',
            )
            expectEqual(
                equipOptions(createStrengthTurn(DisciplineLevel.SUPERIOR)).mine.length,
                2,
                'superior',
            )
        },
    },
    {
        name: 'Preternatural Strength at superior: +2 stealth, costs 1 blood, and puts +2 strength on the acting vampire',
        run() {
            const turn = createStrengthTurn(DisciplineLevel.SUPERIOR)
            const { decision, mine } = equipOptions(turn)
            const superior = mine.find(option => levelOf(option) == DisciplineLevel.SUPERIOR)
            if (!superior) {
                throw new ScenarioFailure('No superior option')
            }
            const strengthBefore = getMinionStrength(turn.ready)
            applyOption(decision, superior)
            expectEqual(turn.gameState.action?.stealth, 2, 'stealth of the action')
            resolveAction(turn)

            expectEqual(getHost(turn.card), turn.ready, 'host')
            expectEqual(turn.ready.blood, 4, 'blood after the 1 blood cost')
            expectEqual(
                getDecisionPoint(turn.gameState, turn.player)?.kind == DecisionKind.Cleanup,
                false,
                'the card is kept, nothing to clean up',
            )
            expectEqual(getMinionStrength(turn.ready), strengthBefore + 2, 'strength')
            const combat = createCombatState(turn.ready, turn.torpid)
            expectEqual(combat.acting.strength, strengthBefore + 2, 'strength in combat')
            expectEqual(
                createHandStrike(combat.acting).damage,
                strengthBefore + 2,
                'damage of the hand strike',
            )
            expectEqual(turn.ready.minionAttrs.strength, strengthBefore, 'the printed strength')
        },
    },
    {
        name: 'Preternatural Strength at inferior gives +1 strength, and none once it is gone',
        run() {
            const turn = createStrengthTurn(DisciplineLevel.INFERIOR)
            const strengthBefore = getMinionStrength(turn.ready)
            const { decision, mine } = equipOptions(turn)
            applyOption(decision, mine[0])
            resolveAction(turn)
            expectEqual(getMinionStrength(turn.ready), strengthBefore + 1, 'strength')

            turn.gameState.moveCardToRegion(turn.card, turn.player.ashHeap)
            expectEqual(getMinionStrength(turn.ready), strengthBefore, 'once gone')
        },
    },
    {
        name: 'Preternatural Strength is discarded when its action fails, and nothing is put on the vampire',
        run() {
            const turn = createStrengthTurn(DisciplineLevel.INFERIOR)
            const strengthBefore = getMinionStrength(turn.ready)
            const { decision, mine } = equipOptions(turn)
            applyOption(decision, mine[0])
            must(gameMutations.ACTION_endAction.act(turn.player, {}), 'end the action')

            const cleanup = getDecisionPoint(turn.gameState, turn.player)
            if (cleanup?.kind != DecisionKind.Cleanup) {
                throw new ScenarioFailure(`Expected a cleanup, got ${cleanup?.kind}`)
            }
            applyOption(cleanup, cleanup.options[0])
            expectEqual(turn.card.isIn.ashHeap, true, 'the card is discarded')
            expectEqual(getMinionStrength(turn.ready), strengthBefore, 'strength')
        },
    },
    {
        name: 'a vampire can have only one Preternatural Strength, another vampire can have its own',
        run() {
            const turn = createStrengthTurn(DisciplineLevel.INFERIOR)
            const { gameState, player, ready } = turn
            const other = readyVampire(gameState, player, 5)
            setPotence(other, DisciplineLevel.INFERIOR)
            attachInPlay(turn.card, ready, {
                disciplines: [{ discipline: Discipline.Potence, level: DisciplineLevel.INFERIOR }],
            })

            const second = giveCard(gameState, player, PRETERNATURAL_ID)
            const decision = getDecisionPoint(gameState, player)
            const actors = optionsOfType(decision?.options ?? [], 'declareAction').flatMap(
                option =>
                    (
                        option.action.type == MinionActionType.ActionCardFromHand &&
                        option.action.card == second
                    ) ?
                        [option.action.actingMinion]
                    :   [],
            )
            expectEqual(actors.includes(ready), false, 'the vampire that has one')
            expectEqual(actors.includes(other), true, 'the other vampire')
            mustRefuse(
                canDeclare(
                    createActionCardAction(ready, second, {
                        disciplines: [
                            { discipline: Discipline.Potence, level: DisciplineLevel.INFERIOR },
                        ],
                    }),
                ),
                'a second copy',
            )
        },
    },
    {
        name: 'a vampire with Preternatural Strength cannot play Torn Signpost',
        run() {
            const deck = { ...BrujahDeck, [PRETERNATURAL_ID]: 2 }
            const fight = createFight(3, 3, deck)
            const { gameState, acting, actingPlayer } = fight
            acting.minionAttrs.strength = 1
            getCombat(fight).acting.strength = 1
            acting.minionAttrs.disciplines = {} as Disciplines
            acting.minionAttrs.disciplines[Discipline.Potence] = DisciplineLevel.SUPERIOR
            emptyHand(gameState, actingPlayer)
            const signpost = giveCard(gameState, actingPlayer, TORN_SIGNPOST_ID)
            sealLibrary(gameState, fight.defendingPlayer)
            const strengthOptions = () =>
                getCombatCardOptions(acting).filter(
                    option => option.type == 'combatStrength' && option.card == signpost,
                )
            expectEqual(strengthOptions().length, 2, 'before')

            const preternatural = findCard(actingPlayer, PRETERNATURAL_ID)
            attachInPlay(preternatural, acting, { disciplines: POTENCE_SUPERIOR })
            expectEqual(strengthOptions().length, 0, 'with Preternatural Strength')

            gameState.moveCardToRegion(preternatural, actingPlayer.ashHeap)
            expectEqual(strengthOptions().length, 2, 'once it is gone')
        },
    },
]

function parseFilter(argv: string[]): string {
    const index = argv.indexOf('--filter')
    if (index < 0) {
        return ''
    }
    const text = argv[index + 1]
    if (!text) {
        throw new Error('--filter needs a text')
    }
    return text.toLowerCase()
}

function runScenarios(filter: string): ScenarioResult[] {
    return [
        ...SCENARIOS,
        ...TORPOR_SCENARIOS,
        ...COST_SCENARIOS,
        ...DECLARE_SCENARIOS,
        ...FAR_MASTERY_SCENARIOS,
        ...CARD_SCENARIOS,
        ...HUMAN_DAMAGE_SCENARIOS,
        ...BOUNCE_SCENARIOS,
        ...HUMAN_ACTION_SCENARIOS,
        ...MASTER_SCENARIOS,
        ...CATALOG_SCENARIOS,
        ...BRUJAH_SCENARIOS,
        ...BRUJAH_COMBAT_SCENARIOS,
        ...BRUJAH_ACTION_SCENARIOS,
        ...BRUJAH_REACTION_SCENARIOS,
        ...EVENT_SCENARIOS,
        ...ALINE_SCENARIOS,
        ...ATTACHMENT_SCENARIOS,
        ...PUT_ON_SCENARIOS,
    ]
        .filter(({ name }) => name.toLowerCase().includes(filter))
        .map(({ name, run }) => {
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

const results = runScenarios(parseFilter(process.argv.slice(2)))
if (results.length == 0) {
    console.error('No scenario matches the filter')
    process.exit(1)
}
for (const { name, error } of results) {
    console.log(`${error ? 'FAIL' : 'ok  '} ${name}${error ? `\n       ${error}` : ''}`)
}
const failures = results.filter(result => result.error)
console.log(`\n${results.length} scenarios, ${failures.length} failures`)
process.exit(failures.length > 0 ? 1 : 0)
