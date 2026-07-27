<template>
    <div id="RightColumnPlayers">
        <div
            class="header"
            @click="isCollapsed = !isCollapsed"
        >
            <span class="header-text">Connected ({{ connectedUsersCount }})</span>
            <span
                class="toggle-arrow"
                :class="{ isCollapsed }"
                >▼</span
            >
        </div>
        <div v-if="!isCollapsed">
            <div
                v-for="player in gameState.players"
                :key="player.oid"
                class="player"
                :class="{
                    acting: player === gameState.activePlayer,
                    ousted: player.isOusted,
                    disconnected: disconnectedPlayers[player.oid],
                }"
            >
                <span
                    v-if="player == gameState.activePlayer"
                    class="active-player"
                    >▶
                </span>

                <span v-if="player.isOusted"> 💀 </span>
                <span
                    class="player-name"
                    :style="{ color: player.rgbaColor }"
                >
                    {{ player.shortName }}
                </span>

                <span
                    class="visibility-icon"
                    :title="players.hiddenPlayers.has(player.oid) ? 'Hidden' : 'Visible'"
                    @click="players.toggleHidden(player.oid)"
                    >{{ players.hiddenPlayers.has(player.oid) ? '🙈' : '👁️' }}</span
                >

                <span
                    v-if="player.isBot"
                    class="role-icon"
                >
                    🤖
                </span>
                <span
                    v-else-if="disconnectedPlayers[player.oid]"
                    class="role-icon"
                >
                    🔌
                </span>
                <span
                    v-else
                    class="role-icon"
                >
                    👤
                </span>
            </div>

            <template
                v-if="gameState.gameType == GameType.Multiplayer && spectatorUsers.length > 0"
            >
                <div class="separator" />
                <div
                    v-for="spectator in spectatorUsers"
                    :key="spectator.permId"
                    class="player spectator"
                >
                    <span class="player-name">
                        {{ spectator.name }}
                    </span>
                    <span class="role-icon spectator-icon">👁️</span>
                </div>
            </template>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useGameStateStore } from '@/client/store/gameState.ts'
import { computed, ref } from 'vue'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { GameType } from '@/shared/types/state.ts'
import { usePlayersStore } from '@/client/state/players.ts'

const gameState = useGameStateStore()
const multiplayer = useMultiplayerStore()
const players = usePlayersStore()

const isCollapsed = ref(true)

const disconnectedPlayers = computed(() => {
    if (gameState.gameType != GameType.Multiplayer) {
        return {}
    }

    return Object.fromEntries(
        Object.values(gameState.players).map(player => [
            player.oid,
            multiplayer.users[player.permId] === undefined,
        ]),
    )
})

const spectatorUsers = computed(() => {
    if (!multiplayer.currentGameRoom) {
        return []
    }
    return multiplayer.currentGameRoom.spectators
        .map(permId => multiplayer.users[permId])
        .filter(user => user !== undefined)
})

const connectedUsersCount = computed(() => {
    const playersCount = Object.values(gameState.players).filter(
        player => !disconnectedPlayers.value[player.oid],
    ).length
    const spectatorsCount = spectatorUsers.value.length
    return playersCount + spectatorsCount
})
</script>

<style lang="scss" scoped>
// Windows
$window-top: 475px;
$window-right: 340px;

#RightColumnPlayers {
    margin: 4px 0;
    background: $right-column-section-bg;

    .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 8px;
        cursor: pointer;
        user-select: none;

        .header-text {
            flex: 1;
        }

        .toggle-arrow {
            transition: transform 0.2s ease;
            font-size: 12px;

            &.isCollapsed {
                transform: rotate(-90deg);
            }
        }
    }

    .separator {
        height: 1px;
        background: $mist-grey;
        margin: 4px 0;
    }

    .player {
        display: flex;
        align-items: center;
        padding: 3px 3px;

        min-width: 0; /* Important for ellipsis to work */
        white-space: nowrap;
        overflow: hidden;
        gap: 4px;

        &.acting {
            background: rgba($vibrant-emerald, 0.3);
        }
        &.disconnected {
            background: rgba($crimson-red, 0.6);
        }
        &.ousted {
            background: $mist-grey;
        }

        .active-player {
            color: $dark-forest;
            font-weight: bold;
        }

        .disconnected {
            color: $blood-red;
            flex-shrink: 0;
        }

        .player-name {
            display: inline-block;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            min-width: 0; /* Important for ellipsis to work */
            flex-grow: 1;
        }

        .visibility-icon {
            flex-shrink: 0;
            font-size: 12px;
            cursor: pointer;
        }

        .role-icon {
            flex-shrink: 0;
            font-size: 14px;
        }
    }
}
</style>
