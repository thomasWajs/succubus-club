import { MinionActionType, CombatStep } from '@/shared/types/state.ts'
import { DisciplineLevel, Discipline } from '@/shared/const/model.ts'
import { createPlayerView, chooseThroughView } from '@/shared/bot/playerView.ts'
import { BrujahDeck } from '@/shared/bot/decks.ts'
import { getDecisionPoint, getDecidingPlayer, applyOption } from '@/shared/bot/referee.ts'
import { UtilityAgent } from '@/shared/bot/agents/utilityAgent.ts'
import { DEFAULT_PROFILE } from '@/shared/bot/utility/profile.ts'
import { assess } from '@/shared/bot/utility/assessment.ts'
import { PlayValues } from '@/shared/bot/utility/cardActions.ts'
import { candidateOf } from '@/shared/bot/utility/turnPlan.ts'
import { combatStartOf, combatStartGain } from '@/shared/bot/utility/enterCombat.ts'
import { DecisionPoint, optionsOfType, DecisionKind } from '@/shared/bot/types.ts'
import { createLineBrawlTurn } from './brujahAction.ts'
import {
    Scenario,
    ScenarioFailure,
    expectEqual,
    expectRegion,
    giveCard,
    passUntil,
} from './helpers.ts'
import { createBrujahFight } from './brujah.ts'
import { getCombatDecision } from './combatCards.ts'
import { emptyHand } from './bounce.ts'
import { ROUNDHOUSE_ID } from '../cardIds.ts'

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
            allowed: new PlayValues(assessment).valueOf(candidate).value > 0,
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

export const LIVE_COMBAT_SCENARIOS: Scenario[] = [
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
        name: 'Enter combat gate: the agent does not start a combat that the position refuses',
        run() {
            const chosen = (mine: { strength: number; blood: number }, theirs: typeof mine) => {
                const turn = createLineBrawlTurn()
                setBrawlers(turn, mine, theirs)
                const decision = getDecisionPoint(turn.gameState, turn.player)
                if (!decision) {
                    throw new ScenarioFailure('No decision point')
                }
                const option = chooseThroughView(decision, new UtilityAgent(BrujahDeck))
                return option.type == 'declareAction' && !!combatStartOf(candidateOf(option))
            }
            expectEqual(
                chosen({ strength: 1, blood: 3 }, { strength: 6, blood: 8 }),
                false,
                'refused',
            )
        },
    },
]
