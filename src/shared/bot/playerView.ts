import { GameState } from '@/shared/state/gameState.ts'
import { Player } from '@/shared/model/Player.ts'
import { deleteGameState } from '@/shared/registries.ts'
import {
    deserializeGameState,
    serializeGameState,
    serializeValueRecursive,
} from '@/shared/serialization.ts'
import { getKnownCards, redactUnknownCard } from '@/shared/state/cardVisibility.ts'
import { generateGameId } from '@/shared/state/ids.ts'
import { getDecisionPoint } from '@/shared/bot/referee.ts'
import { BotAgent, BotOption, DecisionPoint, InvalidBotMove } from '@/shared/bot/types.ts'

/**
 * Information hiding for agents: an agent never sees the live GameState, only a
 * copy of it where everything its player is not allowed to see is unknown
 * (opponents' hands, libraries and face-down crypt cards have no krcgId and no
 * attributes). Built with the same tooling as the SCS server's resync, so the
 * bot sees exactly what a human player would.
 */

export type PlayerView = {
    gameState: GameState
    player: Player
    // Unregisters the copy from the game state registry
    dispose: () => void
}

export function createPlayerView(gameState: GameState, player: Player): PlayerView {
    const knownCards = getKnownCards(gameState, player)

    const serialized = serializeGameState(gameState)
    serialized.knownCards = knownCards
    for (const card of Object.values(serialized.cards)) {
        redactUnknownCard(card, knownCards)
    }
    for (const card of Object.values(serialized.staleCards)) {
        redactUnknownCard(card, knownCards)
    }

    // The copy lives in the same process: it needs its own game id (cards,
    // players and regions are all rebuilt against it by the deserialization)
    const copy = new GameState()
    serialized.gameId = generateGameId()
    deserializeGameState(serialized, copy)

    return {
        gameState: copy,
        player: copy.players[player.oid],
        dispose: () => deleteGameState(copy.gameId),
    }
}

// Identifies an option across a state and its copy: they share every oid
function optionKey(option: BotOption): string {
    return JSON.stringify(serializeValueRecursive(option))
}

/**
 * Ask an agent to choose, showing it only the player's view. The referee builds
 * the options on the copy as it would on the live state; the chosen option is
 * mapped back to the live decision point by oid.
 *
 * The two option lists must match exactly: a difference means the referee read
 * information the player should not have, so it is a hard failure.
 */
export function chooseThroughView(decision: DecisionPoint, agent: BotAgent): BotOption {
    const view = createPlayerView(decision.player.gameState, decision.player)
    try {
        const viewDecision = getDecisionPoint(view.gameState, view.player)
        if (!viewDecision) {
            throw new InvalidBotMove(`No decision point in the view at ${decision.kind}`)
        }

        const liveKeys = decision.options.map(optionKey)
        const viewKeys = viewDecision.options.map(optionKey)
        if (liveKeys.length != viewKeys.length || liveKeys.some((key, i) => key != viewKeys[i])) {
            throw new InvalidBotMove(
                `The options differ between the game and the player's view at ${decision.kind}`,
            )
        }

        const chosen = agent.choose(viewDecision)
        const index = viewDecision.options.indexOf(chosen)
        if (index < 0) {
            throw new InvalidBotMove(`Option '${chosen.type}' is not offered at ${decision.kind}`)
        }
        return decision.options[index]
    } finally {
        view.dispose()
    }
}
