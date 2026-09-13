<template>
    <Rectangle
        v-if="rect"
        :origin="0"
        :x="rect.x"
        :y="rect.y"
        :width="rect.width"
        :height="rect.height"
        :lineWidth="SELECTION_AREA_LINE_THICKNESS"
        :strokeColor="Colors.SELECTION_AREA.color"
        :fillColor="Colors.SELECTION_AREA.color"
        :fillAlpha="0.075"
    />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Rectangle } from 'phavuer'
import { Colors } from '@/client/colors.ts'
import { SELECTION_AREA_LINE_THICKNESS } from '@/shared/const/game.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'

const gameBus = useGameBusStore()
const gameState = useGameStateStore()

// Free Table's per-player camera rotation would tilt a world-coordinate
// rectangle, so use the screen-coordinate one instead, rendered through the
// pinned UI camera which stays screen-aligned regardless of rotation.
const rect = computed(() =>
    gameState.isFreeTable ? gameBus.selectionAreaScreenRect : gameBus.selectionAreaRect,
)
</script>

<style lang="scss"></style>
