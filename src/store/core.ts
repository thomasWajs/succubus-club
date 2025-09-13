import Phaser from 'phaser'
import { acceptHMRUpdate, defineStore } from 'pinia'
import { GameType } from '@/state/types.ts'
import { Conductor } from '@/bot/conductor.ts'
import { DbDeck, DbUserProfile } from '@/gateway/db.ts'
import { Deck } from '@/gateway/deck.ts'
import { shallowRef } from 'vue'

const userProfile = await DbUserProfile.get()
let lastDeck = null as Deck | null
if (userProfile.lastDeckId) {
    lastDeck = await DbDeck.get(userProfile.lastDeckId)
}

// Keep the Phaser.Game instance non-reactive by storing it here instead of the store.
// It helps with the performances.
const phaserGame = shallowRef<Phaser.Game | null>(null)

export function setPhaserGame(game: Phaser.Game | null) {
    phaserGame.value = game
}

export const useCoreStore = defineStore('core', {
    state: () => ({
        gameType: GameType.TrainBot,

        gameIsStarted: false,
        resourcesAreReady: false,
        phaserIsReady: false,
        gameStateIsReady: false,

        userProfile,
        selfDeck: lastDeck as Deck | null,

        conductor: null as Conductor | null,
    }),
    getters: {
        phaserGame() {
            if (!phaserGame.value) {
                throw new Error(
                    'Phaser game is not ready. Make sure to call setPhaserGame() before using it.',
                )
            }
            return phaserGame.value
        },
        gameIsReady(): boolean {
            return this.resourcesAreReady && this.phaserIsReady && this.gameStateIsReady
        },
    },
    actions: {},
})

if (import.meta.hot) {
    import.meta.hot.accept(acceptHMRUpdate(useCoreStore, import.meta.hot))
}
