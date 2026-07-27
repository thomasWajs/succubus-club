import { acceptHMRUpdate, defineStore } from 'pinia'
import { useCoreStore } from '@/client/store/core.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { Player } from '@/shared/model/Player.ts'
import { PlayerOid } from '@/shared/types/model.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { GameType } from '@/shared/types/state.ts'

export const usePlayersStore = defineStore('players', {
    state: () => ({
        /** Hidden players **/
        hiddenPlayers: new Set<PlayerOid>(),
    }),
    getters: {
        // Trigger special layout for 2-players games
        is2pGame(): boolean {
            return this.orderedPlayers.length == 2
        },

        /**
         * List players ( alias to gameState )
         */

        orderedPlayers(): Player[] {
            return useGameStateStore().orderedPlayers
        },
        competingPlayers(): Player[] {
            return useGameStateStore().competingPlayers
        },
        activePlayer(): Player | undefined {
            return useGameStateStore().activePlayer
        },

        /**
         * Self Player
         */

        // May be undefined for spectators
        selfPlayerOid(): PlayerOid | undefined {
            const gameState = useGameStateStore()
            return gameState.usersToPlayer[useCoreStore().userProfile.permanentId]
        },

        // May be undefined for spectators, or during temporary loading states
        // In Puppeteer mode, always tracks the active player so the user manages each turn
        selfPlayer(): Player | undefined {
            if (useGameStateStore().gameType === GameType.Puppeteer) {
                return this.activePlayer
            }
            const gameState = useGameStateStore()
            return this.selfPlayerOid ? gameState.players[this.selfPlayerOid] : undefined
        },

        selfIsActive(): boolean {
            if (useGameStateStore().gameType === GameType.Puppeteer) {
                return true
            }
            return this.activePlayer && this.selfPlayerOid ?
                    this.selfPlayerOid == this.activePlayer.oid
                :   false
        },

        isPlayer(): boolean {
            return !!this.selfPlayerOid
        },

        isSpectator(): boolean {
            return !this.selfPlayerOid
        },

        /**
         * Seating
         */

        // In focus mode, the central player is the active player
        // In standard mode, the central player is self player
        // For spectators, arbitrarily use the first player
        centralPlayer(): Player {
            const player = useGameBusStore().focusMode ? this.activePlayer : this.selfPlayer
            return player ?? this.orderedPlayers[0]

            // return this.selfPlayer ? this.selfPlayer : this.orderedPlayers[0]
        },

        centralPlayerSeatingIndex(): number {
            const gameState = useGameStateStore()
            return gameState.turnOrder.findIndex(playerOid => playerOid === this.centralPlayer.oid)
        },
    },
    actions: {
        /**
         * Return a neighbour player, starting at central player
         * 0 will return self player, 1 will return prey, 2 will return grandprey, etc...
         */
        getNthNeighbour(n: number): Player {
            return this.orderedPlayers[
                (this.centralPlayerSeatingIndex + n) % this.orderedPlayers.length
            ]
        },

        toggleHidden(oid: PlayerOid) {
            if (this.hiddenPlayers.has(oid)) {
                this.hiddenPlayers.delete(oid)
            } else {
                this.hiddenPlayers.add(oid)
            }
        },
    },
})

if (import.meta.hot) {
    import.meta.hot.accept(acceptHMRUpdate(usePlayersStore, import.meta.hot))
}
