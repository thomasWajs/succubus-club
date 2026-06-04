import { acceptHMRUpdate } from 'pinia'
import { defineOptionStore } from 'pinia-class-transformer'
import { GameState } from '@/shared/state/gameState.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { Card } from '@/shared/model/Card.ts'
import { AnyCardRegion } from '@/shared/types/model.ts'
import { KnownCards } from '@/shared/types/state.ts'

export class ClientGameState extends GameState {
    updateKnownCards(knownCards?: KnownCards) {
        if (!knownCards) {
            return
        }

        const newCardsOid = Object.keys(knownCards).filter(k => !(k in this.knownCards))
        this.knownCards = { ...this.knownCards, ...knownCards }
        // Init minionAttrs for cards we just revealed
        for (const cardOid of newCardsOid) {
            this.cards[cardOid].initMinionAttrs()
        }
    }

    moveCardToRegion(card: Card, to: AnyCardRegion, position: number = 0) {
        const { leftPlay } = super.moveCardToRegion(card, to, position)

        // Game state is clearly not the ideal place to put this,
        // but it's the central point for moving cards around regions.
        // If someone has a better idea, feel free to refactor.
        if (leftPlay) {
            const gameBus = useGameBusStore()
            // Deselect a card when moved out of the play area.
            gameBus.removeFromSelection(card)
            // Remove from card group when moved out of the play area.
            gameBus.removeFromCardGroup(card)
        }

        return { leftPlay }
    }
}

export const useGameStateStore = defineOptionStore('gameState', ClientGameState)

if (import.meta.hot) {
    import.meta.hot.accept(acceptHMRUpdate(useGameStateStore, import.meta.hot))
}
