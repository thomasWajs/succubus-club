<template>
    <PhavuerGame
        v-if="core.resourcesAreReady"
        id="PhavuerGame"
        :config="gameConfig"
        @create="onCreate"
    >
        <Preloader />
        <Tabletop />
    </PhavuerGame>
</template>

<script setup lang="ts">
import { Game as PhavuerGame } from 'phavuer'
import Phaser from 'phaser'
import Tabletop from '@/client/game/scenes/Tabletop.vue'
import Preloader from '@/client/game/scenes/Preloader.vue'
import { onBeforeUnmount, watch } from 'vue'
import { setPhaserGame, useCoreStore } from '@/client/store/core.ts'
import { useBusStore } from '@/client/store/bus.ts'
import { display } from '@/client/game/display.ts'
import { resetState } from '@/client/state/setup.ts'

const core = useCoreStore()
const bus = useBusStore()

function onCreate(game: Phaser.Game) {
    setPhaserGame(game)
    game?.input?.mouse?.disableContextMenu()

    // Watch for blocker changes
    watch(
        () => bus.alert?.blockInteraction,
        blocked => {
            if (game?.input) {
                game.input.enabled = !blocked
            }
        },
        { immediate: true },
    )
}

const gameConfig: Phaser.Types.Core.GameConfig = {
    title: 'Succubus Club',
    type: Phaser.AUTO,
    width: display.actualWidth,
    height: display.actualHeight,
    transparent: true,
    scale: {
        mode: Phaser.Scale.RESIZE,
        // !!! THIS IS VERY IMPORTANT !!!
        // It fixes an awful bug in Phavuer where the ScaleManager try to resize the canvas while hidden,
        // with a width/height of 0 and crashes the game.
        // See : https://github.com/laineus/phavuer/issues/17
        min: {
            width: 1,
            height: 1,
        },
    },
    antialias: true,
    antialiasGL: true,
    audio: {
        noAudio: true,
    },
    /*
    fx: {
        glow: {
            distance: 12,
            quality: 0.1
        }
    }
     */
}

onBeforeUnmount(() => {
    core.phaserGame?.destroy(true)
    setPhaserGame(null)
    resetState()
})
</script>

<style lang="scss" scoped>
#PhavuerGame {
    background-image: url('/assets/tabletopBackground.jpg');
    background-repeat: repeat;

    height: 100%;
    width: 100%;
    flex-grow: 1;
    // Don't remove, see gameConfig.scale.min
    min-height: 1px;
    min-width: 1px;
}
</style>
