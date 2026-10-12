// Hand-built bot scenarios (combat, actions, reactions, master cards, hand size, uniqueness...)
// checked against the rulebook. Run from the repo root:
//   npx tsx script/botScenarios.ts [--filter text]
// --filter keeps only the scenarios whose name contains the text (case-insensitive).
// Several texts can be given separated by '|' ( --filter "Conditioning|Bonding" ).
// Exits with code 1 if any scenario fails.
import { readFileSync } from 'node:fs'
import { Card, LibraryCard, Minion, Vampire } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { botMutations } from '@/shared/state/botMutations.ts'
import { deleteGameState, registerLogger, setGameResources } from '@/shared/registries.ts'
import { initWasmHasher } from '@/shared/hashing.ts'
import {
    canManeuver,
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
    OUST_POOL_GAIN,
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
    MINION_TAP_ID,
    VILLEIN_ID,
} from '@/shared/cardImpl/cardIds.ts'
import { MasterCardImplementation } from '@/shared/cardImpl/base.ts'
import { getMasterImplementation, MASTER_CARD_IMPLEMENTATIONS } from '@/shared/cardImpl/index.ts'
import {
    getAttachedCombatOptions,
    getCombatCardOptions,
    getLockForActionOptions,
    getUnlockEffectOptions,
} from '@/shared/bot/cardOptions.ts'
import {
    getAttachCandidates,
    getEnvironmentalDamage,
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
    checkRecordedLedger,
    createHeadlessGame,
    MutationRecorder,
    recordMutations,
    registerQueuedMutationTrigger,
    registerSyncMutationTrigger,
} from './harness.ts'
import { AttachDeck, CrowsDeck } from './attachDeck.ts'
import { BrujahDeck, GovernDeck, MalkavDeck } from '@/shared/bot/decks.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { applyOption, getDecidingPlayer, getDecisionPoint } from '@/shared/bot/referee.ts'
import { stepBot } from '@/shared/bot/driver.ts'
import { BaseAgent } from '@/shared/bot/agents/baseAgent.ts'
import { getPlayerLedger } from '@/shared/bot/utility/ledger.ts'
import {
    CardSummary,
    describeEffect,
    Effect,
    summarizeCardId,
    waysUsableBy,
} from '@/shared/bot/utility/summaries.ts'
import { CARD_DEFS } from '@/shared/cardImpl/catalog/index.ts'
import { UtilityAgent } from '@/shared/bot/agents/utilityAgent.ts'
import { BotProfile, DEFAULT_PROFILE } from '@/shared/bot/utility/profile.ts'
import { AttachedKit, MinionProfile, profileMinion } from '@/shared/bot/utility/minionProfile.ts'
import {
    applyMove,
    CombatSim,
    legalMoves,
    Move,
    newCombatSim,
    outcomeOf,
    Side,
    SimCard,
    SimCombatant,
    SimStrike,
} from '@/shared/bot/utility/combatModel.ts'
import { CardFacts, combatCards } from '@/shared/bot/utility/combatSetup.ts'
import {
    Fighter,
    forecastFight,
    Hand,
    netLoss,
    policyWeightsOf,
} from '@/shared/bot/utility/combatPosition.ts'
import { chooseMove, playOut } from '@/shared/bot/utility/combatPolicy.ts'
import {
    describeMove,
    planCombat,
    planLine,
    planMove,
    planWeightsOf,
} from '@/shared/bot/utility/combatPlan.ts'
import { CombatPlay } from '@/shared/cardImpl/catalog/types.ts'
import { believedCards, seededRandom } from '@/shared/bot/utility/combatBelief.ts'
import { Densities } from '@/shared/bot/utility/defence.ts'
import {
    additionalStrike as additionalStrikeEffect,
    beforeRange as beforeRangeCondition,
    dodge as dodgeEffect,
    environmentalDamage as environmentalEffect,
    handStrike as handStrikeEffect,
    maneuver as maneuverEffect,
    oncePerCombat as oncePerCombatCondition,
    setStrength as setStrengthEffect,
} from '@/shared/cardImpl/catalog/builders.ts'
import { combatConditionHolds } from '@/shared/cardImpl/catalog/combatPlay.ts'
import { newCombatantFields, newStrike } from '@/shared/state/combatRules.ts'
import { traitsMeetRequirements } from '@/shared/state/cardRequirements.ts'
import {
    bounceTargetOf,
    canBounce,
    isRoleLive,
    takeSnapshot,
} from '@/shared/bot/utility/snapshot.ts'
import { roleDensities } from '@/shared/bot/utility/capabilities.ts'
import { binomial } from '@/shared/bot/utility/attack.ts'
import { attackKitOf, densitiesOf } from '@/shared/bot/utility/defence.ts'
import {
    Assessment,
    assess,
    bleedOnPrey,
    chanceOfOust,
    outcomeOfTurn,
    survivalCurve,
} from '@/shared/bot/utility/assessment.ts'
import { bloodChange } from '@/shared/bot/utility/bloat.ts'
import { gainOfBleeds, setupChance } from '@/shared/bot/utility/equity.ts'
import { describeAssessment, describeTurnPlan } from '@/shared/bot/utility/describeAssessment.ts'
import { returnWorth } from '@/shared/bot/utility/rescue.ts'
import { candidateOf, combatRisk, planTurn, TurnPlan } from '@/shared/bot/utility/turnPlan.ts'
import {
    combatStartAllowed,
    combatStartGain,
    combatStartOf,
} from '@/shared/bot/utility/enterCombat.ts'
import { serializeGameState } from '@/shared/serialization.ts'
import {
    BotAgent,
    BotContext,
    BotOption,
    BotOptionOf,
    CombatCardOption,
    DecisionKind,
    DecisionPoint,
    optionsOfType,
} from '@/shared/bot/types.ts'

/**
 * Hand-built combats checked against the rulebook. The harness only
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
        must(botMutations.COMBAT_pass.act(combat.impulsePlayer, {}), `pass in ${combat.step}`)
    }
    throw new ScenarioFailure(`The ${step} step was not reached`)
}

const pass = (player: Player, what: string) => must(botMutations.COMBAT_pass.act(player, {}), what)

const maneuver = (player: Player, minion: Minion, strike?: CombatStrike) =>
    must(botMutations.COMBAT_maneuver.act(player, { minion, strike }), 'maneuver')

const press = (player: Player, minion: Minion) =>
    must(botMutations.COMBAT_press.act(player, { minion }), 'press')

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
            botMutations.COMBAT_chooseStrike.act(player, {
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
            mustRefuse(botMutations.COMBAT_pass.act(fight.actingPlayer, {}), 'pass')
            mustRefuse(
                botMutations.COMBAT_chooseStrike.act(fight.defendingPlayer, {
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
            mustRefuse(botMutations.COMBAT_pass.act(fight.defendingPlayer, {}), 'pass out of turn')
            mustRefuse(
                botMutations.COMBAT_maneuver.act(fight.actingPlayer, { minion: fight.acting }),
                'maneuver before the range step',
            )
            mustRefuse(
                botMutations.COMBAT_press.act(fight.actingPlayer, { minion: fight.acting }),
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
                botMutations.COMBAT_maneuver.act(fight.actingPlayer, { minion: fight.acting }),
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
                botMutations.COMBAT_preventDamage.act(fight.actingPlayer, {
                    minion: fight.acting,
                    amount: 1,
                    aggravated: false,
                }),
                'prevent',
            )
            mustRefuse(
                botMutations.COMBAT_preventDamage.act(fight.actingPlayer, {
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
                botMutations.COMBAT_press.act(fight.actingPlayer, { minion: fight.acting }),
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
            must(botMutations.COMBAT_end.act(fight.defendingPlayer, {}), 'end combat')
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
        name: 'a ready minion can rescue the torpid vampire of another Methuselah, which comes back ready for its controller, and the controller does not block it',
        run() {
            const turn = createMinionPhase(3, 0)
            const other = turn.gameState.competingPlayers.find(player => player != turn.player)
            if (!other) {
                throw new ScenarioFailure('No other Methuselah')
            }
            // The other Methuselah has a minion that would block anything
            const blocker = readyVampire(turn.gameState, other, 5)
            blocker.minionAttrs.intercept = 9
            const friend = other.vampiresInUncontrolled[0]
            turn.gameState.moveCardToRegion(friend, other.torpor)
            friend.blood = 1

            const decision = getDecisionPoint(turn.gameState, turn.player)
            if (!decision) {
                throw new ScenarioFailure('No decision point')
            }
            const rescues = optionsOfType(decision.options, 'declareAction').filter(
                option =>
                    option.action.type == MinionActionType.RescueFromTorpor &&
                    option.action.target == friend,
            )
            // 2 blood to pay, the friend has 1: 2+0 or 1+1
            expectEqual(rescues.length, 2, 'rescue options on the vampire of the other')
            const split = rescues.find(
                option =>
                    option.action.type == MinionActionType.RescueFromTorpor &&
                    option.action.bloodPaidByActingMinion == LEAVE_TORPOR_COST,
            )
            if (!split) {
                throw new ScenarioFailure('The rescue paid by the rescuer alone is not offered')
            }
            applyOption(decision, split)
            const agent = new GovernAgent()
            for (let i = 0; i < 20 && turn.gameState.action; i++) {
                const player = getDecidingPlayer(turn.gameState)
                if (!player) {
                    throw new ScenarioFailure('Nobody has the impulse during the action')
                }
                stepBot(player, agent)
            }
            expectEqual(turn.gameState.action, null, 'action in progress')
            expectRegion(friend, 'ready')
            expectEqual(friend.controller == other, true, 'it is still the vampire of the other')
            expectEqual(friend.blood, 1, 'the rescuer paid')
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
    // Until the action is over, or a block is resolved ( the combat of the block is not played )
    for (let i = 0; i < 20 && turn.gameState.action && !turn.gameState.action.blockResolved; i++) {
        const player = getDecidingPlayer(turn.gameState)
        if (!player) {
            throw new ScenarioFailure('Nobody has the impulse during the action')
        }
        stepBot(player, agent)
    }
    expectEqual(
        !turn.gameState.action || !!turn.gameState.action.blockResolved,
        true,
        'action in progress',
    )
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

const ALASTOR_ID = '100038'
const ANARCHIST_UPRISING_ID = '100059'

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
    {
        name: 'a minion bleeds once a turn, even if it unlocks; another minion can, and the next turn it can again',
        run() {
            const turn = createMinionPhase(5, 0)
            const { gameState, player, ready } = turn
            const other = readyVampire(gameState, player, 5)
            const prey = player.prey
            if (!prey) {
                throw new ScenarioFailure('No prey')
            }
            must(
                gameMutations.ACTION_declareAction.act(player, {
                    minionAction: createBleedAction(ready, prey),
                }),
                'first bleed',
            )
            gameState.action = null
            ready.unlock()
            mustRefuse(
                canDeclare(createBleedAction(ready, prey)),
                'second bleed of the same minion',
            )
            must(canDeclare(createHuntAction(ready)), 'it can hunt')
            must(canDeclare(createBleedAction(other, prey)), 'another minion can bleed')

            gameState.setNewTurnResources()
            must(canDeclare(createBleedAction(ready, prey)), 'next turn')
        },
    },
    {
        name: 'a minion can hunt again after it unlocks, and a bleed it takes back is not counted',
        run() {
            const turn = createMinionPhase(5, 0)
            const { gameState, player, ready } = turn
            const prey = player.prey
            if (!prey) {
                throw new ScenarioFailure('No prey')
            }
            must(
                gameMutations.ACTION_declareAction.act(player, {
                    minionAction: createHuntAction(ready),
                }),
                'hunt',
            )
            gameState.action = null
            ready.unlock()
            must(canDeclare(createHuntAction(ready)), 'a second hunt')

            const bleed = createBleedAction(ready, prey)
            must(gameMutations.ACTION_declareAction.act(player, { minionAction: bleed }), 'bleed')
            mustRefuse(canDeclare(createBleedAction(ready, prey)), 'a locked minion, a bleed done')
            must(
                gameMutations.ACTION_declareActionInverse.act(player, { minionAction: bleed }),
                'the bleed is cancelled',
            )
            must(canDeclare(createBleedAction(ready, prey)), 'a cancelled bleed does not count')
        },
    },
    {
        name: 'a minion plays an action card of the same name once a turn, and one political action, even if it unlocks',
        run() {
            const turn = createMinionPhase(5, 0, {
                ...GovernDeck,
                [ALASTOR_ID]: 2,
                [ANARCHIST_UPRISING_ID]: 1,
            })
            const { gameState, player, ready } = turn
            player.permId = 'human'
            const [first, second] = [ALASTOR_ID, ALASTOR_ID].map(id =>
                giveCard(gameState, player, id),
            )
            const uprising = giveCard(gameState, player, ANARCHIST_UPRISING_ID)
            const action = (card: LibraryCard) => createActionCardAction(ready, card, {})
            must(
                gameMutations.ACTION_declareAction.act(player, { minionAction: action(first) }),
                'the first Alastor',
            )
            gameState.action = null
            ready.unlock()
            mustRefuse(canDeclare(action(second)), 'a second Alastor')
            mustRefuse(canDeclare(action(uprising)), 'a second political action')
            must(canDeclare(createHuntAction(ready)), 'not an action card')

            gameState.setNewTurnResources()
            must(canDeclare(action(second)), 'the next turn')
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
                botMutations.COMBAT_chooseStrike.act(fight.actingPlayer, {
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
                botMutations.COMBAT_chooseStrike.act(fight.actingPlayer, {
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
                botMutations.COMBAT_chooseStrike.act(fight.actingPlayer, {
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
            applyPendingCleanup(fight.gameState, fight.defendingPlayer)
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
                botMutations.COMBAT_chooseStrike.act(fight.actingPlayer, {
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
                botMutations.COMBAT_applyDamage.act(fight.actingPlayer, { minion: fight.acting }),
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
                botMutations.COMBAT_applyDamage.act(fight.defendingPlayer, {
                    minion: fight.defending,
                }),
                'apply damage',
            )
            expectEqual(fight.defending.blood, 0, 'defending blood')
            expectRegion(fight.defending, 'torpor')
            mustRefuse(
                botMutations.COMBAT_applyDamage.act(fight.defendingPlayer, {
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

// Once an action or a combat is over, the bot holding its cards has a forced cleanup decision, which
// comes first even when that bot is not the active player
function applyPendingCleanup(gameState: GameState, expected: Player): void {
    const decider = getDecidingPlayer(gameState)
    expectEqual(decider, expected, 'the bot that cleans up')
    const cleanup = decider && getDecisionPoint(gameState, decider)
    if (cleanup?.kind != DecisionKind.Cleanup) {
        throw new ScenarioFailure(`Expected a cleanup, got ${cleanup?.kind}`)
    }
    applyOption(cleanup, cleanup.options[0])
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
            applyPendingCleanup(gameState, bled)
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
            must(botMutations.ACTION_changeTarget.act(third, { target: bled }), 'back to the bled')
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
                botMutations.ACTION_changeTarget.act(bled, { target: bleeder }),
                'to the bleeder',
            )
            mustRefuse(
                botMutations.ACTION_changeTarget.act(bled, { target: bled }),
                'to the same target',
            )
            must(botMutations.ACTION_changeTarget.act(bled, { target: third }), 'to a third player')
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
            applyPendingCleanup(gameState, bled)
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
function createMasterPhase(deck: DeckList = GovernDeck): MasterTurn {
    const { gameState, players } = createHeadlessGame([deck, deck])
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

// The master phase of a player with Asylum Hunting Ground ( or another card ) as their only card in hand
function createAsylumTurn(
    cardId = ASYLUM_HUNTING_GROUND_ID,
    deck: DeckList = GovernDeck,
): AsylumTurn {
    const { gameState, player } = createMasterPhase(deck)
    emptyHand(gameState, player)
    const asylum = giveCard(gameState, player, cardId)
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
const SLUM_HUNTING_GROUND_ID = '101808'

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
            mustRefuse(botMutations.spendMasterPhaseAction.act(player, { player }), 'spend (none)')
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
                botMutations.markCardUsed.act(player, { player, card: asylum }),
                'used twice',
            )

            gameState.setNewTurnResources()
            gameState.turnResources.unlocked = true
            expectEqual(countUnlockEffects(turn), 2, 'available again the next turn')
        },
    },
    {
        name: 'Slum Hunting Ground requires a ready Nosferatu, costs 2 pool and gives 1 blood once per turn in the unlock phase',
        run() {
            const turn = createAsylumTurn(SLUM_HUNTING_GROUND_ID, {
                ...GovernDeck,
                [SLUM_HUNTING_GROUND_ID]: 2,
            })
            const { gameState, player, asylum: slum } = turn
            expectEqual(countMasterOptions(turn), 0, 'no ready vampire')

            gameState.moveCardToRegion(getVampireOfClan(player, 'Malkavian'), player.ready)
            expectEqual(countMasterOptions(turn), 0, 'a ready Malkavian')

            const nosferatu = getVampireOfClan(player, 'Nosferatu')
            gameState.moveCardToRegion(nosferatu, player.torpor)
            expectEqual(countMasterOptions(turn), 0, 'a Nosferatu in torpor')
            gameState.moveCardToRegion(nosferatu, player.ready)
            expectEqual(countMasterOptions(turn), 1, 'a ready Nosferatu')

            const pool = player.pool
            const decision = getMasterDecision(turn)
            applyOption(decision, findOption(decision.options, 'playMaster'))
            expectEqual(player.pool, pool - 2, 'pool')
            expectEqual(slum.isIn.ready, true, 'in play')

            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Unlock)
            nosferatu.blood = 2
            nosferatu.minionAttrs.capacity = 4
            const feed = getMasterDecision(turn)
            const option = optionsOfType(feed.options, 'unlockEffect').find(
                candidate => candidate.vampire == nosferatu,
            )
            if (!option) {
                throw new ScenarioFailure('No unlock effect on the Nosferatu')
            }
            applyOption(feed, option)
            expectEqual(nosferatu.blood, 3, 'blood gained')
            expectEqual(countUnlockEffects(turn), 0, 'once per turn')
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

const MINION_TAP_DECK = <DeckList>{ ...MalkavDeck, [MINION_TAP_ID]: 4 }
const VILLEIN_DECK = <DeckList>{ ...MINION_TAP_DECK, [VILLEIN_ID]: 4 }

// The master phase of a player holding Life in the City ( or another master card ), with two ready vampires
function createLifeInTheCityTurn(
    bloods: number[],
    cardId = LIFE_IN_THE_CITY_ID,
    deck: DeckList = MINION_TAP_DECK,
) {
    const { gameState } = createHeadlessGame([deck, deck])
    createdGames.push(gameState)
    const player = gameState.activePlayer
    if (!player) {
        throw new ScenarioFailure('No active player')
    }
    emptyHand(gameState, player)
    const card = giveCard(gameState, player, cardId)
    const vampires = bloods.map(blood => readyVampire(gameState, player, blood))
    gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Master)
    gameState.turnResources.unlocked = true
    const decision = getDecisionPoint(gameState, player)
    if (!decision) {
        throw new ScenarioFailure('No decision point')
    }
    return { gameState, player, card, vampires, decision }
}

// The master phase of a player holding the two Life in the City ( trifles ) and a Minion Tap ( not
// one ) of the Malkav deck, with two ready vampires that hold blood and can gain some
function createTrifleTurn() {
    const { gameState } = createHeadlessGame([MINION_TAP_DECK, MINION_TAP_DECK])
    createdGames.push(gameState)
    const player = gameState.activePlayer
    if (!player) {
        throw new ScenarioFailure('No active player')
    }
    emptyHand(gameState, player)
    const trifles = player.library.cards.filter(
        (card): card is LibraryCard =>
            card instanceof LibraryCard && card.krcgId == LIFE_IN_THE_CITY_ID,
    )
    const [first, second] = trifles
    if (!first || !second) {
        throw new ScenarioFailure('Two Life in the City are needed')
    }
    const tap = findCard(player, MINION_TAP_ID)
    for (const card of [first, second, tap]) {
        gameState.moveCardToRegion(card, player.hand)
        givenCards.add(card)
    }
    const vampires = [1, 1].map(blood => readyVampire(gameState, player, blood))
    gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Master)
    gameState.turnResources.unlocked = true
    return { gameState, player, library: first, trifles: [first, second], tap, vampires }
}

// Plays the card through the master phase decision, then its cleanup when it does not stay in play
function playMasterCard(turn: MasterTurn, card: LibraryCard): void {
    const decision = getMasterDecision(turn)
    const play = optionsOfType(decision.options, 'playMaster').find(option => option.card == card)
    if (!play) {
        throw new ScenarioFailure(`${card.name} is not offered`)
    }
    applyOption(decision, play)
    const next = getMasterDecision(turn)
    if (next.kind == DecisionKind.Cleanup) {
        applyOption(next, findOption(next.options, 'cleanup'))
    }
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

// Rulebook: stealth is only added when a block attempt stands that would succeed, intercept when it
// would fail. The prey's vampire attempts the block, then the scenario settles which one it is
// ( the stealth and intercept of the action are set, whatever the vampires have ).
function attemptBlock(
    game: { gameState: GameState; bled: Player; blocker: Vampire },
    wouldSucceed: boolean,
): void {
    const { gameState, bled, blocker } = game
    const first = passUntilDecides(gameState, bled)
    applyOption(
        first,
        optionsOfType(first.options, 'block').find(option => option.minion == blocker) ??
            findOption(first.options, 'block'),
    )
    const action = gameState.action
    if (!action) {
        throw new ScenarioFailure('The block attempt closed the action')
    }
    if (wouldSucceed) {
        action.intercept = Math.max(action.intercept, action.stealth)
    } else {
        action.stealth = action.intercept + 1
    }
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
            attemptBlock(game, true)
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
            attemptBlock(game, true)
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
            attemptBlock(game, true)
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
        name: 'Stealth and intercept are only added when needed (rulebook): stealth while the block would succeed, intercept while it would fail',
        run() {
            const setup = () =>
                createCatalogBleed({
                    discipline: Discipline.Obfuscate,
                    level: DisciplineLevel.INFERIOR,
                    cards: [LOST_IN_CROWDS_ID],
                    preyCards: [TELEPATHIC_ID],
                    preyDiscipline: [Discipline.Auspex, DisciplineLevel.INFERIOR],
                })
            const stealthOffered = (game: ReturnType<typeof setup>) => {
                const decision = getDecisionPoint(game.gameState, game.bleeder)
                return decision ? modifierOptionsOf(decision, LOST_IN_CROWDS_ID).length : -1
            }
            const interceptOffered = (game: ReturnType<typeof setup>) => {
                const decision = getDecisionPoint(game.gameState, game.bled)
                return decision ? optionsOfType(decision.options, 'playReaction').length : -1
            }

            // No block attempt stands: neither is needed
            const none = setup()
            expectEqual(stealthOffered(none), 0, 'stealth before any block attempt')

            // The block attempt would fail: intercept is needed, stealth is not
            const failing = setup()
            attemptBlock(failing, false)
            expectEqual(stealthOffered(failing), 0, 'stealth while the block fails')
            decideWith(failing.gameState, failing.bleeder, 'noModifier')
            expectEqual(interceptOffered(failing), 1, 'intercept while the block fails')

            // The block attempt would succeed: stealth is needed, intercept is not
            const succeeding = setup()
            attemptBlock(succeeding, true)
            expectEqual(stealthOffered(succeeding) > 0, true, 'stealth while the block succeeds')
            decideWith(succeeding.gameState, succeeding.bleeder, 'noModifier')
            expectEqual(interceptOffered(succeeding), 0, 'intercept while the block succeeds')
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
            expectEqual(
                turn.gameState.turnResources.mpa,
                1,
                'master phase action: a trifle gives it back',
            )
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
        name: 'Trifle: a master card is one when its first line says so, "Master: unique trifle." included',
        run() {
            const deck = <DeckList>{ ...MINION_TAP_DECK, '102113': 1, '100691': 1 }
            const { gameState } = createHeadlessGame([deck, deck])
            createdGames.push(gameState)
            const player = gameState.activePlayer
            if (!player) {
                throw new ScenarioFailure('No active player')
            }
            const isTrifle = (krcgId: string) => findHeldCard(player, krcgId).isTrifle
            expectEqual(isTrifle(LIFE_IN_THE_CITY_ID), true, 'Life in the City ( Trifle. )')
            expectEqual(isTrifle(WIDER_VIEW_ID), true, 'Wider View')
            expectEqual(isTrifle('102113'), true, 'Vessel')
            expectEqual(isTrifle('100691'), true, 'Failsafe ( Master: unique trifle. )')
            expectEqual(isTrifle(ELDER_LIBRARY_ID), false, 'Elder Library')
            expectEqual(isTrifle(MINION_TAP_ID), false, 'Minion Tap')
            expectEqual(isTrifle('100199'), false, 'Blood Doll')
        },
    },
    {
        name: 'Trifle: the first one gives its master phase action back, a second one is a regular master card',
        run() {
            const turn = createTrifleTurn()
            const { gameState, trifles } = turn
            const [first, second] = trifles
            expectEqual(gameState.turnResources.mpa, 1, 'master phase action before')

            playMasterCard(turn, first)
            expectEqual(
                gameState.turnResources.mpa,
                1,
                'master phase action after the first trifle',
            )
            expectEqual(gameState.turnResources.trifleGained, true, 'the extra action is taken')
            expectEqual(countMasterOptions(turn) > 0, true, 'a master card can still be played')

            playMasterCard(turn, second)
            expectEqual(gameState.turnResources.mpa, 0, 'a second trifle uses the action')
            expectEqual(countMasterOptions(turn), 0, 'no master card is offered any more')
        },
    },
    {
        name: 'Trifle: played after a regular master card, it needs an action that is no longer there',
        run() {
            const turn = createTrifleTurn()
            const { gameState, tap } = turn
            playMasterCard(turn, tap)
            expectEqual(gameState.turnResources.mpa, 0, 'master phase action')
            expectEqual(gameState.turnResources.trifleGained, false, 'no trifle played')
            expectEqual(countMasterOptions(turn), 0, 'the trifles are not offered')
        },
    },
    {
        name: 'Trifle: a regular master card follows the first trifle, then nothing more',
        run() {
            const turn = createTrifleTurn()
            const { gameState, tap, trifles } = turn
            playMasterCard(turn, trifles[0])
            playMasterCard(turn, tap)
            expectEqual(gameState.turnResources.mpa, 0, 'master phase action')
            expectEqual(countMasterOptions(turn), 0, 'no master card is offered any more')
        },
    },
    {
        name: 'Trifle: the extra action is once per master phase, refused twice and given back on the next turn',
        run() {
            const turn = createTrifleTurn()
            const { gameState, player } = turn
            playMasterCard(turn, turn.trifles[0])
            mustRefuse(
                botMutations.spendMasterPhaseAction.act(player, { player, trifle: true }),
                'second extra action',
            )
            gameState.setNewTurnResources()
            expectEqual(gameState.turnResources.trifleGained, false, 'next turn')
            expectEqual(gameState.turnResources.mpa, 1, 'master phase action next turn')
        },
    },
    {
        name: 'Minion Tap is offered per vampire with blood and per amount, torpor included, and moves the chosen amount to the pool',
        run() {
            const turn = createLifeInTheCityTurn([3, 0], MINION_TAP_ID)
            const [full, empty] = turn.vampires
            const [late] = [readyVampire(turn.gameState, turn.player, 2)]
            turn.gameState.moveCardToRegion(late, turn.player.torpor)
            const offered = () => {
                const decision = getDecisionPoint(turn.gameState, turn.player)
                if (!decision) {
                    throw new ScenarioFailure('No decision point')
                }
                return { decision, options: optionsOfType(decision.options, 'playMaster') }
            }
            const { decision, options } = offered()
            expectEqual(
                options
                    .map(
                        option =>
                            `${option.target?.oid == full.oid ? 'full' : 'late'}${option.amount}`,
                    )
                    .join(),
                'full1,full2,full3,late1,late2',
                'one option per amount, none for the empty vampire, one for the one in torpor',
            )
            expectEqual(
                options.some(option => option.target == empty),
                false,
                'the empty vampire is not a target',
            )
            const pool = turn.player.pool
            const two = options.find(option => option.target == full && option.amount == 2)
            if (!two) {
                throw new ScenarioFailure('No option for 2')
            }
            applyOption(decision, two)
            expectEqual(full.blood, 1, 'the vampire lost the blood')
            expectEqual(turn.player.pool, pool + 2, 'the pool gained it')
            expectEqual(turn.gameState.turnResources.mpa, 0, 'master phase action')
            expectEqual(turn.card.isIn.hand, false, 'the card is played')
        },
    },
    {
        name: 'Minion Tap is not offered when no vampire has blood, and moves only blood the vampire holds',
        run() {
            const turn = createLifeInTheCityTurn([0, 0], MINION_TAP_ID)
            const decision = getDecisionPoint(turn.gameState, turn.player)
            if (!decision) {
                throw new ScenarioFailure('No decision point')
            }
            expectEqual(optionsOfType(decision.options, 'playMaster').length, 0, 'options')

            const [vampire] = turn.vampires
            vampire.blood = 2
            const implementation = getMasterImplementation(turn.card, turn.player)
            if (!implementation) {
                throw new ScenarioFailure('No implementation')
            }
            expectEqual(implementation.applyPlayEffect(vampire, 3).isValid, false, 'too much')
            expectEqual(implementation.applyPlayEffect(vampire, 0).isValid, false, 'nothing')
            expectEqual(implementation.applyPlayEffect(vampire).isValid, false, 'no amount')
            expectEqual(vampire.blood, 2, 'nothing moved')
        },
    },
    {
        name: 'Villein is offered per vampire with blood and per amount ( 2 to 5, less for a vampire that holds less ), torpor included, and is put on the vampire it drains',
        run() {
            const turn = createLifeInTheCityTurn([6, 1, 0], VILLEIN_ID, VILLEIN_DECK)
            const [full, one, empty] = turn.vampires
            const late = readyVampire(turn.gameState, turn.player, 3)
            turn.gameState.moveCardToRegion(late, turn.player.torpor)
            const name = (vampire: Minion | undefined) =>
                [
                    [full, 'full'],
                    [one, 'one'],
                    [late, 'late'],
                ].find(([candidate]) => candidate == vampire)?.[1]
            const decision = getDecisionPoint(turn.gameState, turn.player)
            if (!decision) {
                throw new ScenarioFailure('No decision point')
            }
            const options = optionsOfType(decision.options, 'playMaster')
            expectEqual(
                options
                    .map(option => `${name(option.target)}${option.amount}`)
                    .toSorted()
                    .join(),
                'full2,full3,full4,full5,late2,late3,one1',
                'one option per amount, none for the empty vampire',
            )
            expectEqual(
                options.some(option => option.target == empty),
                false,
                'the empty vampire is not a target',
            )
            const pool = turn.player.pool
            const four = options.find(option => option.target == full && option.amount == 4)
            if (!four) {
                throw new ScenarioFailure('No option for 4')
            }
            applyOption(decision, four)
            expectEqual(full.blood, 2, 'the vampire lost the blood')
            expectEqual(turn.player.pool, pool + 4, 'the pool gained it')
            expectEqual(turn.card.isIn.hand, false, 'the card is played')
            expectEqual(
                getAttachedCards(full).includes(turn.card),
                true,
                'the card stays on the vampire',
            )
        },
    },
    {
        name: 'Villein costs 1 pool for each Villein already on the vampire, and so does a Minion Tap played on it',
        run() {
            const [tapped, plain] = [0, 1]
            const play = (pool: number, onFirst: number, cardId: string, which: number) => {
                const turn = createLifeInTheCityTurn([6, 6], VILLEIN_ID, VILLEIN_DECK)
                const { gameState, player } = turn
                const tap = giveCard(gameState, player, MINION_TAP_ID)
                const others = [...player.library.cards, ...player.hand.cards].filter(
                    (card): card is LibraryCard =>
                        card instanceof LibraryCard &&
                        card.krcgId == VILLEIN_ID &&
                        card != turn.card,
                )
                for (const villein of others.slice(0, onFirst)) {
                    attachInPlay(villein, turn.vampires[tapped])
                }
                player.pool = pool
                const decision = getDecisionPoint(gameState, player)
                if (!decision) {
                    throw new ScenarioFailure('No decision point')
                }
                const card = cardId == VILLEIN_ID ? turn.card : tap
                const option = optionsOfType(decision.options, 'playMaster').find(
                    candidate =>
                        candidate.card == card &&
                        candidate.target == turn.vampires[which] &&
                        candidate.amount == 3,
                )
                if (option) {
                    applyOption(decision, option)
                }
                return { offered: !!option, pool: player.pool, turn }
            }

            expectEqual(play(10, 0, VILLEIN_ID, tapped).pool, 13, 'a first Villein is free')
            const second = play(10, 1, VILLEIN_ID, tapped)
            expectEqual(second.pool, 12, 'the second one costs 1')
            expectEqual(
                getAttachedCards(second.turn.vampires[tapped]).length,
                2,
                'and is put on the vampire',
            )
            expectEqual(play(10, 2, VILLEIN_ID, tapped).pool, 11, 'the third one costs 2')
            expectEqual(play(10, 1, VILLEIN_ID, plain).pool, 13, 'a Villein on the other is free')
            expectEqual(play(10, 0, MINION_TAP_ID, tapped).pool, 13, 'a Minion Tap is free')
            expectEqual(
                play(10, 1, MINION_TAP_ID, tapped).pool,
                12,
                'with a Villein on it it costs 1',
            )
            expectEqual(play(10, 2, MINION_TAP_ID, tapped).pool, 11, 'and 2 with two')
            expectEqual(play(10, 2, MINION_TAP_ID, plain).pool, 13, 'but not on another vampire')

            // The cost is paid with the pool, down to what it leaves: the card gives pool at the same time
            const edge = play(1, 1, VILLEIN_ID, tapped)
            expectEqual(edge.offered, true, 'one pool pays the 1 of a second Villein')
            expectEqual(edge.pool, 3, 'and the 3 gained come with it')
            expectEqual(
                play(1, 2, VILLEIN_ID, tapped).offered,
                false,
                'a third Villein cannot be played with 1 pool',
            )
            expectEqual(play(2, 2, VILLEIN_ID, tapped).pool, 3, 'with 2 pool it can')
            expectEqual(
                play(1, 2, VILLEIN_ID, plain).offered,
                true,
                'on another vampire it is free',
            )
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
                const { gameState, bleeder, blocker } = game
                blocker.minionAttrs.intercept = 0
                // The block attempt is as good as the stealth: one more stealth makes it fail
                attemptBlock(game, true)
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
            attemptBlock(game, true)
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
            attemptBlock(game, true)
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

            attemptBlock(game, false)
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
            const { gameState, bleeder, bled } = inferior
            const first = passUntilDecides(gameState, bled)
            expectEqual(optionsOfType(first.options, 'playReaction').length, 0, 'before the block')
            attemptBlock(inferior, false)
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

const WARRENS_ID = '102216'

// A bleed against a prey whose vampire is a Nosferatu, titled or not, holding The Warrens
function createWarrens(titled: boolean, clan: string) {
    const game = createCatalogBleed({
        deck: { ...MalkavDeck, [WARRENS_ID]: 4 },
        discipline: Discipline.Dominate,
        level: DisciplineLevel.INFERIOR,
        cards: [],
        preyCards: [WARRENS_ID],
    })
    game.blocker.vampireAttrs.clan = clan
    game.blocker.vampireAttrs.title = titled ? 'Prince' : ''
    return game
}

const WARRENS_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'The Warrens adds 2 intercept, 3 for a titled Nosferatu, and needs a Nosferatu',
        run() {
            for (const [titled, expected] of [
                [false, 2],
                [true, 3],
            ] as const) {
                const game = createWarrens(titled, 'Nosferatu')
                const before = passUntilDecides(game.gameState, game.bled)
                expectEqual(
                    optionsOfType(before.options, 'playReaction').length,
                    0,
                    'no block attempt stands yet',
                )
                attemptBlock(game, false)
                decideWith(game.gameState, game.bleeder, 'noModifier')
                const decision = getDecisionPoint(game.gameState, game.bled)
                const reactions = decision ? optionsOfType(decision.options, 'playReaction') : []
                if (!decision) {
                    throw new ScenarioFailure('The prey has no decision')
                }
                expectEqual(reactions.length, 1, 'offered')
                const intercept = game.gameState.action?.intercept ?? 0
                applyOption(decision, reactions[0])
                expectEqual(game.gameState.action?.intercept, intercept + expected, 'intercept')
            }

            const other = createWarrens(false, 'Malkavian')
            attemptBlock(other, false)
            decideWith(other.gameState, other.bleeder, 'noModifier')
            const next = getDecisionPoint(other.gameState, other.bled)
            expectEqual(
                next ? optionsOfType(next.options, 'playReaction').length : -1,
                0,
                'not a Nosferatu',
            )
        },
    },
]

const GUARD_DOGS_ID = '100863'
const INSTINCTIVE_REACTION_ID = '100995'

// The players pass until a combat starts ( a block with enough intercept was resolved )
function passUntilCombat(gameState: GameState) {
    for (let i = 0; i < 8 && !gameState.combat; i++) {
        const decider = getDecidingPlayer(gameState)
        const decision = decider && getDecisionPoint(gameState, decider)
        const pass = decision?.options.find(option =>
            ['noReaction', 'noModifier'].includes(option.type),
        )
        if (!decision || !pass) {
            break
        }
        applyOption(decision, pass)
    }
    return gameState.combat
}

// The prey holds the card, its vampire blocks with the card played at the level ( or not ), and
// the block is enough to succeed
function blockWithReaction(
    cardId: string,
    level: DisciplineLevel,
    options: { locked?: boolean; copies?: number; extra?: string[] } = {},
) {
    const extra = options.extra ?? []
    const game = createCatalogBleed({
        deck: { ...MalkavDeck, [cardId]: 4, ...Object.fromEntries(extra.map(id => [id, 4])) },
        discipline: Discipline.Dominate,
        level: DisciplineLevel.INFERIOR,
        cards: [],
        preyCards: [...Array.from({ length: options.copies ?? 1 }, () => cardId), ...extra],
        preyDiscipline: [Discipline.Animalism, level],
    })
    if (options.locked) {
        game.blocker.lock()
    }
    return game
}

const reactionOptions = (decision: DecisionPoint) => optionsOfType(decision.options, 'playReaction')

const ANIMALISM_REACTION_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'Guard Dogs unlocks a locked vampire, and gives a maneuver in the block combat at superior',
        run() {
            for (const [level, maneuver] of [
                [DisciplineLevel.INFERIOR, false],
                [DisciplineLevel.SUPERIOR, true],
            ] as const) {
                const game = blockWithReaction(GUARD_DOGS_ID, level, { locked: true })
                const { gameState, bleeder, bled, blocker } = game
                const decision = passUntilDecides(gameState, bled)
                expectEqual(optionsOfType(decision.options, 'block').length, 0, 'locked')
                const unlocks = reactionOptions(decision).filter(
                    option =>
                        option.effect.type == 'unlock' &&
                        option.minion == blocker &&
                        !!option.effect.blockManeuver == maneuver,
                )
                expectEqual(unlocks.length, 1, 'offered')
                expectEqual(!!unlocks[0].effect.blockManeuver, maneuver, `maneuver at ${level}`)
                applyOption(decision, unlocks[0])
                expectEqual(blocker.isLocked, false, 'unlocked')

                const next = passUntilDecides(gameState, bled)
                applyOption(
                    next,
                    optionsOfType(next.options, 'block').find(o => o.minion == blocker) ??
                        findOption(next.options, 'block'),
                )
                if (gameState.action) {
                    gameState.action.stealth = 0
                }
                decideWith(gameState, bleeder, 'noModifier')
                const combat = passUntilCombat(gameState)
                expectEqual(combat?.defending.freeManeuvers, maneuver ? 1 : 0, 'free maneuvers')
            }
        },
    },
    {
        name: 'Guard Dogs is for a locked vampire, during a bleed against you',
        run() {
            const unlocked = blockWithReaction(GUARD_DOGS_ID, DisciplineLevel.INFERIOR)
            expectEqual(
                reactionOptions(passUntilDecides(unlocked.gameState, unlocked.bled)).length,
                0,
                'an unlocked vampire',
            )
            const hunt = createCatalogBleed({
                deck: { ...MalkavDeck, [GUARD_DOGS_ID]: 4 },
                discipline: Discipline.Dominate,
                level: DisciplineLevel.INFERIOR,
                cards: [],
                actionType: MinionActionType.Hunt,
                preyCards: [GUARD_DOGS_ID],
                preyDiscipline: [Discipline.Animalism, DisciplineLevel.INFERIOR],
            })
            hunt.blocker.lock()
            const decision = passUntilDecides(hunt.gameState, hunt.bled)
            expectEqual(reactionOptions(decision).length, 0, 'not a bleed')
        },
    },
    {
        name: 'Instinctive Reaction adds 1 intercept once your predator acts and a block stands, with a maneuver at superior',
        run() {
            for (const [level, maneuver] of [
                [DisciplineLevel.INFERIOR, false],
                [DisciplineLevel.SUPERIOR, true],
            ] as const) {
                const game = blockWithReaction(INSTINCTIVE_REACTION_ID, level)
                const { gameState, bleeder, bled } = game
                const first = passUntilDecides(gameState, bled)
                expectEqual(reactionOptions(first).length, 0, 'before the block')
                attemptBlock(game, false)
                decideWith(gameState, bleeder, 'noModifier')
                const standing = getDecisionPoint(gameState, bled)
                const reactions = (standing ? reactionOptions(standing) : []).filter(
                    option => !!option.effect.blockManeuver == maneuver,
                )
                expectEqual(reactions.length, 1, 'offered')
                const before = gameState.action?.intercept ?? 0
                if (standing) {
                    applyOption(standing, reactions[0])
                }
                expectEqual(gameState.action?.intercept, before + 1, 'intercept')
                expectEqual(
                    gameState.action?.blockManeuvers.length,
                    maneuver ? 1 : 0,
                    'maneuver granted',
                )
                if (gameState.action) {
                    gameState.action.stealth = 0
                }
                const combat = passUntilCombat(gameState)
                expectEqual(combat?.defending.freeManeuvers, maneuver ? 1 : 0, 'free maneuvers')
            }
        },
    },
    {
        name: 'A free maneuver is offered to the blocker once, and moves the range',
        run() {
            const game = blockWithReaction(INSTINCTIVE_REACTION_ID, DisciplineLevel.SUPERIOR)
            const { gameState, bleeder, bled, blocker } = game
            attemptBlock(game, false)
            decideWith(gameState, bleeder, 'noModifier')
            const standing = getDecisionPoint(gameState, bled)
            const reaction = standing && reactionOptions(standing).find(o => o.effect.blockManeuver)
            if (!standing || !reaction) {
                throw new ScenarioFailure('The reaction is not offered')
            }
            applyOption(standing, reaction)
            if (gameState.action) {
                gameState.action.stealth = 0
            }
            const combat = passUntilCombat(gameState)
            if (!combat) {
                throw new ScenarioFailure('No combat')
            }
            const range = combat.range
            while (combat.step != CombatStep.DetermineRange || combat.impulsePlayer != bled) {
                must(botMutations.COMBAT_pass.act(combat.impulsePlayer, {}), 'pass')
            }
            must(
                botMutations.COMBAT_maneuver.act(bled, { minion: blocker, free: true }),
                'free maneuver',
            )
            expectEqual(combat.range == range, false, 'the range moved')
            expectEqual(combat.defending.freeManeuvers, 0, 'used')
            expectEqual(
                canManeuver(gameState, blocker, undefined, undefined, true).isValid,
                false,
                'no second one',
            )
        },
    },
]

/**
 * The post block window: Cats' Guidance, played by the blocker once the combat of its block is over
 */

