import { acceptHMRUpdate } from 'pinia'
import { defineOptionStore } from 'pinia-class-transformer'
import { GameState } from '@/shared/state/gameState.ts'
import { Player } from '@/shared/model/Player.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { Card } from '@/shared/model/Card.ts'
import { AnyCardRegion, PlayerOid } from '@/shared/types/model.ts'
import { KnownCards } from '@/shared/types/state.ts'

export class ClientGameState extends GameState {
    // May be undefined for spectators
    get selfPlayerOid(): PlayerOid | undefined {
        return this.usersToPlayer[useCoreStore().userProfile.permanentId]
    }

    // May be undefined for spectators, or during temporary loading states
    get selfPlayer(): Player | undefined {
        return this.selfPlayerOid ? this.players[this.selfPlayerOid] : undefined
    }

    get selfIsActive(): boolean {
        return this.activePlayer && this.selfPlayerOid ?
                this.selfPlayerOid == this.activePlayer.oid
            :   false
    }

    get isPlayer(): boolean {
        return !!this.selfPlayerOid
    }

    get isSpectator(): boolean {
        return !this.selfPlayerOid
    }

    // If user is a player, returns self player.
    // If user is a spectator, arbitrarily use the first player
    get centralPlayer(): Player {
        return this.selfPlayer ? this.selfPlayer : this.orderedPlayers[0]
    }

    get centralPlayerSeatingIndex(): number {
        return this.turnOrder.findIndex(playerOid => playerOid === this.centralPlayer.oid)
    }

    updateKnownCards(knownCards?: KnownCards) {
        if (knownCards) {
            this.knownCards = { ...this.knownCards, ...knownCards }
        }
    }

    /**
     * Return a neighbour player, starting at central player
     * 0 will return self player, 1 will return prey, 2 will return grandprey, etc...
     */
    getNthNeighbour(n: number) {
        return this.orderedPlayers[
            (this.centralPlayerSeatingIndex + n) % this.orderedPlayers.length
        ]
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
