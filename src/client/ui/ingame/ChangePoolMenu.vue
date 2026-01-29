<template>
    <div
        v-if="gameBus.changePool.show"
        ref="changePoolRef"
        class="floating-menu pool-menu"
        :style="style"
    >
        Change pool for
        <span
            class="inline-player-name"
            :style="{
                backgroundColor: gameBus.changePool.player?.rgbaColor,
            }"
        >
            {{ gameBus.changePool.player!.name }}
        </span>

        <div class="pool-selector-amounts">
            <button
                v-for="i in 10"
                :key="i"
                class="game-button"
                @click="
                    gameMutations.changePool.actSelf({
                        player: gameBus.changePool.player!,
                        amount: 0 - i,
                    })
                "
            >
                {{ 0 - i }}
            </button>
        </div>

        <div class="pool-selector-amounts">
            <button
                v-for="i in 10"
                :key="i"
                class="game-button"
                @click="
                    gameMutations.changePool.actSelf({
                        player: gameBus.changePool.player!,
                        amount: i,
                    })
                "
            >
                {{ '+' + i }}
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import {
    CONTROLLED_ZONE_HEIGHT,
    PLAY_AREA_WIDTH,
    PLAY_AREA_X,
    PLAY_AREA_Y,
    PLAYER_BAR_HEIGHT,
} from '@/shared/const/game.ts'
import { display } from '@/client/game/display.ts'

const gameBus = useGameBusStore()
const changePoolRef = ref<HTMLElement | null>(null)

const style = computed(() => {
    const top = (PLAY_AREA_Y + PLAYER_BAR_HEIGHT + CONTROLLED_ZONE_HEIGHT / 2 - 50) * display.scale
    const left = (PLAY_AREA_X + PLAY_AREA_WIDTH / 2) * display.scale
    return {
        top: `${top}px`,
        left: `${left}px`,
        transform: `translate(-50%, -50%) scale(${display.scale}) `,
    }
})

// Close menu on the next click outside
watch(
    () => gameBus.changePool.show,
    isVisible => {
        if (isVisible) {
            const handleClickOutside = (event: MouseEvent) => {
                if (changePoolRef.value && !changePoolRef.value.contains(event.target as Node)) {
                    gameBus.changePool.show = false
                    document.removeEventListener('pointerdown', handleClickOutside)
                }
            }

            setTimeout(() => {
                document.addEventListener('pointerdown', handleClickOutside)
            }, 0)
        }
    },
)
</script>

<style lang="scss">
.pool-menu {
    background-color: $silver-grey;
    width: 450px;
    height: 150px;

    .game-button {
        margin-left: 4px;
    }
}

.pool-selector-amounts {
    margin: 20px 0;
    display: flex;

    button {
        flex-grow: 1;
        padding: 8px 6px;
    }
}
</style>