const CATS_GUIDANCE_ID = '100308'

// The prey, a bot holding Cats' Guidance, blocks the bleed with its vampire: the combat starts
function createBlockCombat(level: DisciplineLevel, extra: string[] = []) {
    const game = blockWithReaction(CATS_GUIDANCE_ID, level, { extra })
    const { gameState, bleeder, bled, blocker } = game
    const first = passUntilDecides(gameState, bled)
    applyOption(
        first,
        optionsOfType(first.options, 'block').find(o => o.minion == blocker) ??
            findOption(first.options, 'block'),
    )
    if (gameState.action) {
        gameState.action.stealth = 0
    }
    decideWith(gameState, bleeder, 'noModifier')
    const combat = passUntilCombat(gameState)
    if (!combat) {
        throw new ScenarioFailure('No combat')
    }
    return { ...game, combat }
}

const endCombatByHand = (game: { gameState: GameState; bleeder: Player }) =>
    must(botMutations.COMBAT_end.act(game.bleeder, {}), 'end combat')

function getPostBlockDecision(game: { gameState: GameState; bled: Player }): DecisionPoint {
    expectEqual(getDecidingPlayer(game.gameState), game.bled, 'the blocker decides')
    const decision = getDecisionPoint(game.gameState, game.bled)
    if (!decision) {
        throw new ScenarioFailure('No decision in the post block window')
    }
    expectEqual(decision.kind, DecisionKind.PostBlock, 'decision kind')
    return decision
}

