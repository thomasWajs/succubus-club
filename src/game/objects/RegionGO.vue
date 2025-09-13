<template>
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
            isDraggedOver ? REGION_BACKGROUND_COLOR_DRAG_OVER.color : REGION_BACKGROUND_COLOR.color
        "
        :fillAlpha="
            isDraggedOver ?
                REGION_BACKGROUND_COLOR_DRAG_OVER.alphaGL
            :   REGION_BACKGROUND_COLOR_DRAG_OVER.alphaGL
        "
        :dropZone="true"
        @create="onBoundariesCreate"
    />

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

    <CardGO
        v-for="card in cardRegion.cards"
        :key="cardRegion.name + card.oid"
        :card="card"
        :regionName="cardRegion.name"
    />
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Phaser, { GameObjects } from 'phaser'
import { Rectangle, Text, useScene } from 'phavuer'
import { REGION_BACKGROUND_COLOR, REGION_BACKGROUND_COLOR_DRAG_OVER } from '@/game/const.ts'
import CardGO from '@/game/objects/CardGO.vue'
import { AnyCardRegion } from '@/model/CardRegion.ts'
import Color = Phaser.Display.Color
import { PhaserDataKey } from '@/game/types.ts'
import { AnyCard } from '@/model/Card.ts'

const props = defineProps<{
    x: number
    y: number
    width: number
    height: number
    color: Color
    cardRegion: AnyCardRegion
}>()

const isDraggedOver = ref(false)

function onBoundariesCreate(boundaries: GameObjects.Rectangle) {
    boundaries.setData(PhaserDataKey.CardRegion, props.cardRegion)

    const scene = useScene()
    scene.input.on(
        Phaser.Input.Events.DRAG_ENTER,
        ({}, cardImage: GameObjects.Image, target: GameObjects.Rectangle) => {
            // Highlight target region if it's different from the source region
            const card = cardImage.getData(PhaserDataKey.Card) as AnyCard
            if (target == boundaries && card.region.oid != props.cardRegion.oid) {
                isDraggedOver.value = true
            }
        },
    )
    scene.input.on(Phaser.Input.Events.DRAG_LEAVE, ({}, {}, target: GameObjects.Rectangle) => {
        if (target == boundaries) {
            isDraggedOver.value = false
        }
    })
    scene.input.on(Phaser.Input.Events.DRAG_END, ({}, {}, {}) => {
        isDraggedOver.value = false
    })
}
</script>
