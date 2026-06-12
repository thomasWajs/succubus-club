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
        :fillColor="Colors.REGION_BACKGROUND.color"
        :fillAlpha="Colors.REGION_BACKGROUND.alphaGL"
        :dropZone="true"
        @create="onBoundariesCreate"
    >
        <FxHighlightRegionDrop
            v-if="highlightDropZone && cardRegion.name != RegionName.Ready"
            :color="color"
        />
    </Rectangle>

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
import { Colors } from '@/client/colors.ts'
import CardGO from '@/client/game/objects/CardGO.vue'
import { usePlayersStore } from '@/client/state/players.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { PhaserDataKey, RegionCategory } from '@/client/game/types.ts'
import { AnyCardRegion } from '@/shared/types/model.ts'
import FxHighlightRegionDrop from './FxHighlightRegionDrop.vue'
import { RegionName } from '@/shared/const/model.ts'
import Color = Phaser.Display.Color

const players = usePlayersStore()
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
        players.isPlayer && // don't highlight for spectators
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