const CATS_GUIDANCE_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: "Cats' Guidance: the window opens after the combat of a block, the inferior version unlocks the blocker",
        run() {
            const game = createBlockCombat(DisciplineLevel.INFERIOR)
            const { gameState, bleeder, bled, blocker, combat } = game
            expectEqual(gameState.action?.blockResolved, blocker, 'the action is open, blocked')
            expectEqual(blocker.isLocked, true, 'locked by its block')
            expectEqual(getDecidingPlayer(gameState), combat.impulsePlayer, 'the combat decides')
            const during = getDecisionPoint(gameState, combat.impulsePlayer)
            expectEqual(
                (during?.options ?? []).some(option => option.type == 'playReaction'),
                false,
                'no reaction in the combat',
            )

            endCombatByHand(game)
            expectEqual(gameState.action?.blockResolved, blocker, 'the window is open')
            const decision = getPostBlockDecision(game)
            const reactions = reactionOptions(decision)
            expectEqual(reactions.length, 1, 'offered')
            expectEqual(reactions[0].effect.type, 'unlock', 'unlocks')
            expectEqual(
                decision.options.some(option => option.type == 'noReaction'),
                true,
                'it can pass',
            )

            applyOption(decision, reactions[0])
            expectEqual(blocker.isLocked, false, 'unlocked')
            expectEqual(getMinionIntercept(blocker), blocker.minionAttrs.intercept, 'intercept')

            // Nothing more to play: the player passes, and the turn goes on
            const next = getPostBlockDecision(game)
            expectEqual(next.options.length, 1, 'only passing is left')
            applyOption(next, findOption(next.options, 'noReaction'))
            expectEqual(gameState.action, null, 'the window is closed, the action is over')
            applyPendingCleanup(gameState, bled)
            expectEqual(reactions[0].card.region == bled.ashHeap, true, 'the card is discarded')
            expectEqual(getDecidingPlayer(gameState), bleeder, 'the active player goes on')
        },
    },
    {
        name: "Cats' Guidance: the versions are separate plays, and a minion plays the card once per action",
        run() {
            // Played during the block attempt: +1 intercept, and the unlock is no longer playable
            const game = blockWithReaction(CATS_GUIDANCE_ID, DisciplineLevel.SUPERIOR, {
                copies: 2,
            })
            const { gameState, bleeder, bled } = game
            attemptBlock(game, false)
            decideWith(gameState, bleeder, 'noModifier')
            const decision = getDecisionPoint(gameState, bled)
            const reactions = decision ? optionsOfType(decision.options, 'playReaction') : []
            expectEqual(reactions.length, 2, 'one play per copy: only the superior version fits')
            expectEqual(
                reactions.some(reaction => reaction.effect.type == 'unlock'),
                false,
                'no unlock during the block attempt',
            )
            const before = gameState.action?.intercept ?? 0
            if (decision) {
                applyOption(decision, reactions[0])
            }
            expectEqual(gameState.action?.intercept, before + 1, 'intercept')
            const again = getDecisionPoint(gameState, bled)
            expectEqual(
                again ? reactionOptions(again).length : 0,
                0,
                'not played twice in the same action',
            )

            passUntilCombat(gameState)
            endCombatByHand(game)
            const post = getPostBlockDecision(game)
            expectEqual(reactionOptions(post).length, 0, 'the unlock is not playable after it')
            expectEqual(post.options.length, 1, 'only passing is left')

            // Not played during the block attempt: the unlock is offered after it
            const other = createBlockCombat(DisciplineLevel.SUPERIOR)
            endCombatByHand(other)
            const postOther = reactionOptions(getPostBlockDecision(other))
            expectEqual(postOther.length, 1, 'the unlock is offered')
            expectEqual(postOther[0].effect.type, 'unlock', 'unlocks')
        },
    },
    {
        name: "Cats' Guidance: a blocked leave torpor starts no combat, the blocker is locked and the window opens",
        run() {
            const game = blockWithReaction(CATS_GUIDANCE_ID, DisciplineLevel.INFERIOR)
            const { gameState, bleeder, bled, blocker, bleeding } = game
            const first = passUntilDecides(gameState, bled)
            applyOption(
                first,
                optionsOfType(first.options, 'block').find(o => o.minion == blocker) ??
                    findOption(first.options, 'block'),
            )
            if (gameState.action) {
                gameState.action.stealth = 0
            }
            // The acting vampire is in torpor, as for a leave torpor action
            gameState.moveCardToRegion(bleeding, bleeder.torpor)
            decideWith(gameState, bleeder, 'noModifier')
            for (let i = 0; i < 8 && gameState.action && !gameState.action.blockResolved; i++) {
                const decider = getDecidingPlayer(gameState)
                const decision = decider && getDecisionPoint(gameState, decider)
                const pass = decision?.options.find(option =>
                    ['noReaction', 'noModifier'].includes(option.type),
                )
                if (!decision || !pass) {
                    break
                }
                applyOption(decision, pass)
            }
            expectEqual(gameState.combat, null, 'no combat')
            expectEqual(blocker.isLocked, true, 'the blocker is locked')
            expectEqual(gameState.action?.blockResolved, blocker, 'the window is open')
        },
    },
    {
        name: "Cats' Guidance: the window offers only what is made for it, not the reactions about the action",
        run() {
            const game = createBlockCombat(DisciplineLevel.INFERIOR, [GUARD_DOGS_ID])
            expectEqual(
                game.bled.hand.cards.some(card => card.krcgId == GUARD_DOGS_ID),
                true,
                'Guard Dogs in hand',
            )
            endCombatByHand(game)
            const reactions = reactionOptions(getPostBlockDecision(game))
            expectEqual(reactions.length, 1, 'one play only')
            expectEqual(reactions[0].card.krcgId, CATS_GUIDANCE_ID, 'Cats Guidance')
        },
    },
    {
        name: "Cats' Guidance is not offered as a reaction during the action",
        run() {
            const locked = blockWithReaction(CATS_GUIDANCE_ID, DisciplineLevel.INFERIOR, {
                locked: true,
            })
            expectEqual(
                reactionOptions(passUntilDecides(locked.gameState, locked.bled)).length,
                0,
                'during the action',
            )
        },
    },
    {
        name: "Cats' Guidance: no window when the blocker went to torpor, when the hand has no reaction, or when the combat is not from a block",
        run() {
            const torpor = createBlockCombat(DisciplineLevel.INFERIOR)
            torpor.gameState.moveCardToRegion(torpor.blocker, torpor.bled.torpor)
            endCombatByHand(torpor)
            expectEqual(torpor.gameState.action, null, 'in torpor: the action is over')

            const noCard = createBlockCombat(DisciplineLevel.INFERIOR)
            for (const card of [...noCard.bled.hand.cards]) {
                noCard.gameState.moveCardToRegion(card, noCard.bled.ashHeap)
            }
            endCombatByHand(noCard)
            expectEqual(noCard.gameState.action, null, 'no reaction card in hand')

            // An enter combat action is not a block
            const fight = createFight(3, 3, { ...MalkavDeck, [CATS_GUIDANCE_ID]: 4 })
            giveCard(fight.gameState, fight.defendingPlayer, CATS_GUIDANCE_ID)
            expectEqual(fight.gameState.action, null, 'no action stays open')
            must(botMutations.COMBAT_end.act(fight.actingPlayer, {}), 'end combat')
            expectEqual(fight.gameState.action, null, 'no window')
        },
    },
    {
        name: "Cats' Guidance: a bot plays it through the decision flow, and the combat played out ends the same way",
        run() {
            const game = createBlockCombat(DisciplineLevel.INFERIOR)
            const { gameState, blocker } = game
            const agent = new GovernAgent()
            let steps = 0
            while (gameState.combat && steps++ < 200) {
                const decider = getDecidingPlayer(gameState)
                if (!decider) {
                    throw new ScenarioFailure('Nobody decides in the combat')
                }
                stepBot(decider, agent)
            }
            expectEqual(gameState.combat, null, 'the combat is over')
            // The window opens only if the blocker is still ready
            if (blocker.isIn.ready) {
                expectEqual(gameState.action?.blockResolved, blocker, 'the window is open')
                stepBot(game.bled, agent)
                expectEqual(blocker.isLocked, false, 'the bot unlocked its blocker')
            } else {
                expectEqual(gameState.action, null, 'no window for a blocker in torpor')
            }
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
    deck = BrujahDeck,
): Fight & { card: LibraryCard } {
    const fight = createFight(actingBlood, 3, deck)
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
                botMutations.COMBAT_chooseStrike.act(fight.defendingPlayer, {
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
                botMutations.COMBAT_chooseStrike.act(fight.actingPlayer, {
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
                botMutations.COMBAT_chooseStrike.act(fight.defendingPlayer, {
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
            attemptBlock(game, false)
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
        names.push(
            event.type == 'actionResolved' && !event.successful ?
                'actionResolved(blocked)'
            :   event.type,
        )
    })
    return { names, stop }
}

// Everybody passes ( a standing block is kept ) until the action is over
// Until the action is over, or a block is resolved ( its combat, if any, is not played )
function passUntilActionOver(gameState: GameState): void {
    for (let i = 0; i < 12 && gameState.action && !gameState.action.blockResolved; i++) {
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
    expectEqual(!gameState.action || !!gameState.action.blockResolved, true, 'the action is over')
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

// The combat of a block is ended by hand, and the post block window of the blocker, if open, is passed
function endBlockCombat(game: { gameState: GameState; bleeder: Player; bled: Player }): void {
    must(botMutations.COMBAT_end.act(game.bleeder, {}), 'end combat')
    const window = game.gameState.action ? getDecisionPoint(game.gameState, game.bled) : null
    if (window) {
        applyOption(window, findOption(window.options, 'noReaction'))
    }
    expectEqual(game.gameState.action, null, 'the blocked action is over')
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
        name: 'Events: a block that succeeds starts a combat, and the action ends unsuccessful with it',
        run() {
            const game = createEventBleed(5)
            const watch = watchEvents()
            try {
                blockWithBlocker(game)
                passUntilActionOver(game.gameState)
                expectEqual(watch.names.length, 0, 'events during the combat')
                expectEqual(game.gameState.combat != null, true, 'combat')
                expectEqual(game.gameState.action?.blockResolved, game.blocker, 'block resolved')
                endBlockCombat(game)
            } finally {
                watch.stop()
            }
            expectEqual(watch.names.join(','), 'actionResolved(blocked)', 'events')
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
            // No block attempt stands: the stealth is not needed, the card is not offered
            const idle = getDecisionPoint(gameState, bleeder)
            expectEqual(
                idle ? modifierOptionsOf(idle, FACELESS_NIGHT_ID).length : -1,
                0,
                'not offered after the failed block',
            )

            // A second vampire attempts the block, which would succeed: the card flips it
            const second = readyVampire(gameState, game.bled, 3)
            attemptBlock({ gameState, bled: game.bled, blocker: second }, true)
            const decision = getDecisionPoint(gameState, bleeder)
            const played =
                decision &&
                modifierOptionsOf(decision, FACELESS_NIGHT_ID).find(
                    option => modifierLevel(option) == DisciplineLevel.SUPERIOR,
                )
            if (!decision || !played) {
                throw new ScenarioFailure('Faceless Night is not offered during the second attempt')
            }
            applyOption(decision, played)
            expectEqual(gameState.action?.armedTriggers.length, 1, 'armed trigger')
            passUntilActionOver(gameState)
            expectEqual(blocker.isLocked, false, 'the earlier block does not count')
            expectEqual(second.isLocked, true, 'the failed block of the card is locked')
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
            endBlockCombat(game)
            expectNoTrigger(game.gameState, 'an unsuccessful action')
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
                successful: true,
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
 * A human acts, the bots block
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
            must(botMutations.ACTION_completeDeclaration.act(table.human, {}), 'declare')
            expectEqual(table.gameState.action?.declared, true, 'declared')
            expectEqual(getDecidingPlayer(table.gameState), prey, 'the bot decides')
            expectEqual(stepBot(prey, new GovernAgent())?.option.type, 'block', 'the bot blocks')
            mustRefuse(
                botMutations.ACTION_completeDeclaration.act(table.human, {}),
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
            must(botMutations.ACTION_completeDeclaration.act(table.human, {}), 'declare')
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
            expectEqual(table.gameState.action?.blockResolved, table.blockers[0], 'block resolved')
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
            must(botMutations.ACTION_resolveAction.act(table.human, {}), 'resolve')
            expectEqual(table.gameState.action, null, 'the action is over')
            expectEqual(prey.pool, pool - table.acting.minionAttrs.bleed, 'the bleed went through')
        },
    },
    {
        name: 'the reaction card a bot played against a human action is put away once the human ends the action',
        run() {
            const bounce = createBounce(DisciplineLevel.SUPERIOR)
            const { gameState, bleeder, bled, third, deflection } = bounce
            if (!third) {
                throw new ScenarioFailure('No third player')
            }
            bleeder.permId = 'human'
            const decision = declineBlock(bounce)
            applyOption(decision, getBounceOption(decision, DisciplineLevel.SUPERIOR))
            decideWith(gameState, bleeder, 'noModifier')
            decideWith(gameState, third, 'noReaction')
            expectEqual(gameState.action !== null, true, 'the human ends the action')
            expectEqual(deflection.isIn.ready, true, 'Deflection stays while the action goes on')

            must(botMutations.ACTION_resolveAction.act(bleeder, {}), 'the human resolves')
            expectEqual(gameState.action, null, 'the action is over')
            applyPendingCleanup(gameState, bled)
            expectEqual(deflection.isIn.ashHeap, true, 'Deflection put away')
            expectEqual(getDecidingPlayer(gameState), bleeder, 'the turn goes on')
        },
    },
    {
        name: 'a human cannot resolve an action the engine does not know, nor over a standing block, nor outside bot games',
        run() {
            const table = createHumanTable(2)
            const [prey] = table.others
            humanDeclares(table, createBleedAction(table.acting, prey))
            stepBot(prey, new GovernAgent())
            mustRefuse(botMutations.ACTION_resolveAction.act(table.human, {}), 'a standing block')

            table.gameState.action = null
            table.gameState.gameType = GameType.Unset
            humanDeclares(table, createBleedAction(table.acting, prey))
            mustRefuse(botMutations.ACTION_resolveAction.act(table.human, {}), 'outside bot games')

            table.gameState.action = null
            table.gameState.gameType = GameType.TrainBot
            humanDeclares(table, {
                type: MinionActionType.Diablerize,
                actingMinion: table.acting,
                target: table.blockers[0],
            })
            mustRefuse(botMutations.ACTION_resolveAction.act(table.human, {}), 'a diablerie')
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
        botMutations.attachCard.act(player, { card, minion, disciplines: options.disciplines }),
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
                    botMutations.attachCard.act(turn.player, { card, minion: turn.ready }),
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
                botMutations.attachCard.act(player, { card: torpid, minion: ready }),
                'a minion',
            )
            mustRefuse(
                botMutations.attachCard.act(player, { card: ready, minion: ready }),
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
            must(botMutations.ACTION_resolveAction.act(table.human, {}), 'resolve')
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
                botMutations.COMBAT_maneuver.act(fight.actingPlayer, {
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
                botMutations.COMBAT_chooseStrike.act(fight.actingPlayer, {
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
const VESSEL_ID = '102113'

// The master phase of a player holding a Blood Doll as their only card, with ready vampires of the
// given blood and one vampire in torpor
function createDollTurn(bloods: number[], cardId = BLOOD_DOLL_ID) {
    const { gameState } = createHeadlessGame([AttachDeck, AttachDeck])
    createdGames.push(gameState)
    const player = gameState.activePlayer
    if (!player) {
        throw new ScenarioFailure('No active player')
    }
    emptyHand(gameState, player)
    const doll = giveCard(gameState, player, cardId)
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
const POTENCE_INFERIOR: DisciplineUse[] = [
    { discipline: Discipline.Potence, level: DisciplineLevel.INFERIOR },
]
const HEROIC_MIGHT_ID = '100913'

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
        name: 'Vessel costs 1 pool, is put on a vampire, and moves 1 blood once per turn in the unlock phase only',
        run() {
            const turn = createDollTurn([2], VESSEL_ID)
            const [vampire] = turn.vampires
            const { gameState, player, doll } = turn
            const pool = player.pool
            playDoll(turn, vampire)
            expectEqual(player.pool, pool - 1, 'pool')
            expectEqual(getHost(doll), vampire, 'host')
            expectEqual(moveBloodOptions(turn).length, 0, 'not in the master phase')

            gameState.setNewTurnResources()
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Unlock)
            expectEqual(moveBloodOptions(turn).length, 0, 'not before the unlock')
            gameState.turnResources.unlocked = true
            expectEqual(moveBloodOptions(turn).length, 2, 'both directions')

            applyMoveBlood(turn, true)
            expectEqual(vampire.blood, 1, 'blood of the vampire')
            expectEqual(player.pool, pool, 'pool')
            expectEqual(moveBloodOptions(turn).length, 0, 'once per turn')

            gameState.setNewTurnResources()
            gameState.turnResources.unlocked = true
            applyMoveBlood(turn, false)
            expectEqual(vampire.blood, 2, 'blood of the vampire')
            expectEqual(player.pool, pool - 1, 'pool')
        },
    },
    {
        name: 'Vessel works on a vampire in torpor, a Blood Doll does not move blood in the unlock phase',
        run() {
            const turn = createDollTurn([2], VESSEL_ID)
            const { gameState, player, doll } = turn
            attachInPlay(doll, turn.torpid)
            const bloodDoll = findCard(player, BLOOD_DOLL_ID)
            attachInPlay(bloodDoll, turn.vampires[0])
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Unlock)
            gameState.turnResources.unlocked = true
            const options = moveBloodOptions(turn)
            expectEqual(options.length > 0, true, 'usable in torpor')
            expectEqual(
                options.every(option => option.card == doll && option.vampire == turn.torpid),
                true,
                'only the Vessel',
            )
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
    {
        name: 'Heroic Might is offered to a vampire with Potence, at each level it has',
        run() {
            const options = (level: DisciplineLevel | null) => {
                const turn = createEquipTurn(HEROIC_MIGHT_ID)
                setPotence(turn.ready, level)
                return equipOptions(turn).mine
            }
            expectEqual(options(null).length, 0, 'no Potence')
            expectEqual(options(DisciplineLevel.INFERIOR).length, 1, 'inferior')
            expectEqual(options(DisciplineLevel.SUPERIOR).length, 2, 'superior')
        },
    },
    {
        name: 'Heroic Might: +3 stealth, costs 3 blood, +1 strength at inferior and +2 at superior',
        run() {
            const cases = [
                { level: DisciplineLevel.INFERIOR, strength: 1 },
                { level: DisciplineLevel.SUPERIOR, strength: 2 },
            ]
            for (const { level, strength } of cases) {
                const turn = createEquipTurn(HEROIC_MIGHT_ID)
                setPotence(turn.ready, level)
                const strengthBefore = getMinionStrength(turn.ready)
                const { decision, mine } = equipOptions(turn)
                const option = mine.find(candidate => levelOf(candidate) == level)
                if (!option) {
                    throw new ScenarioFailure(`No option at ${level}`)
                }
                applyOption(decision, option)
                expectEqual(turn.gameState.action?.stealth, 3, `stealth at ${level}`)
                resolveAction(turn)

                expectEqual(getHost(turn.card), turn.ready, `host at ${level}`)
                expectEqual(turn.ready.blood, 2, `blood after the 3 blood cost at ${level}`)
                expectEqual(
                    getMinionStrength(turn.ready),
                    strengthBefore + strength,
                    `strength at ${level}`,
                )
            }
        },
    },
    {
        name: 'Heroic Might: only a superior one gives a 2R strike, and a vampire has only one',
        run() {
            const strikeOf = (use: DisciplineUse[]) => {
                const fight = createFight(3, 3, AttachDeck)
                const might = findCard(fight.actingPlayer, HEROIC_MIGHT_ID)
                attachInPlay(might, fight.acting, { disciplines: use })
                passUntil(fight, CombatStep.Strike)
                const strikes = optionsOfType(
                    getCombatDecision(fight, fight.actingPlayer).options,
                    'combatStrike',
                )
                return strikes.filter(option => option.strike.source == might)
            }
            expectEqual(strikeOf(POTENCE_INFERIOR).length, 0, 'inferior')
            const superior = strikeOf(POTENCE_SUPERIOR)
            expectEqual(superior.length, 1, 'superior')
            expectEqual(superior[0].strike.damage, 2, 'damage')
            expectEqual(superior[0].strike.ranged, true, 'ranged')

            const turn = createEquipTurn(HEROIC_MIGHT_ID)
            setPotence(turn.ready, DisciplineLevel.INFERIOR)
            attachInPlay(turn.card, turn.ready, { disciplines: POTENCE_INFERIOR })
            const second = giveCard(turn.gameState, turn.player, HEROIC_MIGHT_ID)
            mustRefuse(
                canDeclare(
                    createActionCardAction(turn.ready, second, { disciplines: POTENCE_INFERIOR }),
                ),
                'a second copy',
            )
        },
    },
    {
        name: 'Heroic Might is burned when its vampire goes to torpor',
        run() {
            const fight = createFight(3, 1, AttachDeck)
            const might = findCard(fight.defendingPlayer, HEROIC_MIGHT_ID)
            attachInPlay(might, fight.defending, { disciplines: POTENCE_SUPERIOR })
            damageResolution(fight, fight.defending, 5, 0)
            passUntil(fight, CombatStep.EndOfRound)
            expectRegion(fight.defending, 'torpor')
            expectEqual(might.isIn.ashHeap, true, 'burned')
        },
    },
]

const GUARDIAN_ANGEL_ID = '100866'

// A fight where the defending vampire carries a Guardian Angel, in the damage resolution
function createAngelFight(regular: number, aggravated: number, defendingBlood = 3) {
    const fight = createFight(3, defendingBlood, AttachDeck)
    const angel = findAnyCard(fight.defendingPlayer, GUARDIAN_ANGEL_ID)
    attachInPlay(angel, fight.defending)
    damageResolution(fight, fight.defending, regular, aggravated)
    return { ...fight, angel }
}

const preventOptions = (decision: DecisionPoint) => optionsOfType(decision.options, 'combatPrevent')

const defenderDecision = (fight: Fight) => getCombatDecision(fight, fight.defendingPlayer)

const GUARDIAN_ANGEL_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'Guardian Angel costs 2 pool and is put on a ready vampire of the player, not on one in torpor',
        run() {
            const turn = createDollTurn([2, 3], GUARDIAN_ANGEL_ID)
            const targets = optionsOfType(getMasterDecision(turn).options, 'playMaster').map(
                option => option.target,
            )
            expectEqual(targets.length, 2, 'options')
            expectEqual(targets.includes(turn.torpid), false, 'not in torpor')
            const pool = turn.player.pool
            playDoll(turn, turn.vampires[1])
            expectEqual(getHost(turn.doll), turn.vampires[1], 'host')
            expectEqual(turn.player.pool, pool - 2, 'pool')
        },
    },
    {
        name: 'Guardian Angel gives +1 intercept against a bleed directed at its controller, not against another Methuselah nor a hunt',
        run() {
            const setup = {
                deck: AttachDeck,
                discipline: Discipline.Presence,
                level: DisciplineLevel.SUPERIOR,
                cards: [],
            }
            const bleed = createCatalogBleed(setup)
            const base = getMinionIntercept(bleed.blocker)
            attachInPlay(findAnyCard(bleed.bled, GUARDIAN_ANGEL_ID), bleed.blocker)
            expectEqual(getMinionIntercept(bleed.blocker), base + 1, 'bleed at its controller')

            const bystander = readyVampire(bleed.gameState, bleed.third, 3)
            const bystanderBase = getMinionIntercept(bystander)
            attachInPlay(findAnyCard(bleed.third, GUARDIAN_ANGEL_ID), bystander)
            expectEqual(getMinionIntercept(bystander), bystanderBase, 'bleed at another Methuselah')

            const hunt = createCatalogBleed({ ...setup, actionType: MinionActionType.Hunt })
            const huntBase = getMinionIntercept(hunt.blocker)
            attachInPlay(findAnyCard(hunt.bled, GUARDIAN_ANGEL_ID), hunt.blocker)
            expectEqual(getMinionIntercept(hunt.blocker), huntBase, 'hunt')
        },
    },
    {
        name: 'Guardian Angel prevents 1 regular damage once per combat, whatever the round',
        run() {
            const fight = createAngelFight(2, 0)
            const decision = defenderDecision(fight)
            const options = preventOptions(decision)
            expectEqual(options.length, 1, 'options')
            expectEqual(options[0].aggravated, false, 'regular')
            expectEqual(options[0].source, fight.angel, 'source')
            expectEqual(options[0].amount, 1, 'amount')

            applyOption(decision, options[0])
            expectEqual(getCombat(fight).defending.pendingDamage.regular, 1, 'damage left')
            expectEqual(preventOptions(defenderDecision(fight)).length, 0, 'once per combat')

            damageResolution(fight, fight.defending, 2, 0)
            expectEqual(
                preventOptions(defenderDecision(fight)).length,
                0,
                'not in the next round either',
            )
        },
    },
    {
        name: 'Guardian Angel prevents aggravated damage too, and nothing when there is no damage',
        run() {
            const fight = createAngelFight(0, 1)
            const decision = defenderDecision(fight)
            const options = preventOptions(decision)
            expectEqual(options.length, 1, 'options')
            expectEqual(options[0].aggravated, true, 'aggravated')
            applyOption(decision, options[0])
            expectEqual(getCombat(fight).defending.pendingDamage.aggravated, 0, 'damage left')

            const idle = createAngelFight(0, 0)
            expectEqual(preventOptions(defenderDecision(idle)).length, 0, 'no damage')
        },
    },
    {
        name: 'Guardian Angel: the Govern agent prevents the damage it can',
        run() {
            const fight = createAngelFight(2, 0)
            const step = stepBot(fight.defendingPlayer, new GovernAgent())
            expectEqual(step?.option.type, 'combatPrevent', 'option')
            expectEqual(getCombat(fight).defending.pendingDamage.regular, 1, 'damage left')
        },
    },
    {
        name: 'Guardian Angel is burned when its vampire goes to torpor, and stays while it is ready',
        run() {
            const spared = createAngelFight(1, 0, 3)
            passUntil(spared, CombatStep.EndOfRound)
            expectRegion(spared.defending, 'ready')
            expectEqual(getHost(spared.angel), spared.defending, 'still attached')

            const fight = createAngelFight(5, 0, 1)
            passUntil(fight, CombatStep.EndOfRound)
            expectRegion(fight.defending, 'torpor')
            expectEqual(fight.angel.isIn.ashHeap, true, 'burned')
            expectEqual(isAttached(fight.angel), false, 'attached')
        },
    },
]

function parseFilter(argv: string[]): string[] {
    const index = argv.indexOf('--filter')
    if (index < 0) {
        return ['']
    }
    const text = argv[index + 1]
    if (!text) {
        throw new Error('--filter needs a text')
    }
    return text
        .toLowerCase()
        .split('|')
        .map(part => part.trim())
        .filter(part => part.length > 0)
}

const LENNY_ID = '201555'
const DOWAGER_ID = '201545'
const NOSFERATU_DECK = <DeckList>{ ...BrujahDeck, [LENNY_ID]: 1, [DOWAGER_ID]: 1 }

// The first player declares an action, which the Dowager of its prey can attempt to block
function createDowagerBlock(actionType: MinionActionType) {
    const game = createCatalogBleed({
        deck: NOSFERATU_DECK,
        discipline: Discipline.Presence,
        level: DisciplineLevel.SUPERIOR,
        cards: [],
        actionType,
        preyVampireId: DOWAGER_ID,
    })
    const decision = passUntilDecides(game.gameState, game.bled)
    const block = optionsOfType(decision.options, 'block').find(
        option => option.minion == game.blocker,
    )
    if (!block) {
        throw new ScenarioFailure('The Dowager cannot attempt to block')
    }
    return { ...game, decision, block }
}

const NOSFERATU_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'Lenny Burkhead has +1 bleed on her bleed action',
        run() {
            const game = createCatalogBleed({
                deck: NOSFERATU_DECK,
                discipline: Discipline.Presence,
                level: DisciplineLevel.SUPERIOR,
                cards: [],
                bleederId: LENNY_ID,
            })
            expectEqual(game.bleeding.minionAttrs.bleed, 2, 'bleed of the vampire')
            expectEqual(game.gameState.action?.bleed, 2, 'bleed of the action')
        },
    },
    {
        name: 'The Dowager has +1 intercept when she attempts to block a directed action',
        run() {
            const game = createDowagerBlock(MinionActionType.Bleed)
            expectEqual(getMinionIntercept(game.blocker), 1, 'intercept')
            applyOption(game.decision, game.block)
            expectEqual(game.gameState.action?.intercept, 1, 'intercept of the block attempt')
        },
    },
    {
        name: 'The Dowager has no intercept bonus against an undirected action, nor outside an action',
        run() {
            const game = createDowagerBlock(MinionActionType.Hunt)
            expectEqual(getMinionIntercept(game.blocker), 0, 'intercept')
            applyOption(game.decision, game.block)
            expectEqual(game.gameState.action?.intercept, 0, 'intercept of the block attempt')

            const idle = createHeadlessGame([NOSFERATU_DECK, NOSFERATU_DECK])
            createdGames.push(idle.gameState)
            const dowager = readySpecific(idle.gameState, idle.players[0], DOWAGER_ID, 3)
            expectEqual(getMinionIntercept(dowager), 0, 'intercept with no action')
        },
    },
]

const LABYRINTH_ID = '101070'
const LABYRINTH_DECK = <DeckList>{ ...NOSFERATU_DECK, [LABYRINTH_ID]: 2 }

// Lenny declares a bleed with The Labyrinth in play under her controller, unlocked
function createLabyrinthBleed() {
    const game = createCatalogBleed({
        deck: LABYRINTH_DECK,
        discipline: Discipline.Presence,
        level: DisciplineLevel.SUPERIOR,
        cards: [],
        bleederId: LENNY_ID,
    })
    const labyrinth = findAnyCard(game.bleeder, LABYRINTH_ID)
    game.gameState.moveCardToRegion(labyrinth, game.bleeder.ready)
    return { ...game, labyrinth }
}

const labyrinthDecision = (game: ReturnType<typeof createLabyrinthBleed>) => {
    const decision = getDecisionPoint(game.gameState, game.bleeder)
    if (!decision) {
        throw new ScenarioFailure('The acting player has no decision')
    }
    return decision
}

const LABYRINTH_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'The Labyrinth locks for the action of a Nosferatu: +1 stealth once, the acting player keeps the impulse',
        run() {
            const game = createLabyrinthBleed()
            expectEqual(
                optionsOfType(labyrinthDecision(game).options, 'lockForAction').length,
                0,
                'no block attempt stands',
            )
            attemptBlock(game, false)
            expectEqual(
                optionsOfType(labyrinthDecision(game).options, 'lockForAction').length,
                0,
                'the block attempt fails anyway',
            )
            if (game.gameState.action) {
                game.gameState.action.intercept = game.gameState.action.stealth
            }
            const stealth = game.gameState.action?.stealth ?? 0
            const decision = labyrinthDecision(game)
            const options = optionsOfType(decision.options, 'lockForAction')
            expectEqual(options.length, 1, 'options')
            expectEqual(options[0].card, game.labyrinth, 'card')

            applyOption(decision, options[0])
            expectEqual(game.gameState.action?.stealth, stealth + 1, 'stealth')
            expectEqual(game.labyrinth.isLocked, true, 'locked')
            const next = labyrinthDecision(game)
            expectEqual(next.kind, DecisionKind.ActionImpulse, 'the acting player decides again')
            expectEqual(optionsOfType(next.options, 'lockForAction').length, 0, 'once')
        },
    },
    {
        name: 'The Labyrinth is not offered for another clan, a Nosferatu antitribu, a locked or a held card, nor to another Methuselah',
        run() {
            // A block attempt stands that would succeed: the stealth is needed
            const blocked = () => {
                const game = createLabyrinthBleed()
                attemptBlock(game, true)
                return game
            }
            const clanOf = (clan: string) => {
                const game = blocked()
                game.bleeding.vampireAttrs.clan = clan
                return game
            }
            const offered = (game: ReturnType<typeof createLabyrinthBleed>) =>
                optionsOfType(labyrinthDecision(game).options, 'lockForAction').length
            expectEqual(offered(clanOf('Nosferatu')), 1, 'a Nosferatu')
            expectEqual(offered(clanOf('Ventrue')), 0, 'another clan')
            expectEqual(offered(clanOf('Nosferatu antitribu')), 0, 'a Nosferatu antitribu')

            const locked = blocked()
            locked.labyrinth.lock()
            expectEqual(offered(locked), 0, 'locked')

            const held = blocked()
            held.gameState.moveCardToRegion(held.labyrinth, held.bleeder.hand)
            expectEqual(offered(held), 0, 'in hand')

            const other = createLabyrinthBleed()
            other.gameState.moveCardToRegion(
                findAnyCard(other.bled, LABYRINTH_ID),
                other.bled.ready,
            )
            expectEqual(
                getLockForActionOptions(other.bled, other.bleeding).length,
                0,
                'not the Methuselah of the acting minion',
            )
        },
    },
    {
        name: 'The Labyrinth: the Govern agent locks it when a block would succeed, not before',
        run() {
            const game = createLabyrinthBleed()
            const stealth = game.gameState.action?.stealth ?? 0
            const first = stepBot(game.bleeder, new GovernAgent())
            expectEqual(first?.option.type, 'noModifier', 'no block yet')

            const blockDecision = getDecisionPoint(game.gameState, game.bled)
            if (!blockDecision) {
                throw new ScenarioFailure('The prey has no decision')
            }
            applyOption(blockDecision, findOption(blockDecision.options, 'block'))
            const second = stepBot(game.bleeder, new GovernAgent())
            expectEqual(second?.option.type, 'lockForAction', 'a block stands')
            expectEqual(game.gameState.action?.stealth, stealth + 1, 'stealth')
        },
    },
]

const CARRION_CROWS_ID = '100301'
const DEEP_SONG_ID = '100515'
const MURDER_OF_CROWS_ID = '101254'

const createCrowsFight = (level: DisciplineLevel) =>
    createBrujahFight(CARRION_CROWS_ID, level, 3, Discipline.Animalism, CrowsDeck)

const crowsOptions = (fight: ReturnType<typeof createCrowsFight>) =>
    cardOptionsOf(fight, 'combatEnvironmentalDamage', fight.card)

// A second copy of the card, given to the acting player
function giveSecondCopy(fight: ReturnType<typeof createCrowsFight>): LibraryCard {
    const copy = fight.actingPlayer.removed.cards.find(
        card => card.krcgId == fight.card.krcgId && card != fight.card,
    )
    if (!(copy instanceof LibraryCard)) {
        throw new ScenarioFailure('No second copy')
    }
    fight.gameState.moveCardToRegion(copy, fight.actingPlayer.hand)
    return copy
}

// The minion phase of a player holding Deep Song, with a vampire of the prey in play
function createDeepSongTurn(level: DisciplineLevel) {
    const turn = createMinionPhase(5, 0, CrowsDeck)
    const { gameState, player } = turn
    const victim = player.prey
    if (!victim) {
        throw new ScenarioFailure('No prey')
    }
    turn.ready.minionAttrs.disciplines = { [Discipline.Animalism]: level } as Disciplines
    emptyHand(gameState, player)
    const card = giveCard(gameState, player, DEEP_SONG_ID)
    const target = readyVampire(gameState, victim, 4)
    return { ...turn, victim, card, target }
}

const deepSongOptions = (turn: ReturnType<typeof createDeepSongTurn>) => {
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

const CROWS_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'Carrion Crows is offered before the range at the levels of the vampire, and no later',
        run() {
            const fight = createCrowsFight(DisciplineLevel.SUPERIOR)
            expectEqual(
                crowsOptions(fight)
                    .map(option => option.amount)
                    .join(),
                '1,2',
                'both levels',
            )
            passUntil(fight, CombatStep.DetermineRange)
            expectEqual(crowsOptions(fight).length, 0, 'in the range step')

            const inferior = createCrowsFight(DisciplineLevel.INFERIOR)
            expectEqual(
                crowsOptions(inferior)
                    .map(option => option.amount)
                    .join(),
                '1',
                'inferior only',
            )
            const none = createCrowsFight(DisciplineLevel.INFERIOR)
            none.acting.minionAttrs.disciplines = {} as Disciplines
            expectEqual(crowsOptions(none).length, 0, 'no Animalism')
        },
    },
    {
        name: 'Carrion Crows hurts the opposing minion, and a vampire plays only one per combat',
        run() {
            const fight = createCrowsFight(DisciplineLevel.SUPERIOR)
            const second = giveSecondCopy(fight)
            playCardOption(
                fight,
                'combatEnvironmentalDamage',
                fight.card,
                option => option.amount == 2,
            )
            expectEqual(getCombat(fight).defending.environmentalDamage, 2, 'damage on the opponent')
            expectEqual(getCombat(fight).acting.environmentalDamage, 0, 'damage on the player')
            expectEqual(getCombat(fight).impulsePlayer, fight.actingPlayer, 'impulse')
            expectEqual(
                cardOptionsOf(fight, 'combatEnvironmentalDamage', second).length,
                0,
                'a second one',
            )
        },
    },
    {
        name: 'Carrion Crows damage comes each round and a dodge does not stop it',
        run() {
            const fight = createCrowsFight(DisciplineLevel.INFERIOR)
            playCardOption(fight, 'combatEnvironmentalDamage', fight.card)
            strikeRound(fight, undefined, createDodgeStrike())
            passUntil(fight, CombatStep.Press)
            expectEqual(fight.defending.blood, 2, 'defending blood after round 1')
            expectEqual(fight.acting.blood, 3, 'acting blood')

            press(fight.actingPlayer, fight.acting)
            pass(fight.defendingPlayer, 'defending passes')
            passUntil(fight, CombatStep.BeforeRange)
            strikeRoundToEnd(fight, undefined, createDodgeStrike())
            expectEqual(fight.defending.blood, 1, 'defending blood after round 2')
        },
    },
    {
        name: 'Carrion Crows damage is inflicted with first strikes alone, and not when the combat ended',
        run() {
            const fight = createCrowsFight(DisciplineLevel.INFERIOR)
            playCardOption(fight, 'combatEnvironmentalDamage', fight.card)
            const quick = createStrike('Quick', { damage: 1, firstStrike: true })
            strikeRoundToEnd(fight, quick, quick)
            expectEqual(fight.defending.blood, 1, 'defending blood')
            expectEqual(fight.acting.blood, 2, 'acting blood')

            const ended = createCrowsFight(DisciplineLevel.INFERIOR)
            playCardOption(ended, 'combatEnvironmentalDamage', ended.card)
            strikeRound(ended, createStrike('Flee', { combatEnds: true }))
            passUntil(ended, null)
            expectEqual(ended.defending.blood, 3, 'defending blood when the combat ends')
        },
    },
    {
        name: 'Murder of Crows is a retainer with 1 life at inferior and 2 at superior',
        run() {
            for (const [level, life] of [
                [DisciplineLevel.INFERIOR, 1],
                [DisciplineLevel.SUPERIOR, 2],
            ] as const) {
                const turn = createEquipTurn(MURDER_OF_CROWS_ID, CrowsDeck, level)
                const { decision, mine } = equipOptions(turn)
                const option = mine.find(candidate => levelOf(candidate) == level)
                if (!option) {
                    throw new ScenarioFailure(`No ${level} option`)
                }
                applyOption(decision, option)
                resolveAction(turn)
                expectEqual(getHost(turn.card), turn.ready, 'host')
                expectEqual(turn.card.blood, life, `life at ${level}`)
                expectEqual(getEnvironmentalDamage(turn.ready), 1, `damage at ${level}`)
            }
            const none = createEquipTurn(MURDER_OF_CROWS_ID, CrowsDeck, null)
            expectEqual(equipOptions(none).mine.length, 0, 'no Animalism')
        },
    },
    {
        name: 'Murder of Crows hurts the opposing minion each round, even against a dodge, until it is burned',
        run() {
            const fight = createFight(3, 3, CrowsDeck)
            const crows = findCard(fight.actingPlayer, MURDER_OF_CROWS_ID)
            attachInPlay(crows, fight.acting, { life: 1, disciplines: SPY_INFERIOR })
            strikeRound(fight, undefined, createDodgeStrike())
            passUntil(fight, CombatStep.Press)
            expectEqual(fight.defending.blood, 2, 'defending blood after round 1')
            expectEqual(fight.acting.blood, 3, 'the employer is not hurt')

            fight.gameState.moveCardToRegion(crows, fight.actingPlayer.ashHeap)
            press(fight.actingPlayer, fight.acting)
            pass(fight.defendingPlayer, 'defending passes')
            passUntil(fight, CombatStep.BeforeRange)
            strikeRoundToEnd(fight, undefined, createDodgeStrike())
            expectEqual(fight.defending.blood, 2, 'defending blood once the retainer is gone')
        },
    },
    {
        name: 'Deep Song bleeds at +1 with inferior Animalism, and cannot enter combat',
        run() {
            const turn = createDeepSongTurn(DisciplineLevel.INFERIOR)
            const { decision, mine } = deepSongOptions(turn)
            expectEqual(mine.length, 1, 'options')
            const target = mine[0].action.target
            expectEqual(target instanceof Player, true, 'a bleed aims at a player')
            applyOption(decision, mine[0])
            expectEqual(turn.gameState.action?.bleed, turn.ready.minionAttrs.bleed + 1, 'bleed')
        },
    },
    {
        name: 'Deep Song with superior Animalism locks a vampire of another Methuselah and starts a combat where it acts',
        run() {
            const turn = createDeepSongTurn(DisciplineLevel.SUPERIOR)
            const own = readyVampire(turn.gameState, turn.player, 3)
            const { decision, mine } = deepSongOptions(turn)
            const vampireTargets = mine.filter(
                option =>
                    option.action.actingMinion == turn.ready &&
                    option.action.target instanceof Card,
            )
            expectEqual(vampireTargets.length, 1, 'vampire targets')
            expectEqual(vampireTargets[0].action.target, turn.target, 'target')
            expectEqual(
                mine.some(option => option.action.target == own),
                false,
                'one of your own vampires',
            )

            applyOption(decision, vampireTargets[0])
            resolveAction(turn)
            expectEqual(turn.target.isLocked, true, 'target locked')
            const combat = turn.gameState.combat
            expectEqual(combat?.acting.minion, turn.target, 'acting minion')
            expectEqual(combat?.defending.minion, turn.ready, 'defending minion')
            expectEqual(combat?.impulsePlayer, turn.victim, 'impulse')
        },
    },
]

/**
 * What the utility agent stands on. The ledger of what the table did is folded live
 * and rebuilt from the mutation history ( both must agree ), a player view can be played on without
 * touching the game, and the facts the defence reading counts on ( influenced vampires are
 * unlocked blockers ).
 */

// Records the mutations of the game the scenario creates, and checks the ledger against its history
function withRecording(run: (recorder: MutationRecorder) => GameState): void {
    const recorder = recordMutations({ history: true })
    try {
        checkRecordedLedger(run(recorder), recorder)
    } finally {
        recorder.stop()
    }
}

const UTILITY_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'Ledger: an unblocked bleed is recorded with the pool it took, and the refusal to block',
        run() {
            withRecording(recorder => {
                const game = createEventBleed(0)
                const poolBefore = game.bled.pool
                passUntilActionOver(game.gameState)
                const taken = poolBefore - game.bled.pool
                expectEqual(taken > 0, true, 'pool taken')
                const bleeder = getPlayerLedger(recorder.ledger, game.bleeder.oid)
                const bled = getPlayerLedger(recorder.ledger, game.bled.oid)
                expectEqual(bleeder.bleedsDeclared, 1, 'bleeds declared')
                expectEqual(
                    JSON.stringify(bleeder.bleedAmounts),
                    JSON.stringify([taken]),
                    'amounts',
                )
                expectEqual(bled.poolLostToBleeds, taken, 'pool lost')
                expectEqual(bled.blocksDeclined, 1, 'blocks declined')
                expectEqual(bled.blocksAttempted, 0, 'blocks attempted')
                return game.gameState
            })
        },
    },
    {
        name: 'Ledger: a failed block attempt is recorded, and the bleed still lands',
        run() {
            withRecording(recorder => {
                const game = createEventBleed(0)
                blockWithBlocker(game)
                passUntilActionOver(game.gameState)
                const bled = getPlayerLedger(recorder.ledger, game.bled.oid)
                expectEqual(bled.blocksAttempted, 1, 'blocks attempted')
                expectEqual(bled.blocksFailed, 1, 'blocks failed')
                expectEqual(bled.blocksDeclined, 0, 'blocks declined')
                expectEqual(bled.poolLostToBleeds > 0, true, 'the bleed lands')
                return game.gameState
            })
        },
    },
    {
        name: 'Ledger: a block that succeeds stops the action, which is not a bleed that landed',
        run() {
            withRecording(recorder => {
                const game = createEventBleed(1)
                blockWithBlocker(game)
                passUntilActionOver(game.gameState)
                endBlockCombat(game)
                const bleeder = getPlayerLedger(recorder.ledger, game.bleeder.oid)
                const bled = getPlayerLedger(recorder.ledger, game.bled.oid)
                expectEqual(bled.blocksSucceeded, 1, 'blocks succeeded')
                expectEqual(bleeder.actionsBlocked, 1, 'actions blocked')
                expectEqual(bleeder.bleedAmounts.length, 0, 'bleeds landed')
                expectEqual(bled.poolLostToBleeds, 0, 'pool lost')
                return game.gameState
            })
        },
    },
    {
        name: 'Ledger: giving up a block attempt is a withdrawal, not a refusal to block',
        run() {
            withRecording(recorder => {
                const game = createEventBleed(0)
                blockWithBlocker(game)
                const next = passUntilDecides(game.gameState, game.bled)
                applyOption(next, findOption(next.options, 'noBlock'))
                passUntilActionOver(game.gameState)
                const bled = getPlayerLedger(recorder.ledger, game.bled.oid)
                expectEqual(bled.blocksAttempted, 1, 'blocks attempted')
                expectEqual(bled.blocksWithdrawn, 1, 'blocks withdrawn')
                expectEqual(bled.blocksDeclined, 0, 'blocks declined')
                expectEqual(bled.blocksFailed, 0, 'blocks failed')
                return game.gameState
            })
        },
    },
    {
        name: 'Ledger: a bounce is recorded, and the bleed lands on the new target',
        run() {
            withRecording(recorder => {
                const bounce = createBounce(DisciplineLevel.INFERIOR)
                const { gameState, bleeder, bled, third } = bounce
                if (!third) {
                    throw new ScenarioFailure('No third player')
                }
                const decision = declineBlock(bounce)
                applyOption(decision, getBounceOption(decision, DisciplineLevel.INFERIOR))
                passUntilActionOver(gameState)
                expectEqual(getPlayerLedger(recorder.ledger, bled.oid).bouncesPlayed, 1, 'bounces')
                expectEqual(getPlayerLedger(recorder.ledger, bled.oid).poolLostToBleeds, 0, 'bled')
                const amounts = getPlayerLedger(recorder.ledger, bleeder.oid).bleedAmounts
                expectEqual(amounts.length, 1, 'bleeds landed')
                expectEqual(
                    getPlayerLedger(recorder.ledger, third.oid).poolLostToBleeds,
                    amounts[0],
                    'pool lost by the new target',
                )
                return gameState
            })
        },
    },
    {
        name: 'A player view can be played on: the game, its history and the ledger are untouched',
        run() {
            withRecording(recorder => {
                const game = createEventBleed(0)
                const { gameState } = game
                const decider = getDecidingPlayer(gameState)
                if (!decider) {
                    throw new ScenarioFailure('Nobody has a decision')
                }
                const live = JSON.stringify(serializeGameState(gameState))
                const ledger = JSON.stringify(recorder.ledger)
                const entries = recorder.history?.gameMutations.length

                const view = createPlayerView(gameState, decider)
                try {
                    const decision = getDecisionPoint(view.gameState, view.player)
                    if (!decision) {
                        throw new ScenarioFailure('No decision in the view')
                    }
                    applyOption(decision, decision.options[0])
                    expectEqual(
                        JSON.stringify(serializeGameState(view.gameState)) != live,
                        true,
                        'the view moved on',
                    )
                } finally {
                    view.dispose()
                }
                expectEqual(JSON.stringify(serializeGameState(gameState)), live, 'live state')
                expectEqual(JSON.stringify(recorder.ledger), ledger, 'ledger')
                expectEqual(recorder.history?.gameMutations.length, entries, 'history')
                return gameState
            })
        },
    },
    {
        name: 'The utility agent gets the ledger and its own decklist, and explains its choice',
        run() {
            const { gameState } = createHeadlessGame([GovernDeck, MalkavDeck])
            createdGames.push(gameState)
            // Plays on until a decision with a real choice
            const govern = new GovernAgent()
            let player = getDecidingPlayer(gameState)
            let decision = player && getDecisionPoint(gameState, player)
            for (let i = 0; i < 40 && player && decision?.options.length == 1; i++) {
                stepBot(player, govern)
                player = getDecidingPlayer(gameState)
                decision = player && getDecisionPoint(gameState, player)
            }
            if (!player || !decision || decision.options.length < 2) {
                throw new ScenarioFailure('No decision with a real choice')
            }
            let explained = 0
            const agent = new UtilityAgent(GovernDeck, undefined, () => explained++)
            expectEqual(agent.deck, GovernDeck, 'own deck')

            // Whatever the agent receives next to the view: the ledger of the table, not the game
            let received: BotContext | undefined
            const spy: BotAgent = {
                choose(viewDecision, context) {
                    received = context
                    return viewDecision.options[0]
                },
            }
            const recorder = recordMutations({ history: false })
            try {
                const context = { ledger: recorder.ledger }
                chooseThroughView(decision, spy, context)
                expectEqual(received, context, 'the context reaches the agent')
            } finally {
                recorder.stop()
            }

            chooseThroughView(decision, agent)
            expectEqual(explained, 1, 'explain entries')
        },
    },
    {
        name: 'An influenced vampire enters play unlocked: it can attempt a block at once',
        run() {
            const game = createEventBleed(0)
            const { gameState, bled, blocker } = game
            const newcomer = bled.vampiresInUncontrolled[0]
            const influence: BotOption = {
                type: 'influence',
                vampire: newcomer,
                amount: newcomer.minionAttrs.capacity,
            }
            applyOption(
                { kind: DecisionKind.Influence, player: bled, options: [influence] },
                influence,
            )
            expectEqual(newcomer.isIn.ready, true, 'ready')
            expectEqual(newcomer.isLocked, false, 'unlocked')
            expectEqual(bled.minionsReadyUnlocked.includes(newcomer), true, 'counted unlocked')

            blocker.lock()
            const decision = passUntilDecides(gameState, bled)
            const blockers = optionsOfType(decision.options, 'block').map(option => option.minion)
            expectEqual(blockers.includes(newcomer), true, 'the newcomer can block')
            expectEqual(blockers.includes(blocker), false, 'a locked minion cannot')
        },
    },
]

/**
 * Play summaries: what the scorer reads of a card, from the catalog.
 */

function summaryOf(id: string): CardSummary {
    const summary = summarizeCardId(id)
    if (!summary) {
        throw new ScenarioFailure(`No summary for ${id}`)
    }
    return summary
}

function findEffect<T extends Effect['type']>(
    effects: Effect[],
    type: T,
): Extract<Effect, { type: T }> {
    const found = effects.find(
        (effect): effect is Extract<Effect, { type: T }> => effect.type == type,
    )
    if (!found) {
        throw new ScenarioFailure(`No ${type} effect in ${effects.map(describeEffect).join('; ')}`)
    }
    return found
}

const SUMMARY_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'Summary: a bleed action is a bleed, and the stealth of an action is its own, not a stealth card',
        run() {
            const [bleed, recruit] = summaryOf(GOVERN_ID).plays
            expectEqual(bleed.window, 'minionAction', 'window')
            expectEqual(findEffect(bleed.effects, 'bleedAction').amount, 2, 'bleed')
            expectEqual(bleed.roles.join(), 'bleed', 'roles of the bleed')
            expectEqual(bleed.ways.length, 1, 'one way')
            expectEqual(bleed.ways[0][0].level, DisciplineLevel.INFERIOR, 'inferior')

            expectEqual(findEffect(recruit.effects, 'stealth').amount, 1, 'stealth of the action')
            expectEqual(findEffect(recruit.effects, 'gainBlood').amount, 3, 'blood')
            expectEqual(recruit.target, 'youngerUncontrolledVampire', 'target')
            expectEqual(recruit.roles.join(), 'recruit', 'a recruit, not a stealth card')
        },
    },
    {
        name: 'Summary: a modifier is a stealth source or a bleed bonus, in the window it is played',
        run() {
            const crowds = summaryOf(LOST_IN_CROWDS_ID).plays
            expectEqual(
                crowds.map(play => findEffect(play.effects, 'stealth').amount).join(),
                '1,2',
                'stealth',
            )
            expectEqual(crowds[0].window, 'ownAction', 'window')
            expectEqual(crowds[0].roles.join(), 'stealth', 'roles')

            const conditioning = summaryOf(CONDITIONING_ID).plays[0]
            const bonus = findEffect(conditioning.effects, 'bleedBonus')
            expectEqual(bonus.amount, 2, 'bonus')
            expectEqual(bonus.limited, true, 'limited')
            expectEqual(conditioning.window, 'ownBleed', 'only during a bleed')
            expectEqual(conditioning.roles.join(), 'bleedBonus', 'roles')

            const wrench = summaryOf(MONKEY_WRENCH_ID).plays[0]
            expectEqual(findEffect(wrench.effects, 'bleedBonus').amount, 'X', 'variable bonus')
            expectEqual(JSON.stringify(wrench.x), JSON.stringify({ min: 1, max: 3 }), 'X range')
        },
    },
    {
        name: 'Summary: a bounce is played once the blocks are declined, a wake before the block',
        run() {
            const [inferior, superior] = summaryOf(DEFLECTION_ID).plays
            expectEqual(inferior.window, 'afterBlocksDeclined', 'window')
            expectEqual(findEffect(inferior.effects, 'bounce').lockReactor, true, 'inferior locks')
            expectEqual(
                findEffect(superior.effects, 'bounce').lockReactor,
                false,
                'superior does not',
            )
            expectEqual(inferior.roles.join(), 'bounce', 'roles')

            const quiVive = summaryOf(QUI_VIVE_ID).plays[0]
            expectEqual(quiVive.window, 'beforeBlock', 'wake window')
            expectEqual(quiVive.roles.join(), 'wake', 'wake role')
            expectEqual(quiVive.ways[0].length, 0, 'no discipline')
        },
    },
    {
        name: 'Summary: an intercept needs a block attempt to stand, unless the play starts the attempt',
        run() {
            const warrens = summaryOf(WARRENS_ID).plays[0]
            expectEqual(warrens.window, 'blockAttemptStands', 'Warrens')
            expectEqual(warrens.roles.join(), 'intercept', 'Warrens roles')
            const conditional = warrens.effects.filter(effect => effect.when)
            expectEqual(conditional.length, 2, 'the two amounts depend on the title of the reactor')

            const resistance = summaryOf(ORGANIZED_RESISTANCE_ID).plays[0]
            expectEqual(resistance.window, 'beforeBlock', 'Organized Resistance starts the attempt')
            expectEqual(resistance.roles.join(), 'wake,intercept', 'wake and intercept')
            expectEqual(findEffect(resistance.effects, 'unlockAndBlock').intercept, 1, 'intercept')
        },
    },
    {
        name: 'Summary: a play with several effects has every role, a trigger gives its own',
        run() {
            const faceless = summaryOf(FACELESS_NIGHT_ID).plays[1]
            expectEqual(faceless.roles.join(), 'stealth,punishBlock', 'Faceless Night superior')
            const trigger = findEffect(faceless.effects, 'trigger')
            expectEqual(trigger.armed, true, 'armed for the action')
            expectEqual(trigger.effects[0].type, 'lockFailedBlocker', 'locks the failed blocker')

            const dogs = summaryOf(GUARD_DOGS_ID).plays
            expectEqual(dogs[0].roles.join(), 'wake', 'Guard Dogs inferior')
            expectEqual(dogs[1].roles.join(), 'wake,maneuver', 'Guard Dogs superior')
        },
    },
    {
        name: 'Summary: equipment and retainers say what they do attached',
        run() {
            const magnum = summaryOf(MAGNUM_ID).plays[0]
            expectEqual(magnum.staysInPlay, 'onMinion', 'stays on a minion')
            expectEqual(magnum.attachTo, 'this', 'on the acting minion')
            const strike = findEffect(magnum.attached, 'weaponStrike')
            expectEqual(strike.damage, 2, 'damage')
            expectEqual(strike.ranged, true, 'ranged')
            expectEqual(magnum.roles.join(), 'strike,maneuver,attachment', 'roles')

            const raven = summaryOf(RAVEN_SPY_ID).plays
            expectEqual(findEffect(raven[0].attached, 'life').amount, 1, 'life')
            expectEqual(findEffect(raven[1].attached, 'life').amount, 2, 'superior life')
            expectEqual(raven[0].roles.join(), 'intercept,soak,attachment', 'roles')

            // The stealth of the action that puts the card on is the action's own
            const strength = summaryOf(PRETERNATURAL_ID).plays[0]
            expectEqual(strength.roles.join(), 'strength,attachment', 'roles')
            findEffect(strength.attached, 'restrictPlay')
            expectEqual(strength.onePerMinion, true, 'one per minion')
        },
    },
    {
        name: 'Summary: a card in play says its abilities, with the window, the lock and the cost',
        run() {
            const labyrinth = summaryOf(LABYRINTH_ID).plays[0].abilities[0]
            expectEqual(labyrinth.activate, 'lockForAction', 'activate')
            expectEqual(labyrinth.windows.join(), 'ownAction', 'window')
            expectEqual(labyrinth.locks, true, 'locks the card')
            expectEqual(labyrinth.roles.join(), 'stealth', 'a stealth source')

            const [draw, burn] = summaryOf(WIDER_VIEW_ID).plays[0].abilities
            expectEqual(draw.transfers, 1, 'one transfer')
            expectEqual(draw.roles.join(), 'cycling', 'cycles the crypt')
            expectEqual(burn.transfers, 4, 'four transfers')
            expectEqual(burn.roles.join(), 'poolGain', 'pool')

            const barrens = summaryOf(BARRENS_ID).plays[0].abilities[0]
            expectEqual(barrens.locks, true, 'locks')
            expectEqual(barrens.windows.join(), 'masterPhase,discardPhase', 'windows')
        },
    },
    {
        name: 'Summary: a crypt card adds what the catalog says, a vanilla one nothing',
        run() {
            const aline = summaryOf(ALINE_ID)
            const trigger = findEffect(aline.cryptEffects, 'trigger')
            expectEqual(trigger.costBlood, 1, 'burns a blood')
            expectEqual(trigger.oncePerTurn, true, 'once per turn')
            expectEqual(trigger.optional, true, 'a decision')
            expectEqual(aline.roles.join(), 'unlock', 'roles')

            const theo = summaryOf(THEO_BELL_ID)
            expectEqual(theo.roles.join(), 'combatStarter,strength', 'Theo Bell')

            const vanilla = summaryOf('201537')
            expectEqual(vanilla.cryptEffects.length, 0, 'nothing to add')
            expectEqual(vanilla.catalogued, true, 'catalogued')
        },
    },
    {
        name: 'Summary: a card the catalog does not describe is known by its name and cost only',
        run() {
            const summary = summaryOf('101895')
            expectEqual(summary.name, 'Sudario Refraction', 'name')
            expectEqual(summary.catalogued, false, 'not catalogued')
            expectEqual(summary.plays.length, 0, 'no play')
            expectEqual(summary.roles.length, 0, 'no role')
            expectEqual(summarizeCardId('999999'), undefined, 'unknown id')
        },
    },
    {
        name: 'Summary: a way is usable by a vampire with every discipline at the level it asks',
        run() {
            const [inferior, superior] = summaryOf(DEFLECTION_ID).plays
            const dominate: Partial<Disciplines> = {
                [Discipline.Dominate]: DisciplineLevel.INFERIOR,
            }
            const obfuscate: Partial<Disciplines> = {
                [Discipline.Obfuscate]: DisciplineLevel.SUPERIOR,
            }
            expectEqual(waysUsableBy(inferior.ways, dominate).length, 1, 'inferior with Dominate')
            expectEqual(waysUsableBy(superior.ways, dominate).length, 0, 'superior needs the level')
            expectEqual(waysUsableBy(inferior.ways, obfuscate).length, 0, 'wrong discipline')
            const both: Partial<Disciplines> = { [Discipline.Dominate]: DisciplineLevel.SUPERIOR }
            expectEqual(waysUsableBy(superior.ways, both).length, 1, 'superior')
        },
    },
    {
        name: 'Summary: Minion Tap is pool for me, from the blood of a vampire, and Life in the City is not',
        run() {
            const tap = summaryOf(MINION_TAP_ID).plays[0]
            expectEqual(tap.roles.join(), 'poolGain,master', 'roles of Minion Tap')
            expectEqual(
                tap.effects.map(effect => effect.type).join(),
                'bloodToPool',
                'effects of Minion Tap',
            )
            expectEqual(
                summaryOf(LIFE_IN_THE_CITY_ID).plays[0].roles.includes('poolGain'),
                false,
                'Life in the City',
            )
        },
    },
    {
        name: 'Summary: Villein is pool for me, stays on a vampire, and makes the cards of the same family cost more there',
        run() {
            const villein = summaryOf(VILLEIN_ID).plays[0]
            expectEqual(villein.roles.join(), 'poolGain,attachment,master', 'roles of Villein')
            expectEqual(
                villein.effects.map(effect => JSON.stringify(effect)).join(),
                '{"type":"bloodToPool","min":2,"max":5}',
                'effects of Villein',
            )
            expectEqual(
                villein.attached.map(effect => effect.type).join(),
                'raisePlayCost',
                'what it does while attached',
            )
        },
    },
    {
        name: 'Summary: every catalogued play has a role',
        run() {
            const without = CARD_DEFS.flatMap(def =>
                summaryOf(def.id).plays.some(play => play.roles.length == 0) ? [def.name] : [],
            )
            expectEqual(without.join(), '', 'cards with a play with no role')
        },
    },
]

/**
 * Table assessment: the effective minion, the snapshot of the table as a
 * player sees it, the lunge of the predator on a pool, the opportunity on the prey, the stakes of each
 * Methuselah. The vampires of these scenarios have no discipline, so the table shows no evidence and
 * what the others hold is the neutral prior: the numbers can be worked out by hand.
 */

type Ring = { gameState: GameState; players: Player[] }

// The players sit in a ring in the order of the list: the prey of each one is the next one
function createRing(decks: DeckList[]): Ring {
    const { gameState, players } = createHeadlessGame(decks)
    createdGames.push(gameState)
    gameState.turnOrder = players.map(player => player.oid)
    return { gameState, players }
}

type MinionSetup = {
    blood?: number
    bleed?: number
    strength?: number
    intercept?: number
    locked?: boolean
    disciplines?: Partial<Disciplines>
}

function addMinions(ring: Ring, player: Player, setups: MinionSetup[]): Vampire[] {
    return setups.map(setup => {
        const vampire = readyVampire(ring.gameState, player, setup.blood ?? 5)
        const attrs = vampire.minionAttrs
        attrs.disciplines = (setup.disciplines ?? {}) as Disciplines
        attrs.bleed = setup.bleed ?? 1
        attrs.strength = setup.strength ?? 1
        attrs.intercept = setup.intercept ?? 0
        vampire.isLocked = !!setup.locked
        return vampire
    })
}

// The hand of the player is these cards and nothing else
function holdOnly(ring: Ring, player: Player, ids: string[]): LibraryCard[] {
    emptyHand(ring.gameState, player)
    return ids.map(id => giveCard(ring.gameState, player, id))
}

// Through the view of the player, as the agent gets it: what it must not see is not there
function assessAs(ring: Ring, player: Player, profile: BotProfile = DEFAULT_PROFILE): Assessment {
    const view = createPlayerView(ring.gameState, player)
    try {
        return assess(view.gameState, view.player, profile)
    } finally {
        view.dispose()
    }
}

function snapshotAs(ring: Ring, player: Player) {
    const view = createPlayerView(ring.gameState, player)
    try {
        return takeSnapshot(view.gameState, view.player)
    } finally {
        view.dispose()
    }
}

function expectClose(actual: number, expected: number, what: string, tolerance = 0.005): void {
    if (Math.abs(actual - expected) > tolerance) {
        throw new ScenarioFailure(`${what}: expected about ${expected}, got ${actual}`)
    }
}

// The chance that a hand of `cards` cards has none of the cards that a share `share` of the deck holds
const withNone = (share: number, cards: number) => (1 - share) ** cards

const ASSESSMENT_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'Minion profile: a vampire is its crypt card, with its state',
        run() {
            const ring = createRing([GovernDeck, GovernDeck])
            const [me] = ring.players
            const [unlocked, locked] = addMinions(ring, me, [
                { blood: 4 },
                { blood: 6, bleed: 2, locked: true },
            ])
            const first = profileMinion(unlocked)
            expectEqual(first.state, 'unlocked', 'state')
            expectEqual(first.blood, 4, 'blood')
            expectEqual(first.capacity, unlocked.minionAttrs.capacity, 'capacity')
            expectEqual(first.strength, 1, 'strength')
            expectEqual(
                JSON.stringify(first.intercept),
                JSON.stringify({ general: 0, directed: 0, againstBleeds: 0 }),
                'intercept',
            )
            const second = profileMinion(locked)
            expectEqual(second.state, 'locked', 'locked')
            expectEqual(second.bleed, 2, 'bleed')
            ring.gameState.moveCardToRegion(unlocked, me.torpor)
            expectEqual(profileMinion(unlocked).state, 'torpor', 'torpor')
        },
    },
    {
        name: 'Minion profile: a weapon gives a strike with its range and a free maneuver, the strength is the one of the engine',
        run() {
            const ring = createRing([AttachDeck, AttachDeck])
            const [me] = ring.players
            const [vampire] = addMinions(ring, me, [{}])
            const magnum = findAnyCard(me, MAGNUM_ID)
            attachInPlay(magnum, vampire)
            const profile = profileMinion(vampire)
            expectEqual(profile.weaponStrikes.length, 1, 'one strike')
            expectEqual(profile.weaponStrikes[0].damage, 2, 'damage')
            expectEqual(profile.weaponStrikes[0].ranged, true, 'ranged')
            expectEqual(profile.weaponStrikes[0].aggravated, false, 'not aggravated')
            expectEqual(profile.freeManeuver, true, 'free maneuver')
            expectEqual(profile.attached.join(), magnum.name, 'attached')

            attachInPlay(findAnyCard(me, PRETERNATURAL_ID), vampire)
            expectEqual(profileMinion(vampire).strength, getMinionStrength(vampire), 'strength')
            expectEqual(profileMinion(vampire).strength > 1, true, 'stronger')
            expectEqual(profileMinion(vampire).forbiddenPlays.length > 0, true, 'cannot play')
        },
    },
    {
        name: 'Minion profile: a retainer gives life and the intercept the engine counts',
        run() {
            const ring = createRing([AttachDeck, AttachDeck])
            const [me] = ring.players
            const [vampire] = addMinions(ring, me, [{}])
            attachInPlay(findAnyCard(me, RAVEN_SPY_ID), vampire, {
                life: 2,
                disciplines: SPY_INFERIOR,
            })
            const profile = profileMinion(vampire)
            expectEqual(profile.life, 2, 'life')
            expectEqual(profile.intercept.general, 1, 'intercept')
            expectEqual(
                profile.intercept.general,
                getMinionIntercept(vampire),
                'same as the engine',
            )
        },
    },
    {
        name: 'Minion profile: an intercept that holds only against bleeds is not counted against other actions',
        run() {
            const ring = createRing([AttachDeck, AttachDeck])
            const [me] = ring.players
            const [vampire] = addMinions(ring, me, [{}])
            attachInPlay(findAnyCard(me, GUARDIAN_ANGEL_ID), vampire)
            const profile = profileMinion(vampire)
            expectEqual(profile.intercept.general, 0, 'against other actions')
            expectEqual(profile.intercept.againstBleeds, 1, 'against bleeds')
            expectEqual(profile.prevention.join(), '1', 'prevents 1 damage')
            expectEqual(profile.burnsInTorpor, true, 'burns in torpor')
        },
    },
    {
        name: 'Snapshot: the minions and equipment of the others are public, their hand is not',
        run() {
            const ring = createRing([AttachDeck, AttachDeck])
            const [me, other] = ring.players
            const [vampire] = addMinions(ring, other, [{ strength: 2 }])
            attachInPlay(findAnyCard(other, MAGNUM_ID), vampire)
            const hand = me.hand.cards.length

            const table = snapshotAs(ring, me)
            expectEqual(table.others.length, 1, 'one other')
            const seen = table.others[0]
            expectEqual(seen.isPrey && seen.isPredator, true, 'both with two players')
            expectEqual(seen.minions.length, 1, 'its minion')
            expectEqual(seen.minions[0].weaponStrikes.length, 1, 'its weapon')
            expectEqual(seen.minions[0].strength, 2, 'its strength')
            expectEqual(seen.hand.length, 0, 'its hand is not known')
            expectEqual(seen.handSize, other.hand.cards.length, 'its hand size is')
            expectEqual(table.me.hand.length, hand, 'mine is')
        },
    },
    {
        name: 'Snapshot: the permanents with an ability say whether a charge is left, a locked one is spent',
        run() {
            const ring = createRing([LABYRINTH_DECK, LABYRINTH_DECK])
            const [me] = ring.players
            const lenny = readySpecific(ring.gameState, me, LENNY_ID, 5)
            const labyrinth = findAnyCard(me, LABYRINTH_ID)
            ring.gameState.moveCardToRegion(labyrinth, me.ready)

            const kitOf = (clan?: string) => {
                const table = snapshotAs(ring, me)
                const minion = table.me.minions.find(candidate => candidate.oid == lenny.oid)
                if (!minion) {
                    throw new ScenarioFailure('No profile for Lenny')
                }
                const attacker = clan ? { ...minion, clan } : minion
                return {
                    table,
                    kit: attackKitOf(
                        table.me,
                        [attacker],
                        densitiesOf(table.me, DEFAULT_PROFILE),
                        DEFAULT_PROFILE,
                    ),
                }
            }
            const ready = kitOf()
            expectEqual(ready.table.me.permanents.length, 1, 'one permanent')
            expectEqual(ready.table.me.permanents[0].available, true, 'a charge is left')
            expectEqual(ready.kit.standingStealth, 1, 'a Nosferatu has +1 stealth for free')
            expectEqual(kitOf('Toreador').kit.standingStealth, 0, 'another clan has not')

            labyrinth.lock()
            const spent = kitOf()
            expectEqual(spent.table.me.permanents[0].available, false, 'spent')
            expectEqual(spent.kit.standingStealth, 0, 'no stealth')
        },
    },
    {
        name: 'Capabilities: the disciplines of the minions in play raise what its Methuselah is believed to hold, nothing shown is the prior',
        run() {
            const prior = DEFAULT_PROFILE.opponentPrior
            const obfuscate = { [Discipline.Obfuscate]: DisciplineLevel.INFERIOR }
            const stealthOf = (...minions: Partial<Disciplines>[]) =>
                roleDensities(minions, {}, prior).stealth ?? 0

            expectClose(stealthOf(), 0.08, 'nothing shown')
            expectClose(stealthOf(obfuscate), 1 - 0.92 * (1 - 0.1 * 0.5), 'one Obfuscate vampire')
            expectClose(
                stealthOf(obfuscate, obfuscate),
                1 - 0.92 * (1 - 0.1 * 0.75),
                'two are a safer bet',
            )
            expectEqual(
                stealthOf({ [Discipline.Obfuscate]: DisciplineLevel.SUPERIOR }) >
                    stealthOf(obfuscate),
                true,
                'superior says more',
            )
            expectClose(
                roleDensities([obfuscate], {}, prior).wake ?? 0,
                0.04,
                'what the discipline does not say stays at the prior',
            )
            expectClose(
                roleDensities([], { stealth: 3 }, prior).stealth ?? 0,
                1 - 0.92 * 0.97 ** 3,
                'a stealth card played raises it',
            )

            const everything = roleDensities(
                Object.values(Discipline).map(name => ({ [name]: DisciplineLevel.SUPERIOR })),
                { stealth: 5, bleed: 5, recruit: 5 },
                prior,
            )
            const total = Object.values(everything).reduce((sum, share) => sum + share, 0)
            expectEqual(total <= prior.budget + 1e-9, true, 'a library holds only so much')
        },
    },
    {
        name: 'Attack: a distribution of the cards in a hand sums to one, the tail is folded into the cap',
        run() {
            const hand = binomial(7, 0.08, 3)
            expectEqual(hand.length, 4, 'outcomes')
            expectClose(
                hand.reduce((sum, outcome) => sum + outcome.p, 0),
                1,
                'sum',
                1e-9,
            )
            expectClose(hand[0].p, withNone(0.08, 7), 'no card', 1e-9)
            expectEqual(binomial(2, 0.5, 3).length, 3, 'never more than the hand')
            expectEqual(binomial(0, 0.5, 3).length, 1, 'an empty hand')
            expectClose(binomial(7, 0.06, 3, 1.5)[1].value, 1.5, 'scaled', 1e-9)
        },
    },
    {
        name: 'Lunge: a predator with three ready minions ousts a pool its bleeds reach, by the cards in its hand when they do not',
        run() {
            const ring = createRing([GovernDeck, GovernDeck])
            const [me, predator] = ring.players
            addMinions(ring, predator, [{ bleed: 2 }, { bleed: 2 }, { bleed: 2 }])
            const assessment = assessAs(ring, me)
            const hand = predator.hand.cards.length

            expectEqual(chanceOfOust(assessment, { pool: 5 }), 1, 'the bleeds alone are 6')
            expectEqual(chanceOfOust(assessment, { pool: 6 }), 1, 'exactly the pool')
            // One bleed modifier is enough to make 7. An unlock card is not: a minion bleeds once a turn
            expectClose(
                chanceOfOust(assessment, { pool: 7 }),
                1 - withNone(0.06, hand),
                'a modifier in a hand of the predator',
            )
            expectEqual(chanceOfOust(assessment, { pool: 12 }), 0, 'out of reach of any hand')
        },
    },
    {
        name: 'Lunge: a predator whose minions are all in torpor takes nothing, one that is only locked still does ( it unlocks first )',
        run() {
            const ring = createRing([GovernDeck, GovernDeck])
            const [me, predator] = ring.players
            const minions = addMinions(ring, predator, [
                { bleed: 3, locked: true },
                { bleed: 3, locked: true },
            ])
            const locked = assessAs(ring, me).threat[predator.oid]
            expectEqual(locked.bleed > 5, true, 'locked minions unlock at the start of its turn')

            for (const minion of minions) {
                ring.gameState.moveCardToRegion(minion, predator.torpor)
            }
            const torpid = assessAs(ring, me)
            expectEqual(torpid.threat[predator.oid].total, 0, 'no threat')
            expectEqual(chanceOfOust(torpid, { pool: 1 }), 0, 'no ouster')
        },
    },
    {
        name: 'Lunge: each blocker kept unlocked lowers the chance of being ousted, the cards of the predator keep it above zero',
        run() {
            const ring = createRing([GovernDeck, GovernDeck])
            const [me, predator] = ring.players
            addMinions(ring, me, [{}, {}, {}])
            addMinions(ring, predator, [{ bleed: 2 }, { bleed: 2 }, { bleed: 2 }])
            me.pool = 5
            const assessment = assessAs(ring, me)
            const curve = survivalCurve(assessment).map(point => point.chanceOfOust)
            expectEqual(curve.length, 4, 'from none to all three')
            expectEqual(curve[0], 1, 'nobody home: three bleeds of 2 against 5')
            // The predator sees the blockers: with two at home its own bleeds are blocked and it keeps its
            // minions home too, so the third changes nothing more
            for (let i = 1; i < curve.length; i++) {
                expectEqual(curve[i] <= curve[i - 1], true, `blocker ${i} never hurts`)
            }
            expectEqual(curve[1] < curve[0] && curve[2] < curve[1], true, 'the first two help')
            expectEqual(curve[3] > 0, true, 'stealth cards beat blockers')
            expectEqual(curve[3] < 0.35, true, 'but three blockers are a wall')
            expectEqual(
                chanceOfOust(assessment),
                curve[3],
                'by default the minions that are unlocked now',
            )
        },
    },
    {
        name: 'Lunge: a predator keeps minions unlocked against its own predator, and sends them all when that can oust me',
        run() {
            const setup = (
                bleedersOfPredator: number,
                pool: number,
                predatorPool = 4,
                profile: BotProfile = DEFAULT_PROFILE,
            ) => {
                const ring = createRing([GovernDeck, GovernDeck, GovernDeck])
                const [me, prey, predator] = ring.players
                addMinions(ring, predator, [
                    { bleed: 2, intercept: 1 },
                    { bleed: 2, intercept: 1 },
                    { bleed: 2, intercept: 1 },
                ])
                // My prey is the predator of my predator
                addMinions(
                    ring,
                    prey,
                    Array.from({ length: bleedersOfPredator }, () => ({ bleed: 3 })),
                )
                predator.pool = predatorPool
                me.pool = pool
                const assessment = assessAs(ring, me, profile)
                return {
                    assessment,
                    kept: assessment.held[predator.oid].length,
                    bleed: assessment.threat[predator.oid].bleed,
                }
            }

            const quiet = setup(0, 9)
            expectEqual(quiet.kept, 0, 'nobody bleeds it: it keeps nobody back')
            expectEqual(quiet.bleed > 5, true, 'it bleeds with all three')

            const pressed = setup(3, 9)
            expectEqual(pressed.kept > 0, true, 'three bleeders: it keeps some back')
            expectEqual(pressed.bleed < quiet.bleed, true, 'what is kept back does not bleed me')
            expectEqual(
                chanceOfOust(pressed.assessment) < chanceOfOust(quiet.assessment),
                true,
                'and I am safer for it',
            )

            // Far from an ouster ( 30 pool ) it still defends: a bleed that lands weakens it for good
            const rich = setup(3, 9, 30)
            expectEqual(rich.kept > 0, true, 'a pool of 30 is not a reason to stay open')

            // With my pool at 2 sending them all ousts me for sure: it does not keep anyone back
            const lethal = setup(3, 2)
            expectEqual(lethal.kept > 0, true, 'it would keep some back')
            expectEqual(
                chanceOfOust(lethal.assessment),
                1,
                'but the oust wins the game, so it sends all',
            )

            // A blocker also stops the strong action that is not a bleed: with a high enough guard it stays
            // home even when nobody bleeds its Methuselah
            const guard = (value: number): BotProfile => ({
                ...DEFAULT_PROFILE,
                opponentPrior: {
                    ...DEFAULT_PROFILE.opponentPrior,
                    reserve: { ...DEFAULT_PROFILE.opponentPrior.reserve, guard: value },
                },
            })
            expectEqual(setup(0, 9, 4, guard(0)).kept, 0, 'no guard: it all goes out')
            expectEqual(setup(0, 9, 4, guard(5)).kept, 3, 'a guard worth more than a bleed')
        },
    },
    {
        name: 'Lunge: an unlock card lets a minion bleed and defend, never bleed twice',
        run() {
            const ring = createRing([GovernDeck, GovernDeck, GovernDeck])
            const [me, prey, predator] = ring.players
            addMinions(ring, predator, [
                { bleed: 2, intercept: 1 },
                { bleed: 2, intercept: 1 },
                { bleed: 2, intercept: 1 },
            ])
            addMinions(ring, prey, [{ bleed: 3 }, { bleed: 3 }, { bleed: 3 }])
            me.pool = 20
            const withUnlock = (density: number): BotProfile => ({
                ...DEFAULT_PROFILE,
                opponentPrior: {
                    ...DEFAULT_PROFILE.opponentPrior,
                    density: { ...DEFAULT_PROFILE.opponentPrior.density, unlock: density },
                },
            })
            const bleedOf = (density: number) => {
                const assessment = assessAs(ring, me, withUnlock(density))
                return {
                    held: assessment.held[predator.oid].length,
                    bleed: assessment.threat[predator.oid].bleed,
                }
            }
            const none = bleedOf(0)
            const many = bleedOf(0.9)
            expectEqual(none.held > 0, true, 'it keeps some back')
            expectEqual(many.bleed > none.bleed, true, 'with unlock cards it sends more of them')
            // Two unlock cards at the most, and a bleed each: three bleeders of 2 never make more than 6
            expectEqual(many.bleed <= 6 + 1e-9, true, 'but a minion never bleeds twice')

            const prior = DEFAULT_PROFILE.opponentPrior
            const fortitude = { [Discipline.Fortitude]: DisciplineLevel.SUPERIOR }
            expectEqual(
                (roleDensities([fortitude], {}, prior).unlock ?? 0) >
                    (roleDensities([], {}, prior).unlock ?? 0),
                true,
                'a Fortitude vampire raises the belief that it holds one',
            )
        },
    },
    {
        name: 'Defence: a wake card in hand makes a locked minion a defender, and only the card in hand',
        run() {
            const ring = createRing([MalkavDeck, MalkavDeck])
            const [me, predator] = ring.players
            addMinions(ring, me, [{ locked: true }])
            addMinions(ring, predator, [{ bleed: 6 }])
            me.pool = 5
            const hand = predator.hand.cards.length

            holdOnly(ring, me, [])
            expectEqual(chanceOfOust(assessAs(ring, me)), 1, 'nobody can block the bleed of 6')

            holdOnly(ring, me, [QUI_VIVE_ID])
            expectClose(
                chanceOfOust(assessAs(ring, me)),
                1 - withNone(0.08, hand),
                'the woken minion blocks unless a stealth card beats it',
            )
        },
    },
    {
        name: 'Defence: a card that wakes and gives intercept is worth as much to a minion that is already unlocked',
        run() {
            const chance = (locked: boolean, hand: string[]) => {
                const ring = createRing([BrujahDeck, BrujahDeck])
                const [me, predator] = ring.players
                addMinions(ring, me, [{ locked }])
                addMinions(ring, predator, [{ bleed: 6 }])
                me.pool = 5
                holdOnly(ring, me, hand)
                return chanceOfOust(assessAs(ring, me))
            }
            const asleep = chance(true, [ORGANIZED_RESISTANCE_ID])
            expectClose(chance(false, [ORGANIZED_RESISTANCE_ID]), asleep, 'locked or not', 1e-9)
            expectEqual(asleep < chance(false, []), true, 'the intercept needs more stealth')
        },
    },
    {
        name: 'Defence: a bounce card with a minion that can play it takes the biggest bleed that lands elsewhere',
        run() {
            // Three Methuselahs: the bleed has somewhere to go ( my prey, which is not the attacker )
            const ring = createRing([MalkavDeck, MalkavDeck, MalkavDeck])
            const [me, , predator] = ring.players
            const dominate = { [Discipline.Dominate]: DisciplineLevel.INFERIOR }
            addMinions(ring, me, [{ disciplines: dominate }, { disciplines: dominate }])
            addMinions(ring, predator, [{ bleed: 3 }, { bleed: 3 }])
            me.pool = 5

            holdOnly(ring, me, [])
            const without = chanceOfOust(assessAs(ring, me))
            holdOnly(ring, me, [DEFLECTION_ID])
            const bounce = chanceOfOust(assessAs(ring, me))
            expectEqual(bounce < without, true, 'a Deflection in hand helps')
        },
    },
    {
        name: 'Defence: with two Methuselahs left a bounce has nowhere to send the bleed, the card is dead',
        run() {
            const lunge = (decks: DeckList[], hand: string[]) => {
                const ring = createRing(decks)
                const me = ring.players[0]
                const predator = ring.players[ring.players.length - 1]
                const dominate = { [Discipline.Dominate]: DisciplineLevel.INFERIOR }
                addMinions(ring, me, [{ disciplines: dominate }, { disciplines: dominate }])
                addMinions(ring, predator, [{ bleed: 3 }, { bleed: 3 }])
                me.pool = 5
                holdOnly(ring, me, hand)
                return { ring, me, chance: chanceOfOust(assessAs(ring, me)) }
            }
            const duel = [MalkavDeck, MalkavDeck]
            const empty = lunge(duel, [])
            const held = lunge(duel, [DEFLECTION_ID])
            expectEqual(held.chance, empty.chance, 'a Deflection changes nothing in a duel')

            const table = snapshotAs(held.ring, held.me)
            expectEqual(canBounce(table), false, 'no bounce')
            expectEqual(isRoleLive(table, 'bounce'), false, 'a dead role')
            expectEqual(isRoleLive(table, 'stealth'), true, 'the other roles live')
            expectEqual(bounceTargetOf(table, table.me), null, 'nowhere to send it')

            // With three it goes to the prey of the one that bounces, which is not the attacker
            const three = lunge([MalkavDeck, MalkavDeck, MalkavDeck], [])
            const ring3 = snapshotAs(three.ring, three.me)
            expectEqual(canBounce(ring3), true, 'a bounce is possible')
            expectEqual(isRoleLive(ring3, 'bounce'), true, 'a live role')
            const { prey, predator } = ring3
            if (!prey || !predator) {
                throw new ScenarioFailure('No prey or predator')
            }
            expectEqual(
                bounceTargetOf(ring3, prey)?.oid,
                predator.oid,
                'my prey sends it to its prey, my predator',
            )
            expectEqual(bounceTargetOf(ring3, ring3.me)?.oid, prey.oid, 'I send it to my prey')
        },
    },
    {
        name: 'Opportunity: a bleed of mine that my prey bounces lands on its own prey, with a baron or Dominate to play it, and never with two left',
        run() {
            const bounced = (decks: DeckList[], reactor: MinionSetup, title = '') => {
                const ring = createRing(decks)
                const [me, prey, other] = ring.players
                addMinions(ring, me, [
                    {
                        bleed: 2,
                        disciplines: { [Discipline.Obfuscate]: DisciplineLevel.INFERIOR },
                    },
                ])
                const [vampire] = addMinions(ring, prey, [reactor])
                vampire.vampireAttrs.title = title
                // My stealth card lands the bleed past the reactor, which stays unlocked: it may bounce
                holdOnly(ring, me, [LOST_IN_CROWDS_ID])
                return { opportunity: assessAs(ring, me).opportunity[prey.oid], other }
            }
            const trio = [MalkavDeck, MalkavDeck, MalkavDeck]
            const dominate = { disciplines: { [Discipline.Dominate]: DisciplineLevel.INFERIOR } }

            const plain = bounced(trio, {})
            expectEqual(plain.opportunity.chanceOfBounce, 0, 'nobody can play a bounce')
            expectEqual(plain.opportunity.drain, 2, 'the bleed lands')

            const dom = bounced(trio, dominate)
            expectEqual(dom.opportunity.chanceOfBounce > 0, true, 'Dominate may bounce')
            expectEqual(dom.opportunity.bounceTarget, dom.other.oid, 'onto the prey of my prey')
            expectClose(
                dom.opportunity.drain + dom.opportunity.bounced,
                2,
                'what does not hit my prey is bounced',
                1e-9,
            )

            const baron = bounced(trio, {}, 'baron')
            expectEqual(baron.opportunity.chanceOfBounce > 0, true, 'a baron may bounce')

            const duel = bounced([MalkavDeck, MalkavDeck], dominate)
            expectEqual(duel.opportunity.chanceOfBounce, 0, 'no bounce in a duel')
            expectEqual(duel.opportunity.bounceTarget, null, 'no target')
            expectEqual(duel.opportunity.drain, 2, 'the bleed lands')
        },
    },
    {
        name: 'Capabilities: a baron and a superior Auspex raise the bounce a Methuselah is believed to hold',
        run() {
            const prior = DEFAULT_PROFILE.opponentPrior
            const bounceOf = (minions: Partial<Disciplines>[], titles: string[] = []) =>
                roleDensities(minions, {}, prior, titles).bounce ?? 0
            const base = bounceOf([])
            expectClose(base, 0.04, 'nothing shown')
            expectClose(bounceOf([{}], ['baron']), 1 - (1 - base) * (1 - 0.04 * 0.5), 'a baron')
            expectClose(bounceOf([{}], ['']), base, 'no title', 1e-9)
            expectClose(
                bounceOf([{ [Discipline.Auspex]: DisciplineLevel.INFERIOR }]),
                base,
                'inferior Auspex has none',
                1e-9,
            )
            expectEqual(
                bounceOf([{ [Discipline.Auspex]: DisciplineLevel.SUPERIOR }]) > base,
                true,
                'superior Auspex has some',
            )
        },
    },
    {
        name: 'Opportunity: a stealth card in hand flips the block of the prey, the drain is the bleed',
        run() {
            const ring = createRing([MalkavDeck, MalkavDeck])
            const [me, prey] = ring.players
            addMinions(ring, me, [
                { disciplines: { [Discipline.Obfuscate]: DisciplineLevel.INFERIOR } },
            ])
            addMinions(ring, prey, [{}])

            holdOnly(ring, me, [])
            const blocked = assessAs(ring, me).opportunity[prey.oid]
            expectEqual(blocked.drain, 0, 'the unlocked prey blocks')
            expectEqual(blocked.blockedShare, 1, 'every action')

            holdOnly(ring, me, [LOST_IN_CROWDS_ID])
            const stealthy = assessAs(ring, me).opportunity[prey.oid]
            expectEqual(stealthy.drain, 1, 'the bleed lands')
            expectEqual(stealthy.blockedShare, 0, 'nothing is blocked')
        },
    },
    {
        name: 'Threat is a matchup: the fighters of the other are a danger to minions they beat and only when my actions get blocked',
        run() {
            const fight = (mine: MinionSetup, hand: string[]) => {
                const ring = createRing([MalkavDeck, MalkavDeck])
                const [me, other] = ring.players
                addMinions(ring, me, [mine])
                addMinions(ring, other, [{ strength: 3, blood: 7 }])
                holdOnly(ring, me, hand)
                return assessAs(ring, me).threat[other.oid].combat
            }
            const weak = { blood: 3 }
            const obfuscate = { [Discipline.Obfuscate]: DisciplineLevel.INFERIOR }

            const { plan, combat } = DEFAULT_PROFILE
            expectClose(
                fight(weak, []),
                plan.bloodValue * (3 - combat.credit * 1),
                'a fight it wins: my 3 blood against the 1 I deal, my action is blocked',
                0.01,
            )
            expectEqual(
                fight({ blood: 8, strength: 8 }, []),
                0,
                'a minion that puts it in torpor is not at risk',
            )
            expectEqual(
                fight({ ...weak, disciplines: obfuscate }, [LOST_IN_CROWDS_ID]),
                0,
                'my stealth keeps me out of its fights',
            )
        },
    },
    {
        name: 'Stakes: the weight of my predator falls when the Methuselah that would replace it is the bigger danger',
        run() {
            const weightOf = (successorBleeds: number[]) => {
                const ring = createRing([GovernDeck, GovernDeck, GovernDeck])
                const [me, successor, predator] = ring.players
                addMinions(ring, predator, [{ bleed: 1 }])
                addMinions(
                    ring,
                    successor,
                    successorBleeds.map(bleed => ({ bleed })),
                )
                me.pool = 20
                return assessAs(ring, me).stakes[predator.oid].weight
            }
            const weak = weightOf([1])
            const strong = weightOf([2, 2, 2])
            expectEqual(strong < weak, true, 'a worse predator would come after it')
            expectEqual(strong < DEFAULT_PROFILE.ringPrior.predator, true, 'below the ring prior')
            expectEqual(
                strong >= DEFAULT_PROFILE.stakes.floor * DEFAULT_PROFILE.ringPrior.predator,
                true,
                'never below the floor',
            )
        },
    },
    {
        name: 'Stakes: of two Methuselahs that are neither my prey nor my predator, the strongest of the table weighs more',
        run() {
            const ring = createRing([GovernDeck, GovernDeck, GovernDeck, GovernDeck, GovernDeck])
            const [me, , big, small] = ring.players
            addMinions(ring, big, [{}, {}, {}, {}])
            addMinions(ring, small, [{}])
            const stakes = assessAs(ring, me).stakes
            expectEqual(stakes[big.oid].ring, stakes[small.oid].ring, 'same place in the ring')
            expectEqual(stakes[big.oid].leader > 0, true, 'it leads the table')
            expectEqual(stakes[big.oid].weight > stakes[small.oid].weight, true, 'it weighs more')
        },
    },
    {
        name: 'Torpor: a predator with every vampire in torpor is a menace when a helper can rescue them, and nothing when it has no helper',
        run() {
            const threatOf = (decks: DeckList[]) => {
                const ring = createRing(decks)
                const me = ring.players[0]
                const predator = ring.players[ring.players.length - 1]
                const vampires = addMinions(ring, predator, [{ bleed: 3 }, { bleed: 3 }])
                for (const vampire of vampires) {
                    ring.gameState.moveCardToRegion(vampire, predator.torpor)
                }
                // The others have minions able to pay the rescue
                for (const other of ring.players.slice(1, -1)) {
                    addMinions(ring, other, [{ blood: 5 }])
                }
                me.pool = 1
                return assessAs(ring, me)
            }
            // With three, the other one is the predator of my predator: it will not help it
            const alone = threatOf([GovernDeck, GovernDeck, GovernDeck])
            expectEqual(alone.rescues.length, 2, 'two torpid vampires')
            expectEqual(
                alone.rescues.every(opening => opening.chance == 0),
                true,
                'no helper',
            )
            expectEqual(chanceOfOust(alone), 0, 'no ouster')

            // With four, my prey is neither the prey nor the predator of my predator
            const helped = threatOf([GovernDeck, GovernDeck, GovernDeck, GovernDeck])
            const predator = helped.table.predator
            if (!predator) {
                throw new ScenarioFailure('No predator')
            }
            expectEqual(helped.threat[predator.oid].total > 0, true, 'a menace')
            const chance = DEFAULT_PROFILE.helpers.rescueChance
            expectClose(helped.rescues[0].chance, chance, 'chance of one rescue')
            // The pool is 1: any bleed that lands ousts me, one of the two vampires back is enough
            expectClose(chanceOfOust(helped), 1 - (1 - chance) ** 2, 'at least one is back')
        },
    },
    {
        name: 'Torpor: a helper that cannot pay the blood does not rescue, one that is poor lets the vampire pay the rest',
        run() {
            const rescueOf = (helperBlood: number | null, vampireBlood: number) => {
                const ring = createRing([GovernDeck, GovernDeck, GovernDeck, GovernDeck])
                const [me, helper, , predator] = ring.players
                const [vampire] = addMinions(ring, predator, [{ bleed: 3, blood: vampireBlood }])
                ring.gameState.moveCardToRegion(vampire, predator.torpor)
                if (helperBlood !== null) {
                    addMinions(ring, helper, [{ blood: helperBlood }])
                }
                return assessAs(ring, me).rescues[0]
            }
            expectEqual(rescueOf(null, 5).chance, 0, 'the helper has no minion')
            expectEqual(rescueOf(0, 1).chance, 0, 'not enough blood between the two')
            expectEqual(rescueOf(0, 5).chance > 0, true, 'the vampire pays all of it')
            expectEqual(rescueOf(1, 1).chance > 0, true, 'one blood each')
        },
    },
    {
        name: 'Torpor: rescuing the vampire of my predator is worth less than nothing, one that bleeds a Methuselah I want drained is worth something, so is one of mine',
        run() {
            const ring = createRing([GovernDeck, GovernDeck, GovernDeck, GovernDeck])
            const [me, , other, predator] = ring.players
            const [mine] = addMinions(ring, me, [{ bleed: 2 }])
            const [theirs] = addMinions(ring, other, [{ bleed: 2 }])
            const [menace] = addMinions(ring, predator, [{ bleed: 2 }])
            for (const [vampire, owner] of [
                [mine, me],
                [theirs, other],
                [menace, predator],
            ] as const) {
                ring.gameState.moveCardToRegion(vampire, owner.torpor)
            }
            const openings = assessAs(ring, me).rescues
            const valueOf = (vampire: Vampire) => {
                const opening = openings.find(candidate => candidate.vampire.oid == vampire.oid)
                if (!opening) {
                    throw new ScenarioFailure(`No rescue opening for ${vampire.name}`)
                }
                return opening.value
            }
            expectEqual(valueOf(menace) < 0, true, 'it would bleed me')
            // The vampire of `other` bleeds my predator, which is the Methuselah that bleeds me
            expectEqual(valueOf(theirs) > 0, true, 'it bleeds the Methuselah that bleeds me')
            expectEqual(valueOf(mine) > 0, true, 'it would bleed my prey')
        },
    },
    {
        name: 'Turn: ousting my prey gives me the pool to swallow the lunge of my predator, so sending every minion is the safer play',
        run() {
            const ring = createRing([GovernDeck, GovernDeck, GovernDeck])
            const [me, prey, predator] = ring.players
            const mine = addMinions(ring, me, [{ bleed: 2 }, { bleed: 2 }, { bleed: 2 }])
            addMinions(ring, predator, [{ bleed: 2 }, { bleed: 2 }, { bleed: 2 }])
            holdOnly(ring, me, [])
            me.pool = 5
            prey.pool = 6
            const assessment = assessAs(ring, me)
            const minions = assessment.table.me.minions.filter(minion =>
                mine.some(vampire => vampire.oid == minion.oid),
            )
            expectEqual(minions.length, 3, 'my three minions, as the view shows them')

            // Everybody home: the lunge of 6 against 5 ousts me
            const home = outcomeOfTurn(assessment, { actors: [], reserved: minions })
            expectEqual(home.chanceToOust, 0, 'nobody sent')
            expectEqual(home.chanceOfBeingOusted < 1, true, 'my blockers hold some of it')

            // All three sent: 6 bleeds finish the prey, and the 6 pool gained out of reach of any hand
            const all = outcomeOfTurn(assessment, { actors: minions, reserved: [] })
            expectEqual(all.chanceToOust, 1, 'the prey is finished')
            expectEqual(all.chanceOfBeingOusted, 0, 'the pool gained swallows the lunge')
            expectEqual(OUST_POOL_GAIN > 0, true, 'the gain is the one of the game')

            // One short of the blow: nothing gained, and no blockers left
            const short = outcomeOfTurn(assessment, { actors: minions.slice(0, 2), reserved: [] })
            expectEqual(short.chanceToOust < 1, true, 'four bleeds do not finish it')
            expectEqual(short.chanceOfBeingOusted > 0.9, true, 'and I am exposed')
        },
    },
    {
        name: 'Assessment: through the view it is the one of the live game, and it prints',
        run() {
            const ring = createRing([GovernDeck, GovernDeck, GovernDeck])
            const [me, prey, predator] = ring.players
            addMinions(ring, me, [{}, {}])
            addMinions(ring, prey, [{}])
            addMinions(ring, predator, [{ bleed: 2 }, { bleed: 2 }])
            const parts = (assessment: Assessment) =>
                JSON.stringify([
                    assessment.densities,
                    assessment.power,
                    assessment.threat,
                    assessment.opportunity,
                    assessment.stakes,
                    assessment.rescues,
                ])
            const live = parts(assess(ring.gameState, me))
            expectEqual(parts(assessAs(ring, me)), live, 'the hands of the others were not read')

            const lines = describeAssessment(assessAs(ring, me)).join('\n')
            for (const player of ring.players) {
                expectEqual(lines.includes(player.name), true, `${player.name} is described`)
            }
        },
    },
    {
        name: 'Combat position: the stronger minion loses less, and the same fight is judged the same',
        run() {
            const ring = createRing([AttachDeck, AttachDeck])
            const [me] = ring.players
            const [strong, weak] = addMinions(ring, me, [
                { strength: 3, blood: 6 },
                { strength: 1, blood: 6 },
            ])
            const fighter = (minion: Minion): Fighter => ({
                profile: profileMinion(minion),
                pool: 5,
                hand: { cards: [] },
            })
            const before = forecastFight(fighter(strong), fighter(weak), DEFAULT_PROFILE)
            expectEqual(before.acting.loss < before.defending.loss, true, 'the stronger loses less')
            const mirrored = forecastFight(fighter(weak), fighter(strong), DEFAULT_PROFILE)
            expectEqual(
                mirrored.defending.loss,
                before.acting.loss,
                'whoever acts, the same fight costs the same',
            )
            expectEqual(
                JSON.stringify(forecastFight(fighter(strong), fighter(weak), DEFAULT_PROFILE)),
                JSON.stringify(before),
                'judged twice, judged the same',
            )
            attachInPlay(findAnyCard(me, GUARDIAN_ANGEL_ID), weak)
            expectEqual(
                forecastFight(fighter(strong), fighter(weak), DEFAULT_PROFILE).defending.loss <
                    before.defending.loss,
                true,
                'prevention takes damage off the loss',
            )
        },
    },
]

