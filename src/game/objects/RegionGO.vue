<template>
    <!-- Region boundaries -->
    <Rectangle
        ref="boundaries"
        :origin="0"
        :x="x"
        :y="y"
        :width="width"
        :height="height"
        :lineWidth="1"
        :strokeColor="color.color"
        :strokeAlpha="color.alphaGL"
        :fillColor="
            highlightDropZone ?
                REGION_BACKGROUND_COLOR_DRAG_OVER.color
            :   REGION_BACKGROUND_COLOR.color
        "
        :fillAlpha="
            highlightDropZone ?
                REGION_BACKGROUND_COLOR_DRAG_OVER.alphaGL
            :   REGION_BACKGROUND_COLOR.alphaGL
        "
        :dropZone="true"
        @create="onBoundariesCreate"
    />

    <!-- Region name displayed as text -->
    <Text
        ref="regionName"
        :text="cardRegion.name"
        :style="{
            color: color.rgba,
        }"
        :alpha="0.7"
        :origin="1"
        :x="x + width - 5"
        :y="y + height - 5"
    />

    <!-- Cards for this region -->
    <CardGO
        v-for="card in cardRegion.cards"
        :key="cardRegion.name + card.oid"
        :card="card"
        :regionName="cardRegion.name"
    />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Phaser, { GameObjects } from 'phaser'
import { Rectangle, Text } from 'phavuer'
import { REGION_BACKGROUND_COLOR, REGION_BACKGROUND_COLOR_DRAG_OVER } from '@/game/const.ts'
import CardGO from '@/game/objects/CardGO.vue'
import { AnyCardRegion } from '@/model/CardRegion.ts'
import Color = Phaser.Display.Color
import { useGameStateStore } from '@/store/gameState.ts'
import { useGameBusStore } from '@/store/bus.ts'
import { PhaserDataKey, RegionCategory } from '@/game/types.ts'

const gameState = useGameStateStore()
const gameBus = useGameBusStore()

const { cardRegion } = defineProps<{
    x: number
    y: number
    width: number
    height: number
    color: Color
    cardRegion: AnyCardRegion
}>()

const highlightDropZone = computed(() => {
    return (
        gameState.isPlayer && // don't highlight for spectators
        gameBus.dragOver && // A drag is in progress
        gameBus.dragOver.cardRegion?.oid == cardRegion.oid && // This region is dragged over
        gameBus.dragOver.card.region.oid != cardRegion.oid // THe dragged card is not already in this region
    )
})

function onBoundariesCreate(boundaries: GameObjects.Rectangle) {
    boundaries.setData(PhaserDataKey.CardRegionOid, cardRegion.oid)
    boundaries.setData(PhaserDataKey.RegionCategory, RegionCategory.Table)
}
</script>
