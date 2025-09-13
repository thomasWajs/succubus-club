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
import TopPanel from './TopPanel.vue'
import { useCoreStore } from '@/store/core.ts'
import { useBusStore } from '@/store/bus.ts'
import { shallowRef } from 'vue'
import { GameType } from '@/state/types.ts'
import { createGameRoom, joinLobby } from '@/multiplayer/lobby.ts'
import { setupSavedGame, startGame } from '@/game/setup.ts'
import { db, DbSavedGame } from '@/gateway/db.ts'
import * as logging from '@/logging.ts'

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
        return
    }

    bus.isSavedGamesPanelOpen = false

    if (savedGame.gameType === GameType.Multiplayer) {
        joinLobby()
        createGameRoom(savedGame.roomName, savedGame.seating, true)
        core.userProfile.setLastMultiGame(savedGame.roomName)
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