/**
 * Turn plan: who stays unlocked to defend, who acts and with what. The
 * boards are small and the hands controlled, so the choice reads off the numbers of the plan.
 */

// The minion phase decision of `me`, as the referee offers it
function minionDecisionOf(ring: Ring, me: Player): DecisionPoint {
    const { gameState } = ring
    gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Minion)
    gameState.turnResources.unlocked = true
    gameState.activePlayerIndex = gameState.competingPlayers.indexOf(me)
    const decision = getDecisionPoint(gameState, me)
    if (decision?.kind != DecisionKind.Minion) {
        throw new ScenarioFailure('No minion phase decision')
    }
    return decision
}

// The plan the utility bot makes for `me`, through its view, with the cards it cannot value left out
function planAs(
    ring: Ring,
    me: Player,
    options: { profile?: BotProfile; unlockCards?: number } = {},
): TurnPlan {
    const decision = minionDecisionOf(ring, me)
    const view = createPlayerView(ring.gameState, me)
    try {
        const viewDecision = getDecisionPoint(view.gameState, view.player)
        if (!viewDecision) {
            throw new ScenarioFailure('No decision in the view')
        }
        return planTurn({
            assessment: assess(view.gameState, view.player, options.profile ?? DEFAULT_PROFILE),
            candidates: optionsOfType(viewDecision.options, 'declareAction')
                .map(candidateOf)
                .filter(candidate => candidate.kind != 'other'),
            mandatory: !decision.options.some(option => option.type == 'endPhase'),
            unlockCards: options.unlockCards ?? 0,
        })
    } finally {
        view.dispose()
    }
}

