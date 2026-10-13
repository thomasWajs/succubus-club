import { Vampire } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { MinionActionType } from '@/shared/types/state.ts'
import { TurnSequence, TurnPhase, LEAVE_TORPOR_COST } from '@/shared/const/model.ts'
import { GovernAgent } from '@/shared/bot/agents/governAgent.ts'
import { createHeadlessGame } from '../harness.ts'
import { GovernDeck } from '@/shared/bot/decks.ts'
import { getDecisionPoint, getDecidingPlayer, applyOption } from '@/shared/bot/referee.ts'
import { stepBot } from '@/shared/bot/driver.ts'
import { BaseAgent } from '@/shared/bot/agents/baseAgent.ts'
import { optionsOfType } from '@/shared/bot/types.ts'
import {
    Scenario,
    ScenarioFailure,
    createdGames,
    expectEqual,
    expectRegion,
    readyVampire,
} from './helpers.ts'

/**
 * Torpor actions: what the referee offers in the minion phase once combat sends
 * vampires to torpor, and what they do once nobody blocks.
 */

export class PassiveAgent extends BaseAgent {}

export type Turn = { gameState: GameState; player: Player; ready: Vampire; torpid: Vampire }

export function createMinionPhase(
    readyBlood: number,
    torpidBlood: number,
    deck = GovernDeck,
): Turn {
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

export function getActionOptions(turn: Turn, type: MinionActionType) {
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
export function resolveAction(turn: Turn): void {
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

export const TORPOR_SCENARIOS: Scenario[] = [
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
