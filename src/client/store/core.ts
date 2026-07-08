import Phaser from 'phaser'
import { acceptHMRUpdate, defineStore } from 'pinia'
import { GameType } from '@/shared/types/state.ts'
import { Conductor } from '@/client/bot/conductor.ts'
import { DbDeck, DbUserProfile } from '@/client/gateway/db.ts'
import { shallowRef } from 'vue'
import { storeAvatar } from '@/client/gateway/user.ts'
import { initTabletopBackground } from '@/client/gateway/background.ts'

const userProfile = await DbUserProfile.get()

// Load the custom tabletop background (if any) before the app renders, so both the
// loading screen and the game show it right away.
await initTabletopBackground()
let lastDeck = null as DbDeck | null
if (userProfile.lastDeckId) {
    lastDeck = await DbDeck.get(userProfile.lastDeckId)
}
// User has an avatar, but it's not stored to firebase. We ned to upload it.
if (userProfile.avatar && !userProfile.avatarFirebaseId) {
    storeAvatar(userProfile)
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
        selfDeck: lastDeck as DbDeck | null,

        conductor: null as Conductor | null,
    }),
    getters: {
        phaserGame(): Phaser.Game {
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