// The option the utility agent chooses at the minion phase of `me`
function chooseAs(ring: Ring, me: Player, profile: BotProfile = DEFAULT_PROFILE): BotOption {
    return chooseThroughView(minionDecisionOf(ring, me), new UtilityAgent(GovernDeck, profile))
}

// Plays the minion phase of `me` with the utility agent until it ends it ( nobody blocks or reacts )
function playMinionPhase(ring: Ring, me: Player): BotOption[] {
    const agent = new UtilityAgent(GovernDeck)
    const passive = new PassiveAgent()
    const chosen: BotOption[] = []
    for (let step = 0; step < 60; step++) {
        const deciding = getDecidingPlayer(ring.gameState)
        if (!deciding) {
            throw new ScenarioFailure('Nobody decides')
        }
        if (deciding != me) {
            stepBot(deciding, passive)
            continue
        }
        const decision = getDecisionPoint(ring.gameState, me)
        if (!decision) {
            throw new ScenarioFailure('No decision')
        }
        if (decision.kind != DecisionKind.Minion) {
            stepBot(me, passive)
            continue
        }
        const option = chooseThroughView(decision, agent)
        chosen.push(option)
        if (option.type == 'endPhase') {
            return chosen
        }
        applyOption(decision, option)
    }
    throw new ScenarioFailure('The minion phase does not end')
}

const unlockedOf = (me: Player) => me.minionsReadyUnlocked.map(minion => minion.oid).toSorted()

const isAction = (option: BotOption, type: MinionActionType) =>
    option.type == 'declareAction' && option.action.type == type

type HelperSetup = {
    mineBleed?: number
    torpidBlood?: number
    torpidBleed?: number
    // Ready vampires of the owner, all with a bleed of 4
    ready?: number
    ownerPool?: number
    // Vampires of the predator of the owner ( my prey ) that bleed the owner
    bleeders?: number
    // Vampires of my predator, which bleed me
    menace?: number
}

// Four Methuselahs: I have one minion, `other` has a torpid vampire and bleeds my predator, which is
// the Methuselah that bleeds me
function helperBoard(setup: HelperSetup = {}) {
    const ring = createRing([GovernDeck, GovernDeck, GovernDeck, GovernDeck])
    const [me, prey, other, predator] = ring.players
    addMinions(ring, me, [{ bleed: setup.mineBleed ?? 1, blood: 5 }])
    const [torpid] = addMinions(ring, other, [
        { bleed: setup.torpidBleed ?? 4, blood: setup.torpidBlood ?? 5 },
    ])
    ring.gameState.moveCardToRegion(torpid, other.torpor)
    addMinions(
        ring,
        other,
        Array.from({ length: setup.ready ?? 1 }, () => ({ bleed: 4, blood: 5 })),
    )
    addMinions(
        ring,
        predator,
        Array.from({ length: setup.menace ?? 1 }, () => ({ bleed: 2 })),
    )
    addMinions(
        ring,
        prey,
        Array.from({ length: setup.bleeders ?? 0 }, () => ({ bleed: 2 })),
    )
    other.pool = setup.ownerPool ?? other.pool
    holdOnly(ring, me, [])
    const opening = assessAs(ring, me).rescues.find(rescue => rescue.vampire.oid == torpid.oid)
    if (!opening) {
        throw new ScenarioFailure('No rescue opening')
    }
    return { ring, me, torpid, opening, plan: () => planAs(ring, me) }
}

