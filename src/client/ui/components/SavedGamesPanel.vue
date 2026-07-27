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
                        <span
                            v-if="savedGame.game?.version !== GAME_STATE_VERSION"
                            title="This saved game is too old, and not compatible with the current verion"
                            class="obsolete-badge"
                        >
                            obsolete
                        </span>
                        <h4
                            class="save-name"
                            :class="{ obsolete: savedGame.game?.version !== GAME_STATE_VERSION }"
                        >
                            {{ savedGame.name }}
                        </h4>
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
                        <div
                            v-if="confirmingDeleteId === savedGame.id"
                            class="delete-confirm-container"
                        >
                            <span class="delete-confirm-text">Are you sure ?</span>
                            <button
                                class="delete-confirm-btn yes-btn"
                                @click="deleteSavedGame(savedGame.id)"
                            >
                                yes
                            </button>
                            <span class="delete-confirm-separator">/</span>
                            <button
                                class="delete-confirm-btn no-btn"
                                @click="cancelDelete()"
                            >
                                no
                            </button>
                        </div>
                        <button
                            v-else
                            class="delete-btn"
                            @click="confirmDelete(savedGame.id)"
                        >
                            Delete
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
import { ref, shallowRef } from 'vue'
import { GameType } from '@/shared/types/state.ts'
import { createGameRoom, joinLobby } from '@/client/multiplayer/lobby.ts'
import { setupSavedGame, startGame } from '@/client/state/setup.ts'
import { db, DbSavedGame } from '@/client/gateway/db.ts'
import * as logging from '@/client/logging.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import router, { ROUTES } from '@/client/ui/router.ts'
import { GAME_STATE_VERSION } from '@/shared/const/multiplayer.ts'

const core = useCoreStore()
const bus = useBusStore()

const confirmingDeleteId = ref<number | null>(null)

// Use a shallowRef to avoid unnecessary reactivity on the whole gameState
const savedGames = shallowRef<DbSavedGame[]>([])

async function getAllSavedGames() {
    confirmingDeleteId.value = null
    savedGames.value = await db.savedGames.orderBy('date').reverse().toArray()
}

function confirmDelete(id: number) {
    confirmingDeleteId.value = id
}

function cancelDelete() {
    confirmingDeleteId.value = null
}

async function deleteSavedGame(id: number) {
    try {
        await db.savedGames.delete(id)
        await getAllSavedGames()
    } catch (error) {
        let message = 'An error occurred while deleting the game'
        if (error instanceof Error) {
            message = `${message} : ${error.message}`
        }
        bus.alertError(message)
        logging.captureException(error)
    } finally {
        confirmingDeleteId.value = null
    }
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
            startGame()
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
    align-items: center;
}

.game-type-badge {
    width: 50px;
}

.save-name {
    color: $pearl-grey;
    font-size: 1rem;
    font-weight: 600;
    margin: 0;

    &.obsolete {
        color: $mist-grey;
    }
}

.obsolete-badge {
    @include secondary-badge;
    background: $ash-grey;
    color: $pale-grey;
    border: 1px solid $bone-grey;
    border-radius: 0;
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

.delete-btn {
    @include button-red;
    padding: 0.5rem 0.75rem;
    border-radius: 0;
}

.delete-confirm-container {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.9rem;
    color: $pearl-grey;
}

.delete-confirm-text {
    margin-right: 0.25rem;
}

.delete-confirm-btn {
    cursor: pointer;
    font-family: serif;
    font-size: 0.85rem;
    transition: all 0.3s ease;
    border-radius: 0;

    &.yes-btn {
        @include button-red;
        border-radius: 0;
        padding: 0.25rem 0.5rem;
    }

    &.no-btn {
        @include button-dark-grey;
        border-radius: 0;
        padding: 0.25rem 0.5rem;
    }
}

.delete-confirm-separator {
    color: $bone-grey;
}
</style>
