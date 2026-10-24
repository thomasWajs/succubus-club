<template>
    <div id="RightColumnPlayers">
        <div
            class="header"
            @click="isCollapsed = !isCollapsed"
        >
            <span class="header-text">Players ({{ Object.keys(gameState.players).length }})</span>
            <span
                class="toggle-arrow"
                :class="{ isCollapsed }"
                >▼</span
            >
        </div>
        <div v-if="!isCollapsed">
            <div class="separator">Players</div>
            <div
                v-for="player in gameState.players"
                :key="player.oid"
                class="player"
                :class="{
                    acting: player === gameState.activePlayer,
                    ousted: player.isOusted,
                }"
            >
                <span
                    v-if="player == gameState.activePlayer"
                    class="active-player"
                    >▶
                </span>

                <span v-if="player.isOusted && !engine.withdrawals[player.oid]"> 💀 </span>
                <span
                    class="player-name"
                    :style="{ color: player.rgbaColor }"
                >
                    {{ player.shortName }}
                </span>
                <!-- With the rules engine : a withdrawal announced, or done ( not an oust ) -->
                <span
                    v-if="engine.withdrawals[player.oid]"
                    class="withdrawal"
                >
                    {{ engine.withdrawals[player.oid] == 'withdrew' ? 'withdrew' : 'withdrawing' }}
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
                    v-else
                    class="role-icon"
                >
                    👤
                </span>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useGameStateStore } from '@/client/store/gameState.ts'
import { ref } from 'vue'
import { usePlayersStore } from '@/client/state/players.ts'
import { useEngineStore } from '@/client/store/engine.ts'

const gameState = useGameStateStore()
const players = usePlayersStore()
const engine = useEngineStore()

const isCollapsed = ref(true)
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

    // A labelled rule : the two lines flank the centered title.
    // Both are empty, so flex: 1 splits the space exactly in half.
    .separator {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 4px 0;

        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: $bone-grey;

        &::before,
        &::after {
            content: '';
            flex: 1;
            height: 1px;
            background: $mist-grey;
        }
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

        .withdrawal {
            margin-right: 4px;
            font-style: italic;
            color: $ash-grey;
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
