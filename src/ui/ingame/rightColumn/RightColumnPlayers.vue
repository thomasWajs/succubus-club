<template>
    <div id="RightColumnPlayers">
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
            <div class="player-left">
                <span
                    v-if="player == gameState.activePlayer"
                    class="active-player"
                    >▶
                </span>
                <span v-if="disconnectedPlayers[player.oid]"> 🔌 </span>
                <span v-if="player.isOusted"> 💀 </span>

                <span
                    class="player-name"
                    :style="{ color: player.color.rgba }"
                >
                    {{ player.shortName }}
                </span>
            </div>

            <div class="player-right">
                <button
                    class="game-button small"
                    @click="
                        gameMutations.changePool.actSelf({
                            player: player,
                            amount: -1,
                        })
                    "
                >
                    -
                </button>

                <div
                    class="pool-diamond"
                    @click.stop="gameBus.changePool = { show: true, player: player }"
                >
                    <span>{{ player.pool }}</span>
                </div>

                <button
                    class="game-button small"
                    @click="
                        gameMutations.changePool.actSelf({
                            player: player,
                            amount: +1,
                        })
                    "
                >
                    +
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useGameBusStore } from '@/store/bus.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { gameMutations } from '@/state/gameMutations.ts'
import { computed } from 'vue'
import { useMultiplayerStore } from '@/store/multiplayer.ts'
import { GameType } from '@/state/types.ts'
import { useCoreStore } from '@/store/core.ts'

const core = useCoreStore()
const gameBus = useGameBusStore()
const gameState = useGameStateStore()
const multiplayer = useMultiplayerStore()

const disconnectedPlayers = computed(() => {
    if (core.gameType != GameType.Multiplayer) {
        return {}
    }

    return Object.fromEntries(
        Object.values(gameState.players).map(player => [
            player.oid,
            multiplayer.users[player.permId] === undefined,
        ]),
    )
})
</script>

<style lang="scss" scoped>
// Windows
$window-top: 475px;
$window-right: 340px;

#RightColumnPlayers {
    margin: 4px 0;
    background: $right-column-section-bg;

    .player {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 3px 3px;

        &.acting {
            background: rgba($vibrant-emerald, 0.3);
        }
        &.disconnected {
            background: rgba($crimson-red, 0.6);
        }
        &.ousted {
            background: $mist-grey;
        }

        .player-left {
            display: flex;
            align-items: center;
            flex-grow: 1;
            min-width: 0; /* Important for ellipsis to work */
            white-space: nowrap;
            overflow: hidden;
            gap: 4px;
        }

        .player-right {
            display: flex;
            align-items: center;
            flex-shrink: 0; /* Prevents shrinking */
            white-space: nowrap;
            gap: 2px;
        }

        /* Or a pulsing dot */
        .active-player {
            color: $dark-forest;
            font-weight: bold;
        }

        .the-edge-button {
            width: 16px;
            padding: 3px;
            flex-shrink: 0;
        }

        .disconnected {
            color: $blood-red;
            flex-shrink: 0;
        }
    }

    .player-name {
        display: inline-block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0; /* Important for ellipsis to work */
        flex-shrink: 1; /* Allows this element to shrink */
    }

    .pool-diamond {
        display: inline-block;
        width: 18px;
        height: 18px;
        background-color: white;
        border: 2px solid $shadow-grey;
        transform: rotate(45deg);
        text-align: center;
        line-height: 18px;
        font-weight: bold;
        font-size: 12px;
        margin: 0 3px;
        cursor: pointer;

        // Counter-rotate the text so it appears upright
        span {
            transform: rotate(-45deg);
            display: inline-block;
        }
    }
}
</style>
