import { computed } from 'vue'
import { display } from '@/client/game/display.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { GameType } from '@/shared/types/state.ts'

/**
 * A game with the rules engine, on a table of 4 players or less : the seat left free at the bottom
 * right holds the side panel, the turn and its phases above the engine's decision. The top area
 * is all the central box's then ( see GameTopArea, EngineDecisionPanel ).
 */
export function useEngineSide() {
    const gameState = useGameStateStore()
    const players = usePlayersStore()
    return computed(
        () =>
            gameState.gameType == GameType.Engine &&
            display.rightColumnVisible &&
            players.orderedPlayers.length <= 4,
    )
}
