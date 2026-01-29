<template>
    <Rectangle
        v-if="gameBus.selectionAreaRect"
        :origin="0"
        :x="gameBus.selectionAreaRect.x"
        :y="gameBus.selectionAreaRect.y"
        :width="gameBus.selectionAreaRect.width"
        :height="gameBus.selectionAreaRect.height"
        :lineWidth="SELECTION_AREA_LINE_THICKNESS"
        :strokeColor="Colors.SELECTION_AREA.color"
        :fillColor="Colors.SELECTION_AREA.color"
        :fillAlpha="0.075"
    />
</template>

<script setup lang="ts">
import { Rectangle } from 'phavuer'
import { Colors } from '@/client/colors.ts'
import { SELECTION_AREA_LINE_THICKNESS } from '@/shared/const/game.ts'
import { useGameBusStore } from '@/client/store/bus.ts'

const gameBus = useGameBusStore()
</script>

<style lang="scss"></style>