const PLAN_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'Turn plan: the last unlocked minion stays home against a predator with a big bleed, and bleeds when nothing is to fear',
        run() {
            const board = (predatorBleeds: number[]) => {
                const ring = createRing([GovernDeck, GovernDeck, GovernDeck])
                const [me, , predator] = ring.players
                addMinions(ring, me, [{ bleed: 2 }])
                addMinions(
                    ring,
                    predator,
                    predatorBleeds.map(bleed => ({ bleed })),
                )
                holdOnly(ring, me, [])
                me.pool = 8
                return { ring, me }
            }
            const afraid = board([4, 4])
            const home = planAs(afraid.ring, afraid.me)
            expectEqual(home.actions.length, 0, 'it does nothing')
            expectEqual(home.reserved.length, 1, 'the minion stays unlocked')
            expectEqual(
                chooseAs(afraid.ring, afraid.me).type,
                'endPhase',
                'the agent ends the phase',
            )
            const kept = home.cases[home.chosen]
            const sent = home.cases[1 - home.chosen]
            expectEqual(
                kept.chanceOfBeingOusted < sent.chanceOfBeingOusted,
                true,
                'the other way I am more exposed',
            )

            const calm = board([])
            const out = planAs(calm.ring, calm.me)
            expectEqual(out.actions[0]?.kind, 'bleed', 'it bleeds')
            expectEqual(out.reserved.length, 0, 'nobody is kept')
            expectEqual(
                isAction(chooseAs(calm.ring, calm.me), MinionActionType.Bleed),
                true,
                'the agent declares the bleed',
            )
        },
    },
    {
        name: 'Turn plan: a vampire without blood must hunt, whatever the table',
        run() {
            const ring = createRing([GovernDeck, GovernDeck, GovernDeck])
            const [me, , predator] = ring.players
            addMinions(ring, me, [{ blood: 0 }])
            addMinions(ring, predator, [{ bleed: 4 }, { bleed: 4 }])
            me.pool = 3
            const plan = planAs(ring, me)
            expectEqual(plan.posture, 'forced', 'forced')
            expectEqual(plan.actions[0]?.kind, 'hunt', 'a hunt')
            expectEqual(
                isAction(chooseAs(ring, me), MinionActionType.Hunt),
                true,
                'the agent hunts',
            )
        },
    },
    {
        name: 'Turn plan: a wake card lets a locked minion defend, so the unlocked one can act',
        run() {
            const board = (hand: string[]) => {
                const ring = createRing([MalkavDeck, MalkavDeck, MalkavDeck])
                const [me, , predator] = ring.players
                addMinions(ring, me, [{ locked: true }, { bleed: 2 }])
                addMinions(ring, predator, [{ bleed: 3 }])
                holdOnly(ring, me, hand)
                me.pool = 8
                return { ring, me }
            }
            // How much better it is to keep the unlocked minion home than to send it
            const margin = (plan: TurnPlan) => plan.cases[0].equity - plan.cases[1].equity
            const without = board([])
            const withCard = board([QUI_VIVE_ID])
            const bare = planAs(without.ring, without.me)
            const woken = planAs(withCard.ring, withCard.me)
            expectEqual(bare.cases.length, 2, 'keep it, or send it')
            expectEqual(
                margin(woken) < margin(bare),
                true,
                `the card takes the place of the minion at home ( ${margin(woken)} against ${margin(bare)} )`,
            )
            expectEqual(bare.reserved.length, 1, 'without the card it stays')
            expectEqual(woken.reserved.length, 0, 'with the card it acts')
            expectEqual(woken.actions[0]?.kind, 'bleed', 'it bleeds')
        },
    },
    {
        name: 'Turn plan: when my prey can be finished every minion is sent, the pool it gives swallows the lunge',
        run() {
            const ring = createRing([GovernDeck, GovernDeck, GovernDeck])
            const [me, prey, predator] = ring.players
            addMinions(ring, me, [{ bleed: 2 }, { bleed: 2 }, { bleed: 2 }])
            addMinions(ring, predator, [{ bleed: 2 }, { bleed: 2 }, { bleed: 2 }])
            holdOnly(ring, me, [])
            me.pool = 5
            prey.pool = 6
            const plan = planAs(ring, me)
            expectEqual(plan.posture, 'lunge', 'a lunge')
            expectEqual(plan.reserved.length, 0, 'nobody is kept')
            expectEqual(
                plan.actions.filter(action => action.kind == 'bleed').length,
                3,
                'three bleeds',
            )
            expectEqual(plan.cases[plan.chosen].chanceToOust, 1, 'the prey is finished')
            expectEqual(
                plan.cases[plan.chosen].chanceOfBeingOusted,
                0,
                'and the lunge does not reach',
            )
        },
    },
    {
        name: 'Turn plan: an unlock card lets the last minion bleed and still defend',
        run() {
            const ring = createRing([GovernDeck, GovernDeck, GovernDeck])
            const [me, , predator] = ring.players
            addMinions(ring, me, [{ bleed: 2 }])
            addMinions(ring, predator, [{ bleed: 4 }, { bleed: 4 }])
            holdOnly(ring, me, [])
            me.pool = 8
            const without = planAs(ring, me)
            expectEqual(without.actions.length, 0, 'without the card it stays home')
            const withCard = planAs(ring, me, { unlockCards: 1 })
            expectEqual(withCard.actions[0]?.kind, 'bleed', 'with it, it bleeds')
            expectEqual(withCard.cases[withCard.chosen].unlocked.length, 1, 'and stays a blocker')
            expectEqual(withCard.reserved.length, 0, 'nobody is kept back')
            expectClose(
                withCard.cases[withCard.chosen].chanceOfBeingOusted,
                without.cases[without.chosen].chanceOfBeingOusted,
                'the defence is the same as at home',
                1e-9,
            )
        },
    },
    {
        name: 'Turn plan: the small bleeds go first when the prey may bounce, the big one first otherwise',
        run() {
            const obfuscate = { [Discipline.Obfuscate]: DisciplineLevel.INFERIOR }
            const ring = createRing([MalkavDeck, MalkavDeck, MalkavDeck])
            const [me, prey] = ring.players
            addMinions(ring, me, [
                { bleed: 3, disciplines: obfuscate },
                { bleed: 1, disciplines: obfuscate },
            ])
            const dominate = { disciplines: { [Discipline.Dominate]: DisciplineLevel.INFERIOR } }
            addMinions(ring, prey, [dominate, dominate, dominate])
            holdOnly(ring, me, [LOST_IN_CROWDS_ID, CLOAK_ID])
            const order = (profile: BotProfile) =>
                planAs(ring, me, { profile })
                    .actions.filter(action => action.kind == 'bleed')
                    .map(action => action.actor.bleed)
                    .join()
            const risk = planAs(ring, me).bounceRisk
            expectEqual(risk > 0, true, 'the prey may bounce')
            const bait = (above: number): BotProfile => ({
                ...DEFAULT_PROFILE,
                plan: { ...DEFAULT_PROFILE.plan, baitAbove: above },
            })
            expectEqual(order(bait(risk / 2)), '1,3', 'bait: the small one first')
            expectEqual(order(bait(risk * 2)), '3,1', 'no bait: the big one first')
        },
    },
    {
        name: 'Turn plan: a minion keeps clear of a prey whose blocker would win the fight, and bleeds when it cannot block',
        run() {
            const board = (blockerLocked: boolean) => {
                const ring = createRing([GovernDeck, GovernDeck, GovernDeck])
                const [me, prey] = ring.players
                addMinions(ring, me, [{ bleed: 2, strength: 1, blood: 2 }])
                addMinions(ring, prey, [
                    { strength: 5, blood: 8, intercept: 1, locked: blockerLocked },
                ])
                holdOnly(ring, me, [])
                return { ring, me }
            }
            const blocked = board(false)
            expectEqual(
                planAs(blocked.ring, blocked.me).actions.filter(action => action.kind == 'bleed')
                    .length,
                0,
                'it waits',
            )
            const open = board(true)
            expectEqual(planAs(open.ring, open.me).actions[0]?.kind, 'bleed', 'it bleeds')
        },
    },
    {
        name: 'Turn plan: a torpid vampire of mine leaves torpor, a rescue is made only for a vampire that is worth it',
        run() {
            const ring = createRing([GovernDeck, GovernDeck, GovernDeck, GovernDeck])
            const [me, , other, predator] = ring.players
            const [mine] = addMinions(ring, me, [
                { bleed: 0, blood: 5 },
                { bleed: 0, blood: 5 },
            ])
            const [theirs] = addMinions(ring, other, [{ bleed: 2, blood: 3 }])
            const [menace] = addMinions(ring, predator, [{ bleed: 2, blood: 3 }])
            ring.gameState.moveCardToRegion(theirs, other.torpor)
            ring.gameState.moveCardToRegion(menace, predator.torpor)
            holdOnly(ring, me, [])
            const plan = planAs(ring, me)
            const targets = plan.actions.flatMap(action =>
                action.option.action.type == MinionActionType.RescueFromTorpor ?
                    [action.option.action.target.oid]
                :   [],
            )
            expectEqual(
                targets.includes(theirs.oid),
                true,
                'the vampire of the one that bleeds my predator',
            )
            expectEqual(targets.includes(menace.oid), false, 'never the vampire of my predator')

            // Mine, in torpor with the blood to leave it
            ring.gameState.moveCardToRegion(mine, me.torpor)
            mine.blood = 4
            expectEqual(planAs(ring, me).actions[0]?.kind, 'leaveTorpor', 'it leaves torpor first')
        },
    },
    {
        name: 'Turn plan: a rescue of the vampire of the one that bleeds my predator is made when it beats the minion bleeding, and is worth more the harder that vampire bleeds',
        run() {
            const board = (mineBleed: number, theirBleed: number) => {
                const ring = createRing([GovernDeck, GovernDeck, GovernDeck, GovernDeck])
                const [me, , other, predator] = ring.players
                addMinions(ring, me, [{ bleed: mineBleed, blood: 5 }])
                const [theirs] = addMinions(ring, other, [
                    { bleed: theirBleed, blood: 5 },
                    { bleed: theirBleed, blood: 5 },
                ])
                ring.gameState.moveCardToRegion(theirs, other.torpor)
                addMinions(ring, predator, [{ bleed: 2 }])
                holdOnly(ring, me, [])
                const plan = planAs(ring, me)
                const opening = assessAs(ring, me).rescues.find(
                    rescue => rescue.vampire.oid == theirs.oid,
                )
                if (!opening) {
                    throw new ScenarioFailure('No rescue opening')
                }
                const rescues = plan.actions.filter(action => action.kind == 'rescue')
                return { plan, value: opening.value, rescues, theirs }
            }
            const weak = board(1, 2)
            const middle = board(1, 4)
            const strong = board(1, 6)
            expectEqual(
                weak.value < middle.value && middle.value < strong.value,
                true,
                `the harder it bleeds the more it is worth ( ${weak.value}, ${middle.value}, ${strong.value} )`,
            )
            expectEqual(
                strong.plan.actions[0]?.kind,
                'rescue',
                'a weak bleed gives way to a rescue',
            )
            const target =
                strong.rescues[0]?.option.action.type == MinionActionType.RescueFromTorpor ?
                    strong.rescues[0].option.action.target.oid
                :   null
            expectEqual(target, strong.theirs.oid, 'the torpid vampire is the one rescued')

            // A bleed of 3 on my prey is worth more than that rescue
            const bleeding = board(3, 6)
            expectEqual(bleeding.plan.actions[0]?.kind, 'bleed', 'a good bleed is kept')
            expectEqual(bleeding.rescues.length, 0, 'no rescue then')
        },
    },
    {
        name: 'Rescue worth: a vampire with blood and equipment is worth more, one that comes back with no blood is worth less',
        run() {
            const poor = helperBoard({ torpidBlood: 2 }).opening
            const rich = helperBoard({ torpidBlood: 8 }).opening
            expectEqual(
                rich.value > poor.value,
                true,
                `blood ( ${poor.value} for 2, ${rich.value} for 8 )`,
            )

            // Flat equipment: each attached card adds, up to the maximum of the profile
            const equip = (cards: number) =>
                returnWorth(
                    {
                        ...rich,
                        vampire: {
                            ...rich.vampire,
                            attached: Array.from({ length: cards }, () => 'card'),
                        },
                    },
                    rich.vampire.blood,
                    DEFAULT_PROFILE,
                )
            expectEqual(equip(1) > equip(0) && equip(2) > equip(1), true, 'equipment')
            expectEqual(
                equip(9),
                equip(DEFAULT_PROFILE.helpers.equipmentMax),
                'the flat value stops',
            )

            // Back with no blood: it must hunt first, and keeps a share of its worth
            const hungry = returnWorth(rich, 0, DEFAULT_PROFILE)
            const fed = returnWorth(rich, 1, DEFAULT_PROFILE)
            expectEqual(hungry < fed, true, 'it hunts first')
            expectEqual(hungry > 0, true, 'but it is back')
            expectEqual(
                helperBoard({ torpidBlood: 0 }).opening.value <
                    helperBoard({ torpidBlood: 1 }).opening.value,
                true,
                'an empty vampire in the table',
            )
        },
    },
    {
        name: 'Rescue worth: a Methuselah that is about to be ousted, or that has many other minions, is worth helping less',
        run() {
            const base = helperBoard({ bleeders: 2 }).opening
            expectClose(base.survival, 1, 'the pool of the owner is not at stake', 1e-9)

            const doomed = helperBoard({ bleeders: 2, ownerPool: 1 }).opening
            expectEqual(doomed.survival < 0.2, true, `the owner is finished ( ${doomed.survival} )`)
            expectEqual(
                Math.abs(doomed.value) < base.value / 3,
                true,
                `so is its vampire ( ${doomed.value} against ${base.value} )`,
            )

            const alone = helperBoard({ ready: 0 }).opening
            const crowded = helperBoard({ ready: 3 }).opening
            expectEqual(
                crowded.value < alone.value / 2,
                true,
                `many minions already ( ${crowded.value} against ${alone.value} )`,
            )
        },
    },
    {
        name: 'Rescue worth: the rescuer pays the cost when the vampire has little blood, so it comes back able to bleed',
        run() {
            const full = helperBoard({
                mineBleed: 0,
                ready: 0,
                menace: 0,
                torpidBleed: 6,
                torpidBlood: 8,
            })
            const paidBy = (board: ReturnType<typeof helperBoard>) => {
                const rescue = board.plan().actions.find(action => action.kind == 'rescue')
                return rescue?.option.action.type == MinionActionType.RescueFromTorpor ?
                        (rescue.option.action.bloodPaidByActingMinion ?? 0)
                    :   null
            }
            expectEqual(paidBy(full), 0, 'a vampire with blood pays all of it')

            const low = helperBoard({
                mineBleed: 0,
                ready: 0,
                menace: 0,
                torpidBleed: 6,
                torpidBlood: 1,
            })
            expectEqual(paidBy(low), 2, 'with 1 blood left it would have to hunt: the rescuer pays')
        },
    },
    {
        name: 'Turn plan: the minion phase played by the agent ends with the minions the plan keeps unlocked',
        run() {
            const ring = createRing([GovernDeck, GovernDeck, GovernDeck])
            const [me, , predator] = ring.players
            addMinions(ring, me, [{ bleed: 2 }, { bleed: 2 }, { bleed: 2 }])
            addMinions(ring, predator, [{ bleed: 3 }, { bleed: 3 }])
            holdOnly(ring, me, [])
            me.pool = 7
            const first = planAs(ring, me)
            const kept = first.reserved.map(minion => minion.oid).toSorted()
            expectEqual(kept.length > 0 && kept.length < 3, true, 'a part of them is kept')
            const options = playMinionPhase(ring, me)
            expectEqual(options.at(-1)?.type, 'endPhase', 'the phase ends')
            expectEqual(unlockedOf(me).join(), kept.join(), 'the ones the plan kept are unlocked')
            expectEqual(
                options.filter(option => option.type == 'declareAction').length,
                3 - kept.length,
                'the others acted',
            )
        },
    },
    {
        name: 'Turn plan: it prints, and a plan is a function of the view',
        run() {
            const ring = createRing([GovernDeck, GovernDeck, GovernDeck])
            const [me, , predator] = ring.players
            addMinions(ring, me, [{ bleed: 2 }, { bleed: 1 }])
            addMinions(ring, predator, [{ bleed: 2 }])
            const lines = describeTurnPlan(planAs(ring, me)).join('\n')
            expectEqual(lines.includes('equity'), true, 'the reserves are described')
            expectEqual(
                describeTurnPlan(planAs(ring, me)).join('\n'),
                lines,
                'the same view makes the same plan',
            )
        },
    },
]

/**
 * Bloat: what each Methuselah takes back from the blood bank, and what it
 * changes in the plan. The prey and the others hold no card in hand, so the believed income is 0 and the
 * numbers can be worked out by hand.
 */

const dollOn = (vampire: Vampire) =>
    attachInPlay(findAnyCard(vampire.controller, BLOOD_DOLL_ID), vampire)

// Every Methuselah is worth its place in the ring: the stake of the prey is 1
const FLAT_STAKES: BotProfile = {
    ...DEFAULT_PROFILE,
    stakes: { ...DEFAULT_PROFILE.stakes, dangerGain: 0, leaderGain: 0, usefulGain: 0 },
}

const minionOf = (assessment: Assessment, vampire: Vampire) => {
    const found = assessment.table.me.minions.find(minion => minion.oid == vampire.oid)
    if (!found) {
        throw new ScenarioFailure(`No profile for ${vampire.name}`)
    }
    return found
}

const BLOAT_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'Bloat: what is in play is public, a Blood Doll carries the blood of its vampire to the pool and a hunting ground puts blood back',
        run() {
            const ring = createRing([AttachDeck, AttachDeck, AttachDeck])
            const [me, prey] = ring.players
            holdOnly(ring, me, [])
            emptyHand(ring.gameState, prey)
            const [theirs] = addMinions(ring, prey, [{ blood: 1, locked: true }])
            theirs.minionAttrs.capacity = 6
            const bloat = () => assessAs(ring, me).bloat[prey.oid]
            expectEqual(bloat().pool + bloat().blood, 0, 'nothing in play, nothing regained')

            dollOn(theirs)
            expectEqual(bloat().pool, 0, 'a vampire does not give the blood it keeps')
            theirs.blood = 3
            expectClose(
                bloat().pool,
                1 / 3,
                'one blood above it, spread over the turns looked ahead',
            )
            theirs.blood = 5
            expectClose(bloat().pool, 1, 'a Doll moves one blood a turn')
            expectEqual(bloat().blood, 0, 'and puts none back')

            theirs.blood = 1
            ring.gameState.moveCardToRegion(findAnyCard(prey, ASYLUM_HUNTING_GROUND_ID), prey.ready)
            expectClose(bloat().blood, 1, 'the ground puts a blood on the vampire')
            expectClose(bloat().pool, 1, 'which the Doll carries over: 1/3 and the 1 put back')
        },
    },
    {
        name: 'Bloat: my hand is read exactly, the hand of another is believed from the cards it showed',
        run() {
            const ring = createRing([MalkavDeck, MalkavDeck, MalkavDeck])
            const [me, prey] = ring.players
            const [mine] = addMinions(ring, me, [{ blood: 1 }])
            mine.minionAttrs.capacity = 5
            holdOnly(ring, me, [LIFE_IN_THE_CITY_ID])
            const next = () => assessAs(ring, me).bloat[me.oid].turns[0]
            expectClose(next().blood, 1, 'Life in the City puts a blood back')
            mine.blood = 5
            expectEqual(next().blood, 0, 'with no room for it, nothing')
            mine.blood = 1
            holdOnly(ring, me, [])
            expectEqual(next().blood, 0, 'with no card, nothing')

            const held = prey.hand.cards.length
            const believed = assessAs(ring, me).bloat[prey.oid]
            const { opponentPrior, bloat } = DEFAULT_PROFILE
            expectClose(
                believed.pool,
                Math.min(1, (opponentPrior.density.poolGain ?? 0) * held) * bloat.poolPerCard,
                'the pool of the cards it may hold, one is played per turn',
            )
            expectEqual(believed.pool > 0, true, 'a hand of the others is worth something')
        },
    },
    {
        name: 'Bloat: a bleed on a Methuselah that takes pool back only counts above what it takes back, an oust is not eaten',
        run() {
            const board = (doll: boolean, pool: number) => {
                const ring = createRing([AttachDeck, AttachDeck, AttachDeck])
                const [me, prey] = ring.players
                const [mine] = addMinions(ring, me, [{ bleed: 3 }])
                const [theirs] = addMinions(ring, prey, [{ blood: 4, locked: true }])
                holdOnly(ring, me, [])
                emptyHand(ring.gameState, prey)
                prey.pool = pool
                if (doll) {
                    dollOn(theirs)
                }
                const assessment = assessAs(ring, me)
                const gain = gainOfBleeds(
                    assessment,
                    bleedOnPrey(assessment, [minionOf(assessment, mine)]),
                )
                return { gain, taken: gain.drain / assessment.stakes[prey.oid].weight }
            }
            expectClose(board(false, 10).taken, 3, 'a bleed of 3 takes 3')
            expectClose(
                board(true, 10).taken,
                2.5,
                'the pool it takes back eats half of the first point',
            )
            const lethal = board(true, 3)
            expectClose(lethal.taken, 3, 'the pool a Methuselah is ousted with does not come back')
            expectEqual(lethal.gain.oust > 0, true, 'and it is an oust')
        },
    },
    {
        name: 'Bloat: what I take back each turn softens the pool I lose to the lunge of my predator, not the chance of being ousted',
        run() {
            const board = (doll: boolean) => {
                const ring = createRing([AttachDeck, AttachDeck, AttachDeck])
                const [me, , predator] = ring.players
                const [mine] = addMinions(ring, me, [{ bleed: 1, blood: 4 }])
                addMinions(ring, predator, [{ bleed: 4 }, { bleed: 4 }])
                holdOnly(ring, me, [])
                me.pool = 12
                if (doll) {
                    dollOn(mine)
                }
                const assessment = assessAs(ring, me)
                return outcomeOfTurn(assessment, {
                    actors: [],
                    reserved: [minionOf(assessment, mine)],
                })
            }
            const bare = board(false)
            const dolled = board(true)
            expectClose(
                dolled.chanceOfBeingOusted,
                bare.chanceOfBeingOusted,
                'the master phase is after the lunge: the ouster is the same',
                1e-9,
            )
            expectClose(dolled.expectedLoss, bare.expectedLoss, 'so is the pool taken', 1e-9)
            expectClose(bare.lastingLoss, bare.expectedLoss, 'with nothing to take back, all lasts')
            expectEqual(
                dolled.lastingLoss < dolled.expectedLoss - 0.3,
                true,
                `part of it is made good ( ${dolled.lastingLoss} of ${dolled.expectedLoss} )`,
            )
        },
    },
    {
        name: 'Bloat: the blood a Blood Doll carries to the pool within the horizon is worth a point of pool, the rest the price of blood',
        run() {
            const ring = createRing([AttachDeck, AttachDeck, AttachDeck])
            const [me] = ring.players
            const [plain, carrier] = addMinions(ring, me, [{ blood: 2 }, { blood: 2 }])
            dollOn(carrier)
            const worth = (vampire: Vampire, delta: number) => {
                const table = snapshotAs(ring, me)
                const minion = table.me.minions.find(candidate => candidate.oid == vampire.oid)
                if (!minion) {
                    throw new ScenarioFailure(`No profile for ${vampire.name}`)
                }
                return bloodChange(DEFAULT_PROFILE, minion, delta)
            }
            expectClose(worth(plain, 1), 0.5, 'a blood is worth half a point of pool')
            expectClose(worth(carrier, 1), 1, 'one a Doll carries over is a point of pool')
            expectClose(worth(carrier, -1), -0.5, 'but the blood it keeps is only blood')
            carrier.blood = 3
            expectClose(worth(carrier, -1), -1, 'losing one it would carry costs as much')
            carrier.blood = 6
            expectClose(worth(carrier, 1), 0.5, 'past what a Doll carries in 3 turns it is blood')
        },
    },
    {
        name: 'Turn plan: a vampire that carries a Blood Doll hunts for more, the blood is pool a turn later',
        run() {
            const board = (doll: boolean) => {
                const ring = createRing([AttachDeck, AttachDeck, AttachDeck])
                const [me] = ring.players
                const [mine] = addMinions(ring, me, [{ bleed: 0, blood: 2 }])
                mine.minionAttrs.capacity = 6
                mine.vampireAttrs.hunt = 1
                if (doll) {
                    dollOn(mine)
                }
                holdOnly(ring, me, [])
                return planAs(ring, me).actions[0]
            }
            const bare = board(false)
            const dolled = board(true)
            expectEqual(bare?.kind, 'hunt', 'it hunts')
            expectClose(bare?.value ?? 0, 0.5, 'a blood')
            expectEqual(dolled?.kind, 'hunt', 'and with a Doll')
            expectClose(dolled?.value ?? 0, 1, 'a point of pool, a turn later')
        },
    },
    {
        name: 'Turn plan: a small bleed on a Methuselah that takes pool back is not worth the minion, which hunts instead',
        run() {
            const board = (dolls: number) => {
                const ring = createRing([AttachDeck, AttachDeck, AttachDeck])
                const [me, prey] = ring.players
                const [mine] = addMinions(ring, me, [{ bleed: 2, blood: 3 }])
                mine.minionAttrs.capacity = 8
                mine.vampireAttrs.hunt = 3
                const theirs = addMinions(ring, prey, [
                    { blood: 4, locked: true },
                    { blood: 4, locked: true },
                ])
                theirs.slice(0, dolls).forEach(dollOn)
                holdOnly(ring, me, [])
                emptyHand(ring.gameState, prey)
                prey.pool = 10
                return planAs(ring, me, { profile: FLAT_STAKES }).actions[0]?.kind
            }
            expectEqual(board(0), 'bleed', 'against a prey that takes nothing back, it bleeds')
            expectEqual(board(2), 'hunt', 'against one that takes 2 back, the bleed is half eaten')
        },
    },
    {
        name: 'Bloat: a Minion Tap in my hand counts the blood of my richest vampire at what it is worth less than pool',
        run() {
            const ring = createRing([MINION_TAP_DECK, MINION_TAP_DECK, MINION_TAP_DECK])
            const [me] = ring.players
            addMinions(ring, me, [{ blood: 4 }, { blood: 2 }])
            holdOnly(ring, me, [])
            expectEqual(assessAs(ring, me).bloat[me.oid].pool, 0, 'no card, nothing')
            holdOnly(ring, me, [MINION_TAP_ID])
            const { caution, bloodValue } = DEFAULT_PROFILE.plan
            const { turns } = assessAs(ring, me).bloat[me.oid]
            expectClose(
                turns[0].pool,
                (4 - DEFAULT_PROFILE.bloat.keep) * (caution - bloodValue),
                'the blood of the richest, above what it keeps, less what the blood is worth',
            )
            expectEqual(turns[1].pool, 0, 'a card is played once')
        },
    },
    {
        name: 'Bloat: a Villein in my hand counts at most 5 blood of my richest vampire',
        run() {
            const ring = createRing([VILLEIN_DECK, VILLEIN_DECK, VILLEIN_DECK])
            const [me] = ring.players
            const [mine] = addMinions(ring, me, [{ blood: 8 }, { blood: 2 }])
            holdOnly(ring, me, [VILLEIN_ID])
            const { caution, bloodValue } = DEFAULT_PROFILE.plan
            const { keep } = DEFAULT_PROFILE.bloat
            const pool = () => assessAs(ring, me).bloat[me.oid].turns[0].pool
            expectClose(pool(), 5 * (caution - bloodValue), 'five of the eight')
            mine.blood = 4
            expectClose(
                pool(),
                (4 - keep) * (caution - bloodValue),
                'a vampire of 4 is not drained to 0: it keeps some',
            )
            mine.blood = keep
            expectEqual(pool(), 0, 'and one at what it keeps is not drained at all')
        },
    },
    {
        name: 'Bloat: it is a schedule, a Doll moves what its vampire holds and then stops',
        run() {
            const ring = createRing([AttachDeck, AttachDeck, AttachDeck])
            const [me, prey] = ring.players
            holdOnly(ring, me, [])
            emptyHand(ring.gameState, prey)
            const [theirs] = addMinions(ring, prey, [{ blood: 1, locked: true }])
            theirs.minionAttrs.capacity = 6
            dollOn(theirs)
            const pools = () => assessAs(ring, me).bloat[prey.oid].turns.map(income => income.pool)
            expectEqual(pools().join(), '0,0,0', 'a vampire does not give the blood it keeps')
            theirs.blood = 3
            expectEqual(
                pools().join(),
                '1,0,0',
                'one blood above it is moved on the first turn, then nothing',
            )
            theirs.blood = 4
            expectEqual(pools().join(), '1,1,0', 'two blood last two turns')
            theirs.blood = 7
            expectEqual(pools().join(), '1,1,1', 'with more it moves one a turn')
            ring.gameState.moveCardToRegion(findAnyCard(prey, ASYLUM_HUNTING_GROUND_ID), prey.ready)
            theirs.blood = 1
            expectEqual(pools().join(), '1,1,1', 'a ground puts a blood back every turn')
        },
    },
    {
        name: 'Bloat: a card of my hand is played once, two in a turn when one of them is a trifle',
        run() {
            const deck = <DeckList>{ ...VILLEIN_DECK, [LIFE_IN_THE_CITY_ID]: 4 }
            const ring = createRing([deck, deck, deck])
            const [me] = ring.players
            const [mine] = addMinions(ring, me, [{ blood: 8 }])
            mine.minionAttrs.capacity = 10
            const turns = () => assessAs(ring, me).bloat[me.oid].turns
            const { caution, bloodValue } = DEFAULT_PROFILE.plan
            holdOnly(ring, me, [VILLEIN_ID, VILLEIN_ID])
            expectClose(
                turns()[0].pool,
                6 * (caution - bloodValue),
                'two Villeins are trifles: both in one turn, 5 and then what is left of the 3 above the 2 it keeps',
            )
            expectEqual(turns()[1].pool, 0, 'and nothing is left for the next one')
            mine.blood = 1
            holdOnly(ring, me, [LIFE_IN_THE_CITY_ID, LIFE_IN_THE_CITY_ID, LIFE_IN_THE_CITY_ID])
            expectEqual(
                turns()
                    .map(income => income.blood)
                    .join(),
                '2,1,0',
                'Life in the City is a trifle: two the first turn, the third the next',
            )
            mine.blood = 3
            holdOnly(ring, me, [VILLEIN_ID, LIFE_IN_THE_CITY_ID])
            expectEqual(
                turns()[0].blood,
                1,
                'a Villein and a Life in the City: both on the first turn',
            )
            expectClose(
                turns()[0].pool,
                1 * (caution - bloodValue),
                'the Villein takes the blood left',
            )
        },
    },
    {
        name: 'Bloat: what a bleed meets is what the prey takes back before my next turn, not an average over the horizon',
        run() {
            const taken = (blood: number) => {
                const ring = createRing([AttachDeck, AttachDeck, AttachDeck])
                const [me, prey] = ring.players
                const [mine] = addMinions(ring, me, [{ bleed: 3 }])
                const [theirs] = addMinions(ring, prey, [{ blood, locked: true }])
                holdOnly(ring, me, [])
                emptyHand(ring.gameState, prey)
                prey.pool = 10
                dollOn(theirs)
                const assessment = assessAs(ring, me)
                const gain = gainOfBleeds(
                    assessment,
                    bleedOnPrey(assessment, [minionOf(assessment, mine)]),
                )
                return gain.drain / assessment.stakes[prey.oid].weight
            }
            expectClose(
                taken(5),
                2.5,
                'a Doll with blood for every turn moves one before my next turn',
            )
            expectClose(
                taken(3),
                2.5,
                'with one blood above what it keeps it is the same: moved at once, then nothing',
            )
            expectClose(taken(2), 3, 'a vampire at what it keeps gives nothing')
        },
    },
    {
        name: 'Bloat: a bleed that leaves its prey within reach of the same bleeds next turn sets up an oust, unless the income lifts the pool out of reach',
        run() {
            const board = (pool: number, dolls: number) => {
                const ring = createRing([AttachDeck, AttachDeck, AttachDeck])
                const [me, prey] = ring.players
                const [mine] = addMinions(ring, me, [{ bleed: 3 }])
                const theirs = addMinions(ring, prey, [
                    { blood: 4, locked: true },
                    { blood: 4, locked: true },
                ])
                theirs.slice(0, dolls).forEach(dollOn)
                holdOnly(ring, me, [])
                emptyHand(ring.gameState, prey)
                prey.pool = pool
                const assessment = assessAs(ring, me)
                return gainOfBleeds(
                    assessment,
                    bleedOnPrey(assessment, [minionOf(assessment, mine)]),
                )
            }
            const oust = DEFAULT_PROFILE.vpValue + OUST_POOL_GAIN
            const { setup } = DEFAULT_PROFILE.bloat
            expectClose(
                board(5, 0).setup,
                oust * setup,
                '5 pool, a bleed of 3: 2 left, in reach of the same',
            )
            expectEqual(board(5, 0).oust, 0, 'it is not an oust now')
            expectClose(board(7, 0).setup, 0, '7 pool: 4 left, out of reach')
            expectClose(board(5, 1).setup, oust * setup, 'with 1 back: 3 left, still in reach')
            expectClose(board(5, 2).setup, 0, 'with 2 back: 4 left, out of reach')
            expectClose(board(3, 0).setup, 0, 'a bleed that ousts sets up nothing, it is the oust')
            expectEqual(board(3, 0).oust > 0, true, 'which is counted as one')
        },
    },
    {
        name: 'Bloat: what a bleed sets up is what it adds to the chance of the oust next turn, the chance that was there without it is not its doing',
        run() {
            const outcome = (p: number, loss: number) => ({
                p,
                loss,
                blocked: 0,
                bounced: 0,
                bouncedLoss: 0,
                landed: 1,
            })
            const result = (outcomes: ReturnType<typeof outcome>[]) => ({
                attackers: 1,
                outcomes,
                expectedLoss: 0,
                expectedBounced: 0,
                chanceOfBounce: 0,
                blockedShare: 0,
            })
            const sure = result([outcome(1, 3)])
            expectClose(setupChance(sure, 5, 0), 1, 'a sure bleed of 3 on 5: in reach next turn')
            expectClose(setupChance(sure, 5, 2), 0, 'the pool it takes back lifts it out of reach')
            expectClose(setupChance(sure, 3, 0), 0, 'a bleed that ousts is not a setup')
            const wide = result([outcome(0.5, 1), outcome(0.5, 6)])
            expectClose(
                setupChance(wide, 5, 0),
                0,
                'a bleed of 1 changes nothing: the 6 oust either way',
            )
            const mixed = result([outcome(0.5, 3), outcome(0.5, 1)])
            expectClose(
                setupChance(mixed, 5, 0),
                0.25,
                'only the 3 leaves it within reach of a 3, half of the time',
            )
        },
    },
    {
        name: 'Turn plan: a drain that sets up an oust for the next turn is made, one that the income would erase is not',
        run() {
            const board = (pool: number, dolls: number) => {
                const ring = createRing([AttachDeck, AttachDeck, AttachDeck])
                const [me, prey] = ring.players
                const [mine] = addMinions(ring, me, [{ bleed: 2, blood: 1 }])
                mine.minionAttrs.capacity = 8
                mine.vampireAttrs.hunt = 6
                const theirs = addMinions(ring, prey, [
                    { blood: 4, locked: true },
                    { blood: 4, locked: true },
                ])
                theirs.slice(0, dolls).forEach(dollOn)
                holdOnly(ring, me, [])
                emptyHand(ring.gameState, prey)
                prey.pool = pool
                return planAs(ring, me, { profile: FLAT_STAKES }).actions[0]?.kind
            }
            expectEqual(
                board(10, 0),
                'hunt',
                'far from an ouster the bleed is worth less than the hunt',
            )
            expectEqual(board(3, 0), 'bleed', 'a prey of 3 left with 1 is in reach: it bleeds')
            expectEqual(board(3, 2), 'hunt', 'with 2 back it is out of reach again, and half eaten')
        },
    },
    {
        name: 'Bloat: blood that a card of my hand taps is pool soon, up to what the card takes',
        run() {
            const ring = createRing([VILLEIN_DECK, VILLEIN_DECK, VILLEIN_DECK])
            const [me] = ring.players
            const [mine] = addMinions(ring, me, [{ blood: 2 }])
            mine.minionAttrs.capacity = 12
            const worth = (delta: number) => {
                const table = snapshotAs(ring, me)
                const minion = table.me.minions.find(candidate => candidate.oid == mine.oid)
                if (!minion) {
                    throw new ScenarioFailure('No profile for the vampire')
                }
                return bloodChange(DEFAULT_PROFILE, minion, delta, assessAs(ring, me).bloat[me.oid])
            }
            holdOnly(ring, me, [])
            expectClose(worth(1), 0.5, 'with nothing in hand a blood is worth half a point of pool')
            holdOnly(ring, me, [VILLEIN_ID])
            expectClose(worth(1), 1, 'a Villein will turn it into pool')
            mine.blood = 7
            expectClose(worth(1), 0.5, 'past the 5 that a Villein takes it is blood again')
            holdOnly(ring, me, [MINION_TAP_ID])
            expectClose(worth(1), 1, 'a Minion Tap takes any amount')
            mine.blood = 1
            expectClose(worth(1), 0.5, 'but not what the vampire keeps for itself')
            mine.blood = 2
            expectClose(worth(1), 1, 'only what is above it')
        },
    },
    {
        name: 'Turn plan: with a Villein in hand a hunt is worth a point of pool for each blood, which is pool soon',
        run() {
            const board = (hand: string[]) => {
                const ring = createRing([VILLEIN_DECK, VILLEIN_DECK, VILLEIN_DECK])
                const [me] = ring.players
                const [mine] = addMinions(ring, me, [{ bleed: 0, blood: 2 }])
                mine.minionAttrs.capacity = 8
                mine.vampireAttrs.hunt = 1
                holdOnly(ring, me, hand)
                return planAs(ring, me).actions[0]
            }
            expectClose(board([])?.value ?? 0, 0.5, 'a blood')
            expectClose(board([VILLEIN_ID])?.value ?? 0, 1, 'a point of pool, soon')
        },
    },
    {
        name: 'Bloat: it prints',
        run() {
            const ring = createRing([VILLEIN_DECK, VILLEIN_DECK, VILLEIN_DECK])
            const [me, prey] = ring.players
            addMinions(ring, me, [{ blood: 3 }])
            const [theirs] = addMinions(ring, prey, [{ blood: 4, locked: true }])
            dollOn(theirs)
            holdOnly(ring, me, [VILLEIN_ID])
            const lines = describeAssessment(assessAs(ring, me)).join('\n')
            expectEqual(
                lines.includes('from the blood bank, turn by turn: '),
                true,
                'the schedule is described',
            )
            expectEqual(
                lines.includes('its hand turns 5.00 blood of a vampire'),
                true,
                'so is the hand',
            )
        },
    },
]

