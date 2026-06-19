<template>
    <TopPanel
        :isOpen="bus.isSavedGamesPanelOpen"
        @open="getAllSavedGames()"
        @close="bus.isSavedGamesPanelOpen = false"
    >
        <template #title> Saved Games ({{ savedGames.length }})</template>

        <div class="saved-games-section">
            <div class="saved-games-list">
                <div
                    v-if="savedGames.length === 0"
                    class="no-saves-message"
                >
                    No saved games available.
                </div>

                <div
                    v-for="savedGame in savedGames"
                    :key="savedGame.id"
                    class="saved-game-item"
                >
                    <div class="save-info-left">
                        <span class="red-badge game-type-badge">{{ savedGame.gameType }}</span>
                        <h4 class="save-name">{{ savedGame.name }}</h4>
                    </div>
                    <div class="save-info-right">
                        <span
                            v-if="savedGame.roomName"
                            class="purple-badge"
                        >
                            {{ savedGame.roomName }}
                        </span>
                        <button
                            class="load-btn"
                            @click="continueSavedGame(savedGame)"
                        >
                            Load →
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </TopPanel>
</template>

<script setup lang="ts">
import TopPanel from '@/client/ui/components/TopPanel.vue'
import { useCoreStore } from '@/client/store/core.ts'
import { useBusStore } from '@/client/store/bus.ts'
import { shallowRef } from 'vue'
import { GameType } from '@/shared/types/state.ts'
import { createGameRoom, joinLobby } from '@/client/multiplayer/lobby.ts'
import { setupSavedGame, startGame } from '@/client/state/setup.ts'
import { db, DbSavedGame } from '@/client/gateway/db.ts'
import * as logging from '@/client/logging.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import router, { ROUTES } from '@/client/ui/router.ts'

const core = useCoreStore()
const bus = useBusStore()

// Use a shallowRef to avoid unnecessary reactivity on the whole gameState
const savedGames = shallowRef<DbSavedGame[]>([])

async function getAllSavedGames() {
    savedGames.value = await db.savedGames.orderBy('date').reverse().toArray()
}

function continueSavedGame(savedGame: DbSavedGame) {
    if (core.gameIsStarted) {
        throw new Error(`Game is already started`)
    }

    bus.isSavedGamesPanelOpen = false

    // Multiplayer
    if (savedGame.gameType === GameType.Multiplayer) {
        joinLobby()

        const multiplayer = useMultiplayerStore()
        // @ts-expect-error known Dexie + TypeScript issue
        multiplayer.restoringSavedGame = savedGame

        createGameRoom(
            savedGame.roomName,
            savedGame.password,
            savedGame.communication,
            !!savedGame.enableAids,
            !!savedGame.allowSpectators,
            savedGame,
        )
        core.userProfile.setLastMultiGame(savedGame.roomName)

        router.push({ name: ROUTES.Lobby })
    }
    // Trainbot
    else {
        try {
            setupSavedGame(savedGame)
            startGame(savedGame.gameType)
        } catch (error) {
            let message = 'An error occurred while starting the game'
            if (error instanceof Error) {
                message = `${message} : ${error.message}`
            }
            bus.alertError(message)
            logging.captureException(error)
        }
    }
}
</script>

<style lang="scss" scoped>
.saved-games-section {
    max-width: 1000px;
    margin: 0 auto;
}

.saved-games-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.no-saves-message {
    @include hero-message;
}

.saved-game-item {
    @include list-item;
}

.save-info-left {
    flex: 1;
    display: flex;
    flex-direction: row;
    gap: 0.5rem;
}

.game-type-badge {
    width: 50px;
}

.save-name {
    color: $pearl-grey;
    font-size: 1rem;
    font-weight: 600;
    margin: 0;
}

.save-info-right {
    display: flex;
    align-items: center;
    gap: 1rem;
}

.load-btn {
    @include button-dark-grey;
    padding: 0.5rem 0.75rem;
}
</style>
