<template>
    <div
        v-if="gameBus.changeTheEdge.show"
        class="context-menu the-edge-menu"
        :style="style"
    >
        <template
            v-for="player in gameState.orderedPlayers"
            :key="player.oid"
        >
            <button
                v-if="player == gameState.theEdgeController"
                class="game-button"
                @click="
                    gameMutations.changeTheEdgeControl.actSelf({
                        newController: undefined,
                    })
                "
            >
                Burn The Edge :
                <span
                    class="inline-player-name"
                    :style="{ backgroundColor: player.color.rgba }"
                >
                    {{ player.name }}
                </span>
            </button>

            <button
                v-else
                class="game-button"
                @click="
                    gameMutations.changeTheEdgeControl.actSelf({
                        newController: player,
                    })
                "
            >
                Gain The Edge :
                <span
                    class="inline-player-name"
                    :style="{ backgroundColor: player.color.rgba }"
                >
                    {{ player.name }}
                </span>
            </button>
        </template>
    </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { gameMutations } from '@/state/gameMutations.ts'
import { useGameBusStore } from '@/store/bus.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import {
    CONTROLLED_ZONE_HEIGHT,
    PLAY_AREA_WIDTH,
    PLAY_AREA_X,
    PLAY_AREA_Y,
    PLAYER_BAR_HEIGHT,
} from '@/game/const.ts'
import { display } from '@/game/display.ts'

const gameBus = useGameBusStore()
const gameState = useGameStateStore()

const style = computed(() => {
    const top = (PLAY_AREA_Y + PLAYER_BAR_HEIGHT + CONTROLLED_ZONE_HEIGHT / 2 - 50) * display.scale
    const left = (PLAY_AREA_X + PLAY_AREA_WIDTH / 2) * display.scale
    return {
        top: `${top}px`,
        left: `${left}px`,
        transform: `translate(-50%, -50%) scale(${display.scale}) `,
    }
})

// Close menu on the next click
watch(
    () => gameBus.changeTheEdge.show,
    isVisible => {
        if (isVisible) {
            const handleClickOutside = () => {
                gameBus.changeTheEdge.show = false
                document.removeEventListener('click', handleClickOutside)
            }

            setTimeout(() => {
                document.addEventListener('click', handleClickOutside)
            }, 0)
        }
    },
)
</script>

<style lang="scss">
.the-edge-menu {
    width: 250px;

    .game-button {
        margin-bottom: 1px;
    }
}
</style>