/**
 * The combat model ( src/shared/bot/utility/combatModel.ts ): the rules are the engine's, so what is checked here is
 * what the model adds ( the moves of a side, the cards, a copy that does not touch the original ) and the rules
 * from the model's side, on the rulebook's examples. script/botCombat.ts compares it with the engine on random combats.
 */

function simCombatant(side: Side, over: Partial<SimCombatant> = {}): SimCombatant {
    const blood = over.blood ?? 4
    return {
        ...newCombatantFields(1),
        side,
        name: side == 'acting' ? 'Alice' : 'Bob',
        isVampire: true,
        state: 'ready',
        blood,
        startBlood: blood,
        capacity: 10,
        pool: 10,
        attached: [],
        cards: [],
        spent: 0,
        ...over,
    }
}

const simFight = (acting: Partial<SimCombatant> = {}, defending: Partial<SimCombatant> = {}) =>
    newCombatSim(simCombatant('acting', acting), simCombatant('defending', defending))

function simPassUntil(sim: CombatSim, step: CombatStep | null): CombatSim {
    let current = sim
    for (let i = 0; i < 60; i++) {
        if (step === null ? current.closed : current.step == step) {
            return current
        }
        if (current.closed) {
            throw new ScenarioFailure(`The combat ended before the ${step} step`)
        }
        current = applyMove(current, { type: 'pass' }).sim
    }
    throw new ScenarioFailure(`The ${step} step was not reached`)
}

// The strike step, acting minion first: a hand strike for the side that gives none
function simStrikes(sim: CombatSim, acting?: SimStrike, defending?: SimStrike): CombatSim {
    let current = simPassUntil(sim, CombatStep.Strike)
    while (current.step == CombatStep.Strike && !current.closed) {
        const side = current.impulsePlayer
        const given = side == 'acting' ? acting : defending
        const strike =
            given ?? newStrike('Hand strike', { damage: current[side].strength, isHand: true })
        current = applyMove(current, { type: 'strike', strike }).sim
    }
    return current
}

function simMove(sim: CombatSim, test: (move: Move) => boolean, what: string): CombatSim {
    const move = legalMoves(sim).find(test)
    if (!move) {
        throw new ScenarioFailure(`${what} is not offered`)
    }
    return applyMove(sim, move).sim
}

const MAGNUM_KIT: AttachedKit = {
    name: '.44 Magnum',
    retainer: false,
    life: 0,
    strikes: [{ damage: 2, ranged: true, aggravated: false, maneuver: true }],
    prevention: [],
    environmental: 0,
}

const retainerKit = (name: string, life: number, environmental = 0): AttachedKit => ({
    name,
    retainer: true,
    life,
    strikes: [],
    prevention: [],
    environmental,
})

const CARD_USER = {
    disciplines: {} as Partial<Disciplines>,
    isVampire: true,
    forbiddenPlays: [] as string[],
    clan: 'Brujah',
    sect: 'Camarilla',
    title: '',
    capacity: 10,
}

const factsOfCard = (
    krcgId: string,
    name: string,
    costs: { bloodCost?: number; poolCost?: number } = {},
): CardFacts => ({ krcgId, name, type: 'Combat', bloodCost: 0, poolCost: 0, ...costs })

type StrikeMove = Extract<Move, { type: 'strike' }>

const strikeMoves = (sim: CombatSim) =>
    legalMoves(sim).filter((move): move is StrikeMove => move.type == 'strike')

// The strike of the first move at the strike step that the name matches
const strikeNamed = (sim: CombatSim, name: string): SimStrike | undefined =>
    strikeMoves(simPassUntil(sim, CombatStep.Strike)).find(move => move.strike.name == name)?.strike

const COMBAT_MODEL_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'Combat model: a round of hand strikes, 1 damage each, mended, no press so the combat ends',
        run() {
            const sim = simPassUntil(simStrikes(simFight({ blood: 3 }, { blood: 3 })), null)
            expectEqual(sim.acting.blood, 2, 'acting blood')
            expectEqual(sim.defending.blood, 2, 'defending blood')
            expectEqual(outcomeOf(sim).over, true, 'the combat is over')
            expectEqual(sim.acting.state, 'ready', 'acting state')
        },
    },
    {
        name: 'Combat model: the first window offers a pass, the strike step cannot be passed and offers the hand strike first',
        run() {
            const sim = simFight()
            expectEqual(
                legalMoves(sim)
                    .map(move => move.type)
                    .join(),
                'pass',
                'moves of the first window',
            )
            const moves = legalMoves(simPassUntil(sim, CombatStep.Strike))
            expectEqual(moves.map(move => move.type).join(), 'strike', 'moves of the strike step')
            expectEqual(
                moves[0].type == 'strike' && moves[0].strike.name,
                'Hand strike',
                'the hand strike',
            )
        },
    },
    {
        name: 'Combat model: a strike with first strike resolves before the others, so a minion sent to torpor does not strike',
        run() {
            const firstStrike = newStrike('Quick', { damage: 3, firstStrike: true })
            const sim = simPassUntil(
                simStrikes(simFight({ blood: 1 }, { blood: 3 }), undefined, firstStrike),
                null,
            )
            expectEqual(sim.acting.state, 'torpor', 'acting goes to torpor')
            expectEqual(sim.acting.blood, 0, 'acting blood')
            expectEqual(sim.defending.blood, 3, 'the hand strike of the acting minion was lost')
        },
    },
    {
        name: 'Combat model: a dodge stops the opposing strike, combat ends stops the combat before any damage',
        run() {
            const dodged = simPassUntil(
                simStrikes(simFight(), undefined, newStrike('Dodge', { dodge: true })),
                null,
            )
            expectEqual(dodged.defending.blood, 4, 'the dodging minion is not hurt')
            expectEqual(dodged.acting.blood, 4, 'a dodge does no damage')
            const ended = simStrikes(
                simFight(),
                newStrike('Dodge', { dodge: true }),
                newStrike('Combat ends', { combatEnds: true }),
            )
            expectEqual(ended.acting.blood + ended.defending.blood, 8, 'combat ends is not dodged')
            expectEqual(ended.isOver, true, 'the combat is over')
        },
    },
    {
        name: 'Combat model: stolen blood moves before the damage is mended, and what is above the capacity drains off',
        run() {
            const steal = newStrike('Steal', { stealBlood: 2 })
            const sim = simPassUntil(
                simStrikes(simFight({ blood: 4, capacity: 5 }, { blood: 3 }), steal),
                null,
            )
            expectEqual(sim.defending.blood, 1, 'defending lost 2 counters')
            expectEqual(sim.acting.blood, 4, '5 after the steal ( the capacity ), 1 mended')
        },
    },
    {
        name: 'Combat model: aggravated damage is not mended, a wounded vampire burns blood for each further point or is burned',
        run() {
            const claws = newStrike('Claws', { damage: 3, aggravated: true })
            const torpor = simPassUntil(simStrikes(simFight({}, { blood: 2 }), claws), null)
            expectEqual(torpor.defending.state, 'torpor', '2 blood, 3 aggravated: torpor')
            expectEqual(torpor.defending.blood, 0, 'with no blood left')
            const burned = simPassUntil(simStrikes(simFight({}, { blood: 1 }), claws), null)
            expectEqual(burned.defending.state, 'burned', '1 blood, 3 aggravated: burned')
        },
    },
    {
        name: 'Combat model: an ally burns its life counters and is burned when none is left, it does not go to torpor',
        run() {
            const sim = simPassUntil(
                simStrikes(simFight({ strength: 3 }, { isVampire: false, blood: 2 })),
                null,
            )
            expectEqual(sim.defending.state, 'burned', 'the ally is burned')
            expectEqual(sim.defending.blood, 0, 'with no life left')
        },
    },
    {
        name: 'Combat model: a hand strike has no effect at long range, a ranged strike does, a weapon maneuver gives both the strike and the range',
        run() {
            let sim = simPassUntil(simFight({ attached: [MAGNUM_KIT] }), CombatStep.DetermineRange)
            sim = simMove(
                sim,
                move => move.type == 'maneuver' && move.weaponKey !== undefined,
                'the weapon maneuver',
            )
            expectEqual(sim.range, CombatRange.Long, 'long range')
            sim = simPassUntil(simStrikes(sim), null)
            expectEqual(sim.defending.blood, 2, 'the Magnum hits at long range')
            expectEqual(sim.acting.blood, 4, 'the hand strike does not')
        },
    },
    {
        name: 'Combat model: a weapon gives its maneuver once per combat, the weapon of the other side has its own',
        run() {
            let sim = simPassUntil(
                simFight({ attached: [MAGNUM_KIT] }, { attached: [MAGNUM_KIT] }),
                CombatStep.DetermineRange,
            )
            sim = simMove(sim, move => move.type == 'maneuver' && !!move.weaponKey, 'acting')
            expectEqual(
                legalMoves(sim).some(
                    move => move.type == 'maneuver' && move.weaponKey?.startsWith('defending'),
                ),
                true,
                'the other Magnum maneuvers back',
            )
            sim = simMove(sim, move => move.type == 'maneuver' && !!move.weaponKey, 'defending')
            expectEqual(sim.range, CombatRange.Close, 'back at close range')
            expectEqual(
                legalMoves(sim).some(move => move.type == 'maneuver'),
                false,
                'both weapons gave their maneuver, and nobody plays two in a row',
            )
        },
    },
    {
        name: 'Combat model: a strike at a retainer burns its life counters, the first retainer is a target like the others, what a burned retainer inflicted ends with it',
        run() {
            const kits = [retainerKit('Raven Spy', 2), retainerKit('Murder of Crows', 1, 1)]
            const base = simFight({ attached: [MAGNUM_KIT] }, { attached: kits })
            const names = strikeMoves(simPassUntil(base, CombatStep.Strike)).map(
                move => move.strike.name,
            )
            expectEqual(
                names.filter(name => name.includes(' at ')).length,
                4,
                'the Magnum and the hand at each of the two retainers',
            )
            const first = simPassUntil(
                simStrikes(base, strikeNamed(base, '.44 Magnum at Raven Spy')),
                null,
            )
            expectEqual(first.defending.attached[0].life, 0, 'the first retainer lost its counters')
            expectEqual(first.defending.attached[1].life, 1, 'the other is not touched')
            expectEqual(
                first.acting.blood,
                2,
                'the hand strike and the environmental damage of the other',
            )
            const second = simPassUntil(
                simStrikes(base, strikeNamed(base, '.44 Magnum at Murder of Crows')),
                null,
            )
            expectEqual(second.defending.attached[1].life, 0, 'the retainer is burned')
            expectEqual(second.acting.blood, 3, 'only the hand strike: it inflicts no more')
        },
    },
    {
        name: 'Combat model: a copy is made to be changed, the combat it comes from is not',
        run() {
            const base = simFight({}, { attached: [retainerKit('Raven Spy', 2)] })
            const before = JSON.stringify(base)
            simPassUntil(simStrikes(base, strikeNamed(base, 'Hand strike at Raven Spy')), null)
            expectEqual(JSON.stringify(base), before, 'the first combat')
        },
    },
    {
        name: 'Combat model: a card is offered for each way the minion can play it, with the discipline it needs',
        run() {
            const roundhouse = factsOfCard('102215', 'Roundhouse')
            expectEqual(combatCards(CARD_USER, [roundhouse]).length, 0, 'no Potence, no card')
            const inferior = combatCards(
                { ...CARD_USER, disciplines: { [Discipline.Potence]: DisciplineLevel.INFERIOR } },
                [roundhouse],
            )
            expectEqual(inferior[0].plays.length, 1, 'inferior: one play')
            const superior = combatCards(
                { ...CARD_USER, disciplines: { [Discipline.Potence]: DisciplineLevel.SUPERIOR } },
                [roundhouse],
            )
            expectEqual(superior[0].plays.length, 2, 'superior: the inferior play too')
            const sim = simPassUntil(simFight({ cards: superior }), CombatStep.Strike)
            const damages = strikeMoves(sim)
                .filter(move => move.card !== undefined)
                .map(move => move.strike.damage)
                .toSorted()
            expectEqual(damages.join(), '3,4', 'the damage is the strength plus 2, or plus 3')
        },
    },
    {
        name: 'Combat model: a card costs blood and needs more pool than it costs, the card leaves the hand when it is played',
        run() {
            const potence = { [Discipline.Potence]: DisciplineLevel.INFERIOR }
            const card = (costs: { bloodCost?: number; poolCost?: number }) =>
                combatCards({ ...CARD_USER, disciplines: potence }, [
                    factsOfCard('102215', 'Roundhouse', costs),
                ])
            const offered = (cards: SimCard[], blood: number, pool: number) =>
                strikeMoves(simPassUntil(simFight({ cards, blood, pool }), CombatStep.Strike)).some(
                    move => move.card !== undefined,
                )
            expectEqual(offered(card({ bloodCost: 2 }), 1, 10), false, '2 blood cost, 1 blood')
            expectEqual(offered(card({ bloodCost: 2 }), 2, 10), true, '2 blood cost, 2 blood')
            expectEqual(offered(card({ poolCost: 3 }), 4, 3), false, '3 pool cost, 3 pool')
            expectEqual(offered(card({ poolCost: 3 }), 4, 4), true, '3 pool cost, 4 pool')
            const played = simMove(
                simPassUntil(
                    simFight({ cards: card({ bloodCost: 1, poolCost: 2 }) }),
                    CombatStep.Strike,
                ),
                move => move.type == 'strike' && move.card !== undefined,
                'the card',
            )
            expectEqual(played.acting.blood, 3, 'the minion paid 1 blood')
            expectEqual(played.acting.pool, 8, 'the Methuselah paid 2 pool')
            expectEqual(played.acting.cards.length, 0, 'the card left the hand')
            expectEqual(played.acting.spent, 1, 'a card was played')
        },
    },
    {
        name: 'Combat model: a card that is played once per combat is not offered again, even from another copy',
        run() {
            const animalism = { [Discipline.Animalism]: DisciplineLevel.INFERIOR }
            const crows = combatCards({ ...CARD_USER, disciplines: animalism }, [
                factsOfCard('100301', 'Carrion Crows'),
                factsOfCard('100301', 'Carrion Crows'),
            ])
            expectEqual(crows.length, 2, 'two copies')
            let sim = simFight({ cards: crows })
            const offered = (current: CombatSim) =>
                legalMoves(current).filter(move => move.type == 'environmentalDamage').length
            expectEqual(offered(sim), 2, 'both copies are offered before the range')
            sim = simMove(sim, move => move.type == 'environmentalDamage', 'the crows')
            expectEqual(offered(sim), 0, 'the second copy is not played in the same combat')
            expectEqual(sim.playedThisCombat['acting']?.join(), '100301', 'remembered')
        },
    },
    {
        name: 'Combat model: after a grapple only hand strikes are chosen, and Taste of Vitae gives back the blood the opponent lost',
        run() {
            const potence = { [Discipline.Potence]: DisciplineLevel.INFERIOR }
            const grapple = combatCards({ ...CARD_USER, disciplines: potence }, [
                factsOfCard('100959', 'Immortal Grapple'),
            ])
            let sim = simPassUntil(
                simFight({ attached: [MAGNUM_KIT], cards: grapple }),
                CombatStep.BeforeStrikes,
            )
            sim = simMove(sim, move => move.type == 'grapple', 'the grapple')
            sim = simPassUntil(sim, CombatStep.Strike)
            expectEqual(
                strikeMoves(sim).every(move => move.strike.isHand),
                true,
                'only hand strikes',
            )
            const taste = combatCards(CARD_USER, [factsOfCard('101945', 'Taste of Vitae')])
            let fight = simFight({ cards: taste, strength: 2, blood: 3 })
            const dodged = simPassUntil(
                simStrikes(fight, undefined, newStrike('Dodge', { dodge: true })),
                CombatStep.EndOfRound,
            )
            expectEqual(
                legalMoves(dodged).some(move => move.type == 'gainBlood'),
                false,
                'nothing was lost to a dodge',
            )
            fight = simPassUntil(simStrikes(fight), CombatStep.EndOfRound)
            expectEqual(fight.defending.bloodLost, 2, 'the opponent lost 2')
            fight = simMove(
                fight,
                move => move.type == 'gainBlood' && move.amount == 2,
                'the blood',
            )
            expectEqual(fight.acting.blood, 4, '3, 1 lost, 2 regained')
        },
    },
    {
        name: 'Combat model: the vampire requirement of a card is read from the traits of the vampire, an ally has none',
        run() {
            const card = { clan: 'Brujah/Gangrel', requirement: 'Anarch' }
            const traits = { clan: 'Brujah', sect: 'Anarch', title: '', capacity: 6 }
            expectEqual(traitsMeetRequirements(traits, card), true, 'an Anarch Brujah')
            expectEqual(
                traitsMeetRequirements({ ...traits, sect: 'Camarilla' }, card),
                false,
                'a Camarilla Brujah',
            )
            expectEqual(
                traitsMeetRequirements({ ...traits, clan: 'Ventrue' }, card),
                false,
                'an Anarch Ventrue',
            )
            const dustUp = { ...factsOfCard('100597', 'Dust Up'), requirement: 'Anarch' }
            const user = {
                ...CARD_USER,
                disciplines: { [Discipline.Potence]: DisciplineLevel.INFERIOR },
            }
            expectEqual(combatCards({ ...user, isVampire: false }, [dustUp]).length, 0, 'an ally')
            expectEqual(combatCards({ ...user, sect: 'Anarch' }, [dustUp]).length, 1, 'an Anarch')
            expectEqual(combatCards(user, [dustUp]).length, 0, 'a Camarilla vampire')
            expectEqual(
                combatCards({ ...user, sect: 'Anarch', forbiddenPlays: ['Dust Up'] }, [dustUp])
                    .length,
                0,
                'forbidden by an attached card',
            )
        },
    },
    {
        name: 'Combat model: a card played once per combat stays played in the next round, what a round saw is forgotten, a burned retainer is neither a target nor a threat',
        run() {
            const animalism = { [Discipline.Animalism]: DisciplineLevel.INFERIOR }
            const crows = combatCards({ ...CARD_USER, disciplines: animalism }, [
                factsOfCard('100301', 'Carrion Crows'),
                factsOfCard('100301', 'Carrion Crows'),
            ])
            let sim = simFight(
                { cards: crows, attached: [MAGNUM_KIT], pressesGranted: 1, blood: 8 },
                { attached: [retainerKit('Murder of Crows', 1, 1)], blood: 8 },
            )
            sim = simMove(sim, move => move.type == 'environmentalDamage', 'the first crows')
            sim = simPassUntil(
                simStrikes(sim, strikeNamed(sim, '.44 Magnum at Murder of Crows')),
                CombatStep.Press,
            )
            sim = simMove(sim, move => move.type == 'press' && !!move.granted, 'the press')
            sim = simPassUntil(
                simMove(sim, move => move.type == 'pass', 'the other side lets it go'),
                CombatStep.BeforeRange,
            )
            expectEqual(sim.round, 2, 'a second round')
            expectEqual(sim.playedThisRound['acting']?.length ?? 0, 0, 'the round was forgotten')
            expectEqual(sim.playedThisCombat['acting']?.join(), '100301', 'the combat was not')
            expectEqual(
                legalMoves(sim).some(move => move.type == 'environmentalDamage'),
                false,
                'the second copy cannot be played',
            )
            const names = strikeMoves(simPassUntil(sim, CombatStep.Strike)).map(
                move => move.strike.name,
            )
            expectEqual(
                names.some(name => name.includes('Murder of Crows')),
                false,
                'no target',
            )
            const blood = sim.acting.blood
            sim = simPassUntil(simStrikes(sim), null)
            expectEqual(
                sim.acting.blood,
                blood - 1,
                'the hand strike, and no more from the retainer',
            )
        },
    },
    {
        name: 'Combat model: a card with a variable cost is not offered, a strength lower than the minion has is not either, a maneuver that only goes to close range waits for long range',
        run() {
            const potence = { [Discipline.Potence]: DisciplineLevel.SUPERIOR }
            const user = { ...CARD_USER, disciplines: potence }
            expectEqual(
                combatCards(user, [factsOfCard('102215', 'Roundhouse')]).length,
                1,
                'a cost that is a number',
            )
            expectEqual(
                combatCards(user, [{ ...factsOfCard('102215', 'Roundhouse'), bloodCost: 'X' }])
                    .length,
                0,
                'a cost of X',
            )
            const signpost = combatCards(user, [factsOfCard('101993', 'Torn Signpost')])
            const strengthMoves = (strength: number) =>
                legalMoves(simFight({ cards: signpost, strength })).filter(
                    move => move.type == 'strength',
                ).length
            expectEqual(strengthMoves(1), 2, 'strength 2 and 3 for a minion of strength 1')
            expectEqual(strengthMoves(3), 0, 'nothing above 3')
            const slam = combatCards(user, [factsOfCard('101798', 'Slam')])
            const maneuvers = (sim: CombatSim) =>
                legalMoves(sim).filter(move => move.type == 'maneuver' && move.card !== undefined)
                    .length
            let sim = simPassUntil(
                simFight({ cards: slam }, { attached: [MAGNUM_KIT] }),
                CombatStep.DetermineRange,
            )
            expectEqual(maneuvers(sim), 0, 'at close range')
            sim = simMove(sim, move => move.type == 'pass', 'acting lets the range be')
            sim = simMove(sim, move => move.type == 'maneuver', 'the Magnum of the other')
            expectEqual(sim.range, CombatRange.Long, 'long range')
            expectEqual(maneuvers(sim), 1, 'at long range')
        },
    },
    {
        name: 'Combat model: with no combat the conditions of a combat play say no, except that nothing was played',
        run() {
            const round = { type: 'combatRound', round: 1 } as const
            expectEqual(combatConditionHolds(round, 'x', null), false, 'round')
            expectEqual(combatConditionHolds({ type: 'closeRange' }, 'x', null), false, 'close')
            expectEqual(combatConditionHolds({ type: 'oncePerRound' }, 'x', null), true, 'once')
            expectEqual(
                combatConditionHolds({ type: 'opposingIsVampire' }, 'x', null),
                false,
                'a vampire',
            )
        },
    },
]

/**
 * The position of a combat: the default policy of the playouts, the hands believed of the others, and
 * the forecast of a fight in pool, which the threat and the plan read.
 */

const POLICY_WEIGHTS = policyWeightsOf(DEFAULT_PROFILE)

function fightProfile(over: Partial<MinionProfile> = {}): MinionProfile {
    return {
        oid: 'fighter',
        name: 'Fighter',
        controller: 'owner',
        state: 'unlocked',
        isVampire: true,
        clan: 'Brujah',
        sect: 'Camarilla',
        title: '',
        blood: 6,
        capacity: 8,
        disciplines: {},
        bleed: 1,
        hunt: 1,
        bloodMove: 0,
        strength: 1,
        undirectedStealth: 0,
        intercept: { general: 0, directed: 0, againstBleeds: 0 },
        life: 0,
        prevention: [],
        weaponStrikes: [],
        freeManeuver: false,
        environmentalDamage: 0,
        forbiddenPlays: [],
        burnsInTorpor: false,
        attached: [],
        attachedKits: [],
        canEnterCombat: false,
        ...over,
    }
}

const fighterWith = (over: Partial<MinionProfile> = {}, hand: Hand = { cards: [] }): Fighter => ({
    profile: fightProfile(over),
    pool: 10,
    hand,
})

const testCard = (name: string, play: CombatPlay): SimCard => ({
    cardId: `test:${name}`,
    name,
    bloodCost: 0,
    poolCost: 0,
    plays: [play],
})

const DODGE_CARD = testCard('dodge', { kind: 'combat', effects: [dodgeEffect] })
const MANEUVER_CARD = testCard('maneuver', { kind: 'combat', effects: [maneuverEffect] })

const FIGHT_POTENCE = { [Discipline.Potence]: DisciplineLevel.SUPERIOR }

const PREVENT_KIT: AttachedKit = { ...MAGNUM_KIT, name: 'Shield', strikes: [], prevention: [1] }

