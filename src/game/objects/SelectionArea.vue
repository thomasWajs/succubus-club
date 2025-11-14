<template>
    <Rectangle
        v-if="gameBus.selectionAreaRect"
        :origin="0"
        :x="gameBus.selectionAreaRect.x"
        :y="gameBus.selectionAreaRect.y"
        :width="gameBus.selectionAreaRect.width"
        :height="gameBus.selectionAreaRect.height"
        :lineWidth="SELECTION_AREA_LINE_THICKNESS"
        :strokeColor="SELECTION_AREA_COLOR.color"
        :fillColor="SELECTION_AREA_COLOR.color"
        :fillAlpha="0.075"
    />
</template>

<script setup lang="ts">
import { Rectangle } from 'phavuer'
import { SELECTION_AREA_COLOR, SELECTION_AREA_LINE_THICKNESS } from '@/game/const.ts'
import { useGameBusStore } from '@/store/bus.ts'

const gameBus = useGameBusStore()
</script>

<style lang="scss"></style>
