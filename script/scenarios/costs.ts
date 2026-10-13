import { MinionActionType } from '@/shared/types/state.ts'
import { DisciplineLevel } from '@/shared/const/model.ts'
import { GOVERN_ID } from '@/shared/cardImpl/cardIds.ts'
import { createHeadlessGame } from '../harness.ts'
import { GovernDeck } from '@/shared/bot/decks.ts'
import { applyOption, getDecidingPlayer } from '@/shared/bot/referee.ts'
import { stepBot } from '@/shared/bot/driver.ts'
import { BaseAgent } from '@/shared/bot/agents/baseAgent.ts'
import { DecisionPoint, BotOption } from '@/shared/bot/types.ts'
import {
    Scenario,
    ScenarioFailure,
    createdGames,
    expectEqual,
    giveCard,
    readyVampire,
} from './helpers.ts'
import { PassiveAgent, createMinionPhase, getActionOptions } from './torpor.ts'

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

export const COST_SCENARIOS: Scenario[] = [
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