const COMBAT_POSITION_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'Combat position: a minion with a ranged weapon maneuvers to the long range where the other cannot strike, one with hands only keeps the range',
        run() {
            const chosen = (acting: Partial<SimCombatant>) =>
                chooseMove(
                    POLICY_WEIGHTS,
                    simPassUntil(simFight(acting), CombatStep.DetermineRange),
                )
            const armed = chosen({ attached: [MAGNUM_KIT] })
            expectEqual(armed.type, 'maneuver', 'the Magnum goes to long range')
            expectEqual(chosen({}).type, 'pass', 'with hands only it stays at close range')
            const answered = (cardCost: number) =>
                chooseMove(
                    policyWeightsOf({
                        ...DEFAULT_PROFILE,
                        combat: { ...DEFAULT_PROFILE.combat, cardCost },
                    }),
                    simPassUntil(
                        simFight({ attached: [MAGNUM_KIT] }, { cards: [MANEUVER_CARD] }),
                        CombatStep.DetermineRange,
                    ),
                ).type
            expectEqual(
                answered(0),
                'pass',
                'the other would bring the range back for nothing: the weapon maneuver is kept',
            )
            expectEqual(
                answered(0.2),
                'maneuver',
                'it costs the other a card to bring it back: worth the try',
            )
        },
    },
    {
        name: 'Combat position: the other side answers a maneuver with its own when it is worth the card, and not when it has none',
        run() {
            const answer = (cards: SimCard[]) => {
                let sim = simPassUntil(
                    simFight({ attached: [MAGNUM_KIT] }, { cards }),
                    CombatStep.DetermineRange,
                )
                sim = simMove(sim, move => move.type == 'maneuver', 'the Magnum maneuver')
                return chooseMove(POLICY_WEIGHTS, sim)
            }
            const withCard = answer([MANEUVER_CARD])
            expectEqual(withCard.type, 'maneuver', 'it brings the range back')
            expectEqual(withCard.card, 0, 'with the card')
            expectEqual(answer([]).type, 'pass', 'nothing to answer with')
        },
    },
    {
        name: 'Combat position: a card is played when it pays for itself in the round: a dodge against a strong strike, not against a weak one',
        run() {
            const dodges = (strength: number, weights = POLICY_WEIGHTS) => {
                const sim = simPassUntil(
                    simFight({ strength }, { cards: [DODGE_CARD] }),
                    CombatStep.Strike,
                )
                const struck = simMove(sim, move => move.type == 'strike', 'the hand strike')
                const reply = chooseMove(weights, struck)
                return reply.type == 'strike' && reply.strike.dodge
            }
            expectEqual(dodges(3), true, '3 damage is worth the card')
            expectEqual(dodges(1), false, '1 damage for 1 damage is not')
            const dear = policyWeightsOf({
                ...DEFAULT_PROFILE,
                combat: { ...DEFAULT_PROFILE.combat, cardCost: 2 },
            })
            expectEqual(dodges(3, dear), false, 'a card that costs 2 is not worth 1.5')
            const steal = simPassUntil(simFight({}, { cards: [DODGE_CARD] }), CombatStep.Strike)
            const robbed = applyMove(steal, {
                type: 'strike',
                strike: newStrike('Steal', { stealBlood: 3 }),
            }).sim
            const reply = chooseMove(POLICY_WEIGHTS, robbed)
            expectEqual(
                reply.type == 'strike' && reply.strike.dodge,
                true,
                'a dodge keeps the blood from being stolen',
            )
        },
    },
    {
        name: 'Combat position: a strike at a retainer is chosen when it burns it for more than the hand strike takes from the minion, not when it only scratches it',
        run() {
            const reply = (life: number) => {
                const sim = simPassUntil(
                    simFight({ strength: 2 }, { attached: [retainerKit('Raven', life)] }),
                    CombatStep.Strike,
                )
                const move = chooseMove(POLICY_WEIGHTS, sim)
                return move.type == 'strike' && move.strike.retainer !== undefined
            }
            expectEqual(reply(1), true, 'a retainer with 1 life is burned')
            expectEqual(reply(5), false, 'one with 5 is not worth the strike')
        },
    },
    {
        name: 'Combat position: a press is played when the next round is favourable, an additional strike is played for the extra pair',
        run() {
            const pressed = (strength: number) => {
                const struck = simStrikes(
                    simFight({ strength, pressesGranted: 1 }, { strength: 3 - strength + 1 }),
                )
                return chooseMove(POLICY_WEIGHTS, simPassUntil(struck, CombatStep.Press)).type
            }
            expectEqual(pressed(3), 'press', 'the stronger presses')
            expectEqual(pressed(1), 'pass', 'the weaker lets the combat end')
            const extra = testCard('extra', {
                kind: 'combat',
                effects: [additionalStrikeEffect({ limited: false })],
            })
            const struck = simStrikes(simFight({ cards: [extra] }))
            const move = chooseMove(
                POLICY_WEIGHTS,
                simPassUntil(struck, CombatStep.AdditionalStrikes),
            )
            expectEqual(move.type, 'additionalStrike', 'a strike nobody can answer')
        },
    },
    {
        name: 'Combat position: a card that sets the strength is played before the range when the damage it adds is worth more than the card',
        run() {
            const signpost = testCard('signpost', {
                kind: 'combat',
                when: [beforeRangeCondition],
                effects: [setStrengthEffect(3)],
            })
            const move = chooseMove(POLICY_WEIGHTS, simFight({ cards: [signpost], strength: 1 }))
            expectEqual(move.type, 'strength', 'the strength is set')
            const idle = chooseMove(POLICY_WEIGHTS, simFight({ cards: [signpost], strength: 3 }))
            expectEqual(idle.type, 'pass', 'it is not raised above what it is')
        },
    },
    {
        name: 'Combat position: a card that makes the other take damage every round is played before the range, a card that does nothing is not',
        run() {
            const crows = testCard('crows', {
                kind: 'combat',
                when: [beforeRangeCondition, oncePerCombatCondition],
                effects: [environmentalEffect(1)],
            })
            expectEqual(
                chooseMove(POLICY_WEIGHTS, simFight({ cards: [crows] })).type,
                'environmentalDamage',
                'the crows are played',
            )
            const played = simMove(
                simFight({ cards: [crows] }),
                move => move.type == 'environmentalDamage',
                'the crows',
            )
            expectEqual(
                chooseMove(POLICY_WEIGHTS, played).type,
                'pass',
                'once per combat, the next move is a pass',
            )
        },
    },
    {
        name: 'Combat position: a card in play that prevents damage is used when damage is pending, the strikes are at the strength of the minion',
        run() {
            const sim = simStrikes(simFight({ strength: 3 }, { attached: [PREVENT_KIT] }))
            expectEqual(sim.step, CombatStep.DamageResolution, 'damage is pending')
            const end = playOut(POLICY_WEIGHTS, sim).sim
            expectEqual(end.defending.blood, 2, '3 damage, 1 prevented: 4 blood left 2')
            expectEqual(
                playOut(POLICY_WEIGHTS, simStrikes(simFight({ strength: 3 }))).sim.defending.blood,
                1,
                'without it 1',
            )
        },
    },
    {
        name: 'Combat position: a minion that is out of blood goes to torpor and pays its worth, the combat is judged the same every time',
        run() {
            const forecast = forecastFight(
                fighterWith({ blood: 1 }),
                fighterWith({ strength: 3 }),
                DEFAULT_PROFILE,
            )
            expectEqual(forecast.acting.torpor, 1, 'it goes to torpor')
            expectEqual(forecast.defending.torpor, 0, 'the other does not')
            const { bloodValue } = DEFAULT_PROFILE.plan
            expectClose(
                forecast.acting.loss,
                bloodValue + DEFAULT_PROFILE.combat.torporShare * 8,
                'the blood it had and half its worth',
                0.001,
            )
            expectEqual(
                netLoss(forecast, 'acting', DEFAULT_PROFILE) >
                    netLoss(forecast, 'defending', DEFAULT_PROFILE),
                true,
                'a loss for it, a gain for the other',
            )
        },
    },
    {
        name: 'Combat position: a retainer burned costs what the profile says, a vampire burned loses all its worth and not half',
        run() {
            const raven = retainerKit('Raven', 1)
            const withRetainer = (retainerValue: number) =>
                forecastFight(
                    fighterWith({ strength: 2 }),
                    fighterWith({ blood: 6, attachedKits: [raven] }),
                    {
                        ...DEFAULT_PROFILE,
                        combat: { ...DEFAULT_PROFILE.combat, retainerValue },
                    },
                )
            const cheap = withRetainer(1)
            expectEqual(cheap.defending.retainers, 1, 'the retainer is burned')
            expectClose(cheap.defending.loss, 1, 'at 1 pool', 0.001)
            expectClose(withRetainer(3).defending.loss, 3, 'at 3 pool', 0.001)

            const flamethrower: AttachedKit = {
                name: 'Flamethrower',
                retainer: false,
                life: 0,
                strikes: [{ damage: 3, ranged: false, aggravated: true, maneuver: false }],
                prevention: [],
                environmental: 0,
            }
            const burned = forecastFight(
                fighterWith({ attachedKits: [flamethrower] }),
                fighterWith({ blood: 1 }),
                DEFAULT_PROFILE,
            )
            expectEqual(burned.defending.burned, 1, 'burned by 3 aggravated damage')
            expectEqual(burned.defending.torpor, 0, 'not in torpor')
            expectClose(
                burned.defending.loss,
                DEFAULT_PROFILE.plan.bloodValue + 8,
                'its blood and all of its worth',
                0.001,
            )
        },
    },
    {
        name: 'Combat position: a hand is drawn from several times when it may hold cards the minion plays, and not otherwise',
        run() {
            const believed = (size: number, strike: number): Hand => ({
                size,
                densities: { strike },
            })
            const samples = (them: Fighter) =>
                forecastFight(fighterWith({ disciplines: FIGHT_POTENCE }), them, DEFAULT_PROFILE)
                    .samples
            expectEqual(
                samples(fighterWith({ disciplines: FIGHT_POTENCE }, believed(7, 0.3))),
                DEFAULT_PROFILE.combat.samples,
                'a Potence minion may hold strikes',
            )
            expectEqual(
                samples(fighterWith({}, believed(7, 0.3))),
                1,
                'a minion without a discipline plays none',
            )
            expectEqual(
                samples(fighterWith({ disciplines: FIGHT_POTENCE }, believed(0, 0.3))),
                1,
                'an empty hand holds none',
            )
            expectEqual(
                samples(fighterWith({ disciplines: FIGHT_POTENCE }, believed(7, 0))),
                1,
                'a library with none holds none',
            )
        },
    },
    {
        name: 'Combat position: the cards of a believed hand follow the shares of the roles, and only the roles the minion plays',
        run() {
            const draws = (disciplines: Partial<Disciplines>, densities: Densities) => {
                const counts: Record<string, number> = {}
                for (let seed = 0; seed < 400; seed++) {
                    const cards = believedCards(
                        fightProfile({ disciplines }),
                        { size: 7, densities },
                        DEFAULT_PROFILE.combat,
                        seededRandom(seed),
                    )
                    for (const card of cards) {
                        counts[card.cardId] = (counts[card.cardId] ?? 0) + 1
                    }
                }
                return (cardId: string) => (counts[cardId] ?? 0) / 400
            }
            const potence = { [Discipline.Potence]: DisciplineLevel.INFERIOR }
            const mean = draws(potence, { strike: 0.3, dodge: 0.2 })
            expectClose(mean('believed:strike'), 7 * 0.3, 'a hand of 7, 30% of strikes', 0.25)
            expectEqual(mean('believed:dodge'), 0, 'Potence plays no dodge')
            const both = draws(
                { ...potence, [Discipline.Presence]: DisciplineLevel.INFERIOR },
                { strike: 0.3, dodge: 0.2 },
            )
            expectClose(both('believed:dodge'), 7 * 0.2, 'with Presence, 20% of dodges', 0.25)
            expectClose(both('believed:strike'), 7 * 0.3, 'and as many strikes', 0.25)
        },
    },
    {
        name: 'Combat position: a strike card believed at a superior discipline hits harder than at an inferior one',
        run() {
            const damage = (level: DisciplineLevel) => {
                const [card] = believedCards(
                    fightProfile({ disciplines: { [Discipline.Potence]: level } }),
                    { size: 1, densities: { strike: 1 } },
                    DEFAULT_PROFILE.combat,
                    () => 0,
                )
                const play = card.plays[0].effects[0]
                return play.type == 'strike' && play.preset == 'hand' ? play.extraDamage : -1
            }
            expectEqual(
                damage(DisciplineLevel.INFERIOR),
                DEFAULT_PROFILE.combat.strikeBonus.inferior,
                'inferior',
            )
            expectEqual(
                damage(DisciplineLevel.SUPERIOR),
                DEFAULT_PROFILE.combat.strikeBonus.superior,
                'superior',
            )
        },
    },
    {
        name: 'Combat position: the more strike cards a hand is believed to hold, the more it costs me, and none is the empty hand',
        run() {
            const loss = (strike: number) =>
                forecastFight(
                    fighterWith({ disciplines: FIGHT_POTENCE }),
                    fighterWith({ disciplines: FIGHT_POTENCE }, { size: 7, densities: { strike } }),
                    DEFAULT_PROFILE,
                ).acting.loss
            const none = forecastFight(
                fighterWith({ disciplines: FIGHT_POTENCE }),
                fighterWith({ disciplines: FIGHT_POTENCE }),
                DEFAULT_PROFILE,
            ).acting.loss
            expectEqual(loss(0), none, 'no card believed: the empty hand')
            expectEqual(loss(0.2) > loss(0), true, 'a few strikes cost something')
            expectEqual(loss(0.6) > loss(0.2), true, 'more cost more')
        },
    },
    {
        name: 'Combat position: the hand I hold is read exactly, a Roundhouse makes a fight with a minion of the same strength cheaper',
        run() {
            const risk = (hand: string[]) => {
                const ring = createRing([BrujahDeck, BrujahDeck])
                const [me, other] = ring.players
                addMinions(ring, me, [{ blood: 6, disciplines: FIGHT_POTENCE }])
                addMinions(ring, other, [{ strength: 1, blood: 6 }])
                holdOnly(ring, me, hand)
                return assessAs(ring, me).threat[other.oid].combat
            }
            const without = risk([])
            expectEqual(without > 0, true, 'an even fight costs something')
            expectEqual(risk([ROUNDHOUSE_ID]) < without, true, 'with the card it costs less')
        },
    },
    {
        name: 'Combat position: a weapon of the blocker that my hand strikes cannot reach is a danger that the same minion without it is not',
        run() {
            const risk = (armed: boolean) => {
                const ring = createRing([AttachDeck, AttachDeck])
                const [me, other] = ring.players
                addMinions(ring, me, [{ blood: 6 }])
                const [blocker] = addMinions(ring, other, [{ strength: 1, blood: 6 }])
                if (armed) {
                    attachInPlay(findAnyCard(other, MAGNUM_ID), blocker)
                }
                holdOnly(ring, me, [])
                return assessAs(ring, me).threat[other.oid].combat
            }
            expectEqual(risk(true) > risk(false), true, 'the Magnum is a danger')
        },
    },
    {
        name: 'Combat position: the combat axis of the threat is the average of the fights my minions lose, times the share of my actions that get blocked',
        run() {
            const ring = createRing([MalkavDeck, MalkavDeck])
            const [me, other] = ring.players
            addMinions(ring, me, [{ blood: 3 }, { blood: 8, strength: 8 }])
            addMinions(ring, other, [{ strength: 3, blood: 7 }])
            holdOnly(ring, me, [])
            const assessment = assessAs(ring, me)
            const risks = assessment.table.me.minions.map(minion => combatRisk(assessment, minion))
            expectEqual(
                risks.some(risk => risk > 0) && risks.some(risk => risk == 0),
                true,
                'one fight is lost, one is won',
            )
            expectClose(
                assessment.threat[other.oid].combat,
                (assessment.opportunity[other.oid].blockedShare * (risks[0] + risks[1])) / 2,
                'the average, not the sum',
                0.001,
            )
        },
    },
    {
        name: 'Combat position: the fight a block of my prey runs my minion into is the worst of its unlocked blockers, none when it has none, more with an armed one',
        run() {
            const risk = (blockers: { armed?: boolean; locked?: boolean }[]) => {
                const ring = createRing([AttachDeck, AttachDeck])
                const [me, other] = ring.players
                addMinions(ring, me, [{ blood: 6 }])
                const theirs = addMinions(
                    ring,
                    other,
                    blockers.map(({ locked }) => ({ strength: 1, blood: 6, locked })),
                )
                blockers.forEach(({ armed }, index) => {
                    if (armed) {
                        attachInPlay(findAnyCard(other, MAGNUM_ID), theirs[index])
                    }
                })
                holdOnly(ring, me, [])
                const assessment = assessAs(ring, me)
                return combatRisk(assessment, assessment.table.me.minions[0])
            }
            const unarmed = risk([{}])
            expectEqual(unarmed > 0, true, 'an even fight is a cost')
            expectEqual(risk([{ armed: true }]) > unarmed, true, 'the Magnum makes it dearer')
            expectEqual(
                risk([{}, { armed: true }]),
                risk([{ armed: true }]),
                'the worst of the two blockers counts',
            )
            expectEqual(risk([{ armed: true, locked: true }]), 0, 'a locked blocker does not block')
        },
    },
]

/**
 * The plan of a combat: the move chosen by playing out what follows, against the hands that the other
 * side may hold.
 */

const PLAN_WEIGHTS = planWeightsOf(DEFAULT_PROFILE)

const SLAM_CARD = testCard('slam', { kind: 'combat', effects: [handStrikeEffect(2)] })
const UNDODGEABLE_CARD = testCard('trick', {
    kind: 'combat',
    effects: [handStrikeEffect(0, { undodgeable: true })],
})

// The strike step with the acting minion's hand strike chosen: the defending minion is to answer
function answeringStrike(
    acting: Partial<SimCombatant>,
    defending: Partial<SimCombatant>,
): CombatSim {
    const sim = simPassUntil(simFight(acting, defending), CombatStep.Strike)
    return applyMove(sim, {
        type: 'strike',
        strike: newStrike('Hand strike', { damage: sim.acting.strength, isHand: true }),
    }).sim
}

// A combat played to its end: the sides in `planning` choose by the plan, the other by the policy. The line is what
// each side did that was not a pass, in order.
function playPlanned(sim: CombatSim, planning: Side[]): { sim: CombatSim; line: string[] } {
    const line: string[] = []
    let current = sim
    for (let i = 0; i < 200 && !current.closed; i++) {
        const side = current.impulsePlayer
        const move =
            planning.includes(side) ?
                planMove(PLAN_WEIGHTS, current, []).move
            :   chooseMove(PLAN_WEIGHTS.policy, current)
        if (move.type != 'pass') {
            line.push(`${side}: ${describeMove(current, move)}`)
        }
        current = applyMove(current, move).sim
    }
    if (!current.closed) {
        throw new ScenarioFailure('The combat did not end')
    }
    return { sim: current, line }
}

const COMBAT_PLAN_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'Combat plan: a move the rules force is played as it is, and two cards that make the same move are one choice',
        run() {
            const forced = planMove(PLAN_WEIGHTS, simPassUntil(simFight(), CombatStep.Strike), [])
            expectEqual(forced.options.length, 0, 'nothing to weigh with the hand strike alone')
            expectEqual(forced.move.type, 'strike', 'the hand strike')
            const twins = planMove(
                PLAN_WEIGHTS,
                answeringStrike({}, { cards: [DODGE_CARD, DODGE_CARD] }),
                [],
            )
            expectEqual(twins.options.length, 2, 'the hand strike and one dodge, not two')
        },
    },
    {
        name: 'Combat plan: a strike card that sends the other to torpor past its prevention is played, and the plan prints as the line it expects',
        run() {
            const sim = answeringStrike(
                { blood: 3, attached: [PREVENT_KIT] },
                { strength: 3, blood: 6, cards: [SLAM_CARD] },
            )
            const plan = planMove(PLAN_WEIGHTS, sim, [])
            expectEqual(plan.move.type, 'strike', 'a strike')
            expectEqual(
                plan.move.card,
                0,
                'with the card: 5 damage, less 1 prevented, still sends it to torpor',
            )
            const plain = plan.options.find(option => option.move.card === undefined)
            expectEqual(
                plan.options[0].value - (plain?.value ?? 0) > 1,
                true,
                'worth much more than the plain strike, which 1 prevention keeps out of torpor',
            )
            const line = planLine(PLAN_WEIGHTS, sim, plan.move)
            expectEqual(line[0], 'defending: strike Hand strike +2 (slam)', 'the plan, printed')
            expectEqual(describeMove(sim, plan.move), 'strike Hand strike +2 (slam)', 'its move')
        },
    },
    {
        name: 'Combat plan: the plan is never worse than the policy on the hands it was played against, and keeps the policy move when the others are not clearly better',
        run() {
            const sims = [
                answeringStrike(
                    { blood: 3, attached: [PREVENT_KIT] },
                    { strength: 3, cards: [SLAM_CARD] },
                ),
                answeringStrike({}, { cards: [DODGE_CARD, MANEUVER_CARD] }),
                simPassUntil(
                    simFight({ attached: [MAGNUM_KIT] }, { cards: [MANEUVER_CARD] }),
                    CombatStep.DetermineRange,
                ),
            ]
            for (const sim of sims) {
                const plan = planMove(PLAN_WEIGHTS, sim, [])
                const policy = chooseMove(PLAN_WEIGHTS.policy, sim)
                const asPolicy = plan.options.find(
                    option => JSON.stringify(option.move) == JSON.stringify(policy),
                )
                expectEqual(
                    plan.options[0].value >= (asPolicy?.value ?? -Infinity),
                    true,
                    'the best move is at least as good as the policy move',
                )
            }
            const even = simPassUntil(simFight(), CombatStep.DetermineRange)
            expectEqual(
                planMove(PLAN_WEIGHTS, even, []).move.type,
                chooseMove(PLAN_WEIGHTS.policy, even).type,
                'an even fight: the policy move',
            )
        },
    },
    {
        name: 'Combat plan: against a hand believed to hold dodges the strike that cannot be dodged is played, against an empty hand the free one',
        run() {
            const presence = { [Discipline.Presence]: DisciplineLevel.INFERIOR }
            const minion = fightProfile({ disciplines: presence })
            const sim = simPassUntil(
                simFight({ strength: 3, cards: [UNDODGEABLE_CARD] }, {}),
                CombatStep.Strike,
            )
            const plan = (size: number, dodge: number) =>
                planCombat(DEFAULT_PROFILE, sim, { minion, hand: { size, densities: { dodge } } })
            const dodged = plan(5, 1)
            expectEqual(
                dodged.move.type == 'strike' && dodged.move.card,
                0,
                'the card, which no dodge stops',
            )
            const open = plan(0, 1)
            expectEqual(
                open.move.type == 'strike' && open.move.card,
                undefined,
                'an empty hand cannot dodge: the free hand strike',
            )
            const again = plan(5, 1)
            expectEqual(
                JSON.stringify(again),
                JSON.stringify(dodged),
                'the same plan, with the same values, asked twice',
            )
        },
    },
    {
        name: 'Combat plan: a move is judged by the mix of the average of the hands and the worst of them, as much of the worst as the caution says',
        run() {
            const sim = simPassUntil(
                simFight({ strength: 3, cards: [UNDODGEABLE_CARD] }),
                CombatStep.Strike,
            )
            const hands = [[], [DODGE_CARD]]
            const plainStrike = (caution: number) =>
                planMove({ ...PLAN_WEIGHTS, caution }, sim, hands).options.find(
                    option => option.move.card === undefined,
                )
            const mean = plainStrike(0)
            const worst = plainStrike(1)
            const mixed = plainStrike(0.25)
            expectEqual(mean?.value, mean?.mean, 'no caution: the average')
            expectEqual(worst?.value, worst?.worst, 'all the caution: the worst')
            expectEqual(
                (worst?.worst ?? 0) < (worst?.mean ?? 0),
                true,
                'one hand dodges it: the worst is lower than the average',
            )
            expectClose(
                mixed?.value ?? 0,
                (mean?.mean ?? 0) + 0.25 * ((mean?.worst ?? 0) - (mean?.mean ?? 0)),
                'a quarter of the way to the worst',
                0.0001,
            )
        },
    },
    {
        name: 'Combat plan: planning its own later moves inside the rollouts values a move by what the minion will do right, not by what the policy would do',
        run() {
            const quickness = testCard('quickness', {
                kind: 'combat',
                when: [{ type: 'oncePerRound' }],
                effects: [additionalStrikeEffect({ limited: true })],
            })
            const sim = simFight(
                { blood: 4, strength: 2, strengthBonus: 1, cards: [quickness] },
                {
                    blood: 4,
                    strength: 1,
                    cards: [SLAM_CARD],
                    attached: [PREVENT_KIT, retainerKit('Raven', 1), retainerKit('Crows', 2)],
                },
            )
            const options = (depth: number) => planMove({ ...PLAN_WEIGHTS, depth }, sim, []).options
            const bonus = (depth: number) =>
                options(depth).find(option => option.move.type == 'strengthBonus')?.value ?? NaN
            expectEqual(
                bonus(1) > bonus(0) + 1,
                true,
                'the policy plays the strikes at the retainers badly, planning them is worth more',
            )
            expectEqual(
                planMove({ ...PLAN_WEIGHTS, depth: 1 }, sim, []).move.type,
                'strengthBonus',
                'with the strength bonus taken first',
            )
            expectEqual(bonus(2), bonus(1), 'one level of it is all this fight has to plan')
        },
    },
    {
        name: 'Combat plan: a card costs the pool it is paid with and the card itself, which the plan counts against what it wins',
        run() {
            const worth = (card: SimCard) => {
                const sim = answeringStrike({ blood: 1 }, { strength: 3, blood: 6, cards: [card] })
                const options = planMove(PLAN_WEIGHTS, sim, []).options
                const plain = options.find(option => option.move.card === undefined)
                const played = options.find(option => option.move.card === 0)
                return (plain?.value ?? NaN) - (played?.value ?? NaN)
            }
            expectClose(
                worth(SLAM_CARD),
                DEFAULT_PROFILE.combat.cardCost,
                'it sends to torpor either way: the card is the whole difference',
                0.0001,
            )
            expectClose(
                worth({ ...SLAM_CARD, poolCost: 4 }),
                DEFAULT_PROFILE.combat.cardCost + 4,
                'and 4 pool paid for it more',
                0.0001,
            )
        },
    },
    {
        name: 'Combat plan: the plan works on copies, the combat it is given is not changed',
        run() {
            const sim = answeringStrike(
                { attached: [PREVENT_KIT] },
                { cards: [SLAM_CARD, DODGE_CARD] },
            )
            const before = JSON.stringify(sim)
            planMove(PLAN_WEIGHTS, sim, [[DODGE_CARD], []])
            expectEqual(JSON.stringify(sim), before, 'the same combat after the plan')
        },
    },
    {
        name: 'Combat plan: the cards of a whole combat are played in their order: strength, range, Immortal Grapple, the strike, Taste of Vitae',
        run() {
            const potence = { [Discipline.Potence]: DisciplineLevel.INFERIOR }
            const signpost = testCard('signpost', {
                kind: 'combat',
                when: [beforeRangeCondition],
                effects: [setStrengthEffect(3)],
            })
            const knife: AttachedKit = {
                ...MAGNUM_KIT,
                name: 'Knife',
                strikes: [{ damage: 2, ranged: false, aggravated: false, maneuver: false }],
            }
            const cards = [
                signpost,
                MANEUVER_CARD,
                ...combatCards({ ...CARD_USER, disciplines: potence }, [
                    factsOfCard('100959', 'Immortal Grapple'),
                    factsOfCard('101945', 'Taste of Vitae'),
                ]),
            ]
            const fight = (held: AttachedKit[]) =>
                playPlanned(
                    simFight(
                        { strength: 1, blood: 6, cards },
                        { strength: 1, blood: 6, attached: held },
                    ),
                    ['acting', 'defending'],
                )
            // A knife at close range: the grapple leaves it nothing but a hand strike
            const knifed = fight([knife])
            expectEqual(
                knifed.line.join(' | '),
                'acting: strength 3 (signpost) | acting: grapple (Immortal Grapple) | acting: strike Hand strike | defending: strike Hand strike | acting: gainBlood 3 (Taste of Vitae)',
                'strength, grapple, strike, blood',
            )
            // A Magnum: the other goes to long range, the answer brings the fight back to close range
            const shot = fight([MAGNUM_KIT])
            expectEqual(
                shot.line.join(' | '),
                'acting: strength 3 (signpost) | defending: maneuver | acting: maneuver (maneuver) | acting: strike Hand strike | acting: gainBlood 3 (Taste of Vitae)',
                'strength, range, strike, blood',
            )
            for (const { sim } of [knifed, shot]) {
                expectEqual(sim.defending.bloodLost > 0, true, 'the other side was hurt')
            }
        },
    },
    {
        name: 'Combat plan: the rulebook examples of aggravated damage, played by the plan: Nassir and Tamoszius go to torpor, a vampire that cannot pay is burned',
        run() {
            const claws = (damage: number): AttachedKit => ({
                ...MAGNUM_KIT,
                name: 'Claws',
                strikes: [{ damage, ranged: false, aggravated: true, maneuver: false }],
            })
            const played = (
                acting: Partial<SimCombatant>,
                blood: number,
            ): { sim: CombatSim; line: string[] } =>
                playPlanned(simFight(acting, { strength: 1, blood }), ['acting'])
            // Nassir: 1 blood, 1 aggravated damage: wounded, torpor with 1 blood
            const nassir = played({ attached: [claws(1)] }, 1)
            expectEqual(nassir.sim.defending.state, 'torpor', 'Nassir: torpor')
            expectEqual(nassir.sim.defending.blood, 1, 'Nassir: with 1 blood')
            // Tamoszius: 2 blood, 3 aggravated damage: wounded by 1, burns 2 blood for the others, torpor with 0
            const tamoszius = played({ attached: [claws(3)] }, 2)
            expectEqual(tamoszius.sim.defending.state, 'torpor', 'Tamoszius: torpor')
            expectEqual(tamoszius.sim.defending.blood, 0, 'Tamoszius: with 0 blood')
            // Ryan's example, as far as one strike goes: aggravated damage that a vampire has no blood to pay for burns it,
            // and the plan prefers the claws to the hand strike that only sends it to torpor
            const ryan = played({ strength: 2, attached: [claws(2)] }, 0)
            expectEqual(ryan.sim.defending.state, 'burned', 'Ryan: burned')
            for (const { line } of [nassir, tamoszius, ryan]) {
                expectEqual(
                    line.some(move => move.startsWith('acting: strike Claws')),
                    true,
                    'the plan chose the claws',
                )
            }
        },
    },
]

/**
 * The plan of a combat played from the engine, and the gate before an action that starts one: the
 * agent reads the combat it is in, plans it with the cards it holds, and a minion enters combat only when the
 * fight it forecasts is worth it.
 */

// The combats an action of a card in the decision starts
function startsOf(decision: DecisionPoint) {
    return optionsOfType(decision.options, 'declareAction').flatMap(option => {
        const candidate = candidateOf(option)
        const start = combatStartOf(candidate)
        return start && option.action.type == MinionActionType.ActionCardFromHand ?
                [{ candidate, start }]
            :   []
    })
}

// What the minion of Line Brawl is expected to gain from entering combat with the minion of its prey
function brawlGate(turn: ReturnType<typeof createLineBrawlTurn>) {
    const view = createPlayerView(turn.gameState, turn.player)
    try {
        const decision = getDecisionPoint(view.gameState, view.player)
        if (!decision) {
            throw new ScenarioFailure('No decision point')
        }
        const starts = startsOf(decision)
        if (starts.length != 1) {
            throw new ScenarioFailure(`${starts.length} combats are started, not one`)
        }
        const assessment = assess(view.gameState, view.player, DEFAULT_PROFILE)
        const [{ candidate, start }] = starts
        return {
            allowed: combatStartAllowed(assessment, candidate),
            gain: combatStartGain(assessment, candidate, start),
        }
    } finally {
        view.dispose()
    }
}

function setBrawlers(
    turn: ReturnType<typeof createLineBrawlTurn>,
    mine: { strength: number; blood: number },
    theirs: { strength: number; blood: number },
) {
    for (const [minion, side] of [
        [turn.ready, mine],
        [turn.target, theirs],
    ] as const) {
        minion.minionAttrs.strength = side.strength
        minion.minionAttrs.capacity = 10
        minion.blood = side.blood
    }
}

const LIVE_COMBAT_SCENARIOS: { name: string; run: () => void }[] = [
    {
        name: 'Live combat: the agent reads the engine combat and plays the strike card that sends the other to torpor',
        run() {
            const fight = createBrujahFight(ROUNDHOUSE_ID, DisciplineLevel.SUPERIOR)
            passUntil(fight, CombatStep.Strike)
            const decision = getCombatDecision(fight, fight.actingPlayer)
            const option = chooseThroughView(decision, new UtilityAgent(BrujahDeck))
            if (option.type != 'combatStrike' || option.card != fight.card) {
                throw new ScenarioFailure(`The agent chose ${option.type}, not the Roundhouse`)
            }
            expectEqual(option.strike.damage >= 3, true, 'a strike that reaches the blood')
        },
    },
    {
        name: 'Live combat: two agents play an engine combat to its end, the one with the strike card sends the other to torpor',
        run() {
            const fight = createBrujahFight(ROUNDHOUSE_ID, DisciplineLevel.SUPERIOR)
            const agent = new UtilityAgent(BrujahDeck)
            for (let moves = 0; fight.gameState.combat; moves++) {
                if (moves > 100) {
                    throw new ScenarioFailure('The combat does not end')
                }
                const player = getDecidingPlayer(fight.gameState)
                const decision = player && getDecisionPoint(fight.gameState, player)
                if (!decision || decision.kind != DecisionKind.Combat) {
                    throw new ScenarioFailure('The combat is stuck')
                }
                applyOption(decision, chooseThroughView(decision, agent))
            }
            expectRegion(fight.defending, 'torpor')
            expectRegion(fight.acting, 'ready')
        },
    },
    {
        name: 'Enter combat gate: Line Brawl into a minion that my minion beats is allowed, into one that beats it is not',
        run() {
            const weak = createLineBrawlTurn()
            setBrawlers(weak, { strength: 3, blood: 8 }, { strength: 1, blood: 2 })
            const allowed = brawlGate(weak)
            expectEqual(allowed.allowed, true, 'a fight won')
            expectEqual(allowed.gain > 0.5, true, 'it gains more than the margin')

            const strong = createLineBrawlTurn()
            setBrawlers(strong, { strength: 1, blood: 3 }, { strength: 6, blood: 8 })
            const refused = brawlGate(strong)
            expectEqual(refused.allowed, false, 'a fight lost')
            expectEqual(refused.gain < 0, true, 'it costs')
        },
    },
    {
        name: 'Enter combat gate: the kit I hold counts, a Roundhouse makes the same fight worth more',
        run() {
            const gain = (kit: boolean) => {
                const turn = createLineBrawlTurn()
                turn.ready.minionAttrs.disciplines[Discipline.Potence] = DisciplineLevel.SUPERIOR
                setBrawlers(turn, { strength: 2, blood: 5 }, { strength: 2, blood: 5 })
                // The other hand is empty: nothing is drawn from a belief, so the two fights are compared exactly
                emptyHand(turn.gameState, turn.victim)
                if (kit) {
                    giveCard(turn.gameState, turn.player, ROUNDHOUSE_ID)
                }
                return brawlGate(turn).gain
            }
            expectEqual(gain(true) > gain(false), true, 'the Roundhouse is in the fight')
        },
    },
    {
        name: 'Enter combat gate: the agent does not offer the base rules a combat that the position refuses, and offers one it allows',
        run() {
            const offered = (mine: { strength: number; blood: number }, theirs: typeof mine) => {
                const turn = createLineBrawlTurn()
                setBrawlers(turn, mine, theirs)
                let starts = 0
                const spy: BotAgent = {
                    choose(viewDecision) {
                        starts += startsOf(viewDecision).length
                        return (
                            viewDecision.options.find(option => option.type == 'endPhase') ??
                            viewDecision.options[0]
                        )
                    },
                }
                const decision = getDecisionPoint(turn.gameState, turn.player)
                if (!decision) {
                    throw new ScenarioFailure('No decision point')
                }
                chooseThroughView(
                    decision,
                    new UtilityAgent(BrujahDeck, DEFAULT_PROFILE, undefined, spy),
                )
                return starts
            }
            expectEqual(
                offered({ strength: 3, blood: 8 }, { strength: 1, blood: 2 }) > 0,
                true,
                'allowed',
            )
            expectEqual(offered({ strength: 1, blood: 3 }, { strength: 6, blood: 8 }), 0, 'refused')
        },
    },
]

function runScenarios(filters: string[]): ScenarioResult[] {
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
        ...WARRENS_SCENARIOS,
        ...ANIMALISM_REACTION_SCENARIOS,
        ...CATS_GUIDANCE_SCENARIOS,
        ...EVENT_SCENARIOS,
        ...ALINE_SCENARIOS,
        ...NOSFERATU_SCENARIOS,
        ...LABYRINTH_SCENARIOS,
        ...CROWS_SCENARIOS,
        ...ATTACHMENT_SCENARIOS,
        ...PUT_ON_SCENARIOS,
        ...GUARDIAN_ANGEL_SCENARIOS,
        ...UTILITY_SCENARIOS,
        ...SUMMARY_SCENARIOS,
        ...ASSESSMENT_SCENARIOS,
        ...PLAN_SCENARIOS,
        ...BLOAT_SCENARIOS,
        ...COMBAT_MODEL_SCENARIOS,
        ...COMBAT_POSITION_SCENARIOS,
        ...COMBAT_PLAN_SCENARIOS,
        ...LIVE_COMBAT_SCENARIOS,
    ]
        .filter(({ name }) => filters.some(filter => name.toLowerCase().includes(filter)))
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
