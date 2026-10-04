import { Player } from '@/shared/model/Player.ts'
import { applyOption, getDecisionPoint } from '@/shared/bot/referee.ts'
import { chooseThroughView } from '@/shared/bot/playerView.ts'
import { BotAgent, BotOption, DecisionPoint } from '@/shared/bot/types.ts'

export type BotStep = {
    decision: DecisionPoint
    option: BotOption
    // True when the option was the only one: the agent was not consulted
    forced: boolean
}

/**
 * Make one decision for a player and apply it.
 * Returns null when it is not this player's turn to decide.
 */
export function stepBot(player: Player, agent: BotAgent): BotStep | null {
    const decision = getDecisionPoint(player.gameState, player)
    if (!decision) {
        return null
    }

    const forced = decision.options.length == 1
    const option = forced ? decision.options[0] : chooseThroughView(decision, agent)
    applyOption(decision, option)
    return { decision, option, forced }
}
