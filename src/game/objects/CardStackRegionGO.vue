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
            isDraggedOver || isRegionHovered ?
                REGION_BACKGROUND_COLOR_DRAG_OVER.color
            :   REGION_BACKGROUND_COLOR.color
        "
        :fillAlpha="
            isDraggedOver || isRegionHovered ?
                REGION_BACKGROUND_COLOR_DRAG_OVER.alphaGL
            :   REGION_BACKGROUND_COLOR.alphaGL
        "
        :dropZone="true"
        @create="onBoundariesCreate"
        @pointerover="onBoundariesPointerOver"
        @pointerout="onBoundariesPointerOut"
        @pointerdown="onBoundariesPointerDown"
    />

    <Text
        ref="cardCount"
        :text="cardRegion.cards.length + ''"
        :style="{
            color: '#000',
            fontStyle: 'Bold',
        }"
        :origin="1"
        :x="x + width - 5"
        :y="y + 20"
    />

    <Image
        ref="wieldIcon"
        :visible="isRegionHovered"
        :texture="WIELD_CARD_STACK_ICON"
        :origin="0.5"
        :x="x + width - 25"
        :y="y + height / 2"
        :displayWidth="40"
        :displayHeight="40"
    />

    <Text
        ref="regionName"
        :text="cardRegion.name"
        :style="{
            color: color.rgba,
            fontSize: 12,
        }"
        :alpha="0.7"
        :origin="1"
        :x="x + width - 3"
        :y="y + height - 3"
    />

    <Image
        v-if="showTopCard && cardRegion.length > 0"
        ref="image"
        :texture="cardRegion.cards[0].displayedTexture.textureName"
        :frame="cardRegion.cards[0].displayedTexture.frameName"
        :x="x + (image ? image.displayHeight / 2 : 0) + 5"
        :y="y + (image ? image.displayWidth / 2 : 0) + 5"
        :scale="CARD_IN_STACK_SCALE"
        :rotation="Math.PI / 2"
        @create="onImageCreate"
        @pointermove="onImagePointerMove"
        @pointerover="onImagePointerOver"
        @pointerout="onImagePointerOut"
        @pointerdown="onImagePointerDown"
    />

    <Rectangle
        ref="cardOutline"
        :visible="drawHoverAttrs.isHovered"
        :x="x + (image ? image.displayHeight / 2 : 0) + 5"
        :y="y + (image ? image.displayWidth / 2 : 0) + 5"
        :width="image ? image.displayHeight : 0"
        :height="image ? image.displayWidth : 0"
        :lineWidth="CARD_OUTLINE_THICKNESS"
        :strokeColor="CARD_OUTLINE_COLOR_HOVER.color"
    />

    <div
        v-show="drawHoverAttrs.isHovered"
        class="tooltip"
        :style="{
            left: drawHoverAttrs.x - 40 + 'px',
            top: drawHoverAttrs.y + 40 + 'px',
        }"
    >
        Draw {{ draw }}
    </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import Phaser, { GameObjects } from 'phaser'
import { Image, Rectangle, refObj, Text, useScene } from 'phavuer'
import {
    CARD_IN_STACK_SCALE,
    CARD_OUTLINE_COLOR_HOVER,
    CARD_OUTLINE_THICKNESS,
    REGION_BACKGROUND_COLOR,
    REGION_BACKGROUND_COLOR_DRAG_OVER,
    WIELD_CARD_STACK_ICON,
} from '@/game/const.ts'
import { AnyCardRegion } from '@/model/CardRegion.ts'
import { gameMutations } from '@/state/gameMutations.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { useGameBusStore } from '@/store/bus.ts'
import Color = Phaser.Display.Color
import Pointer = Phaser.Input.Pointer
import { PhaserDataKey } from '@/game/types.ts'
import { AnyCard } from '@/model/Card.ts'
import { RegionName } from '@/model/const.ts'

const props = defineProps<{
    x: number
    y: number
    width: number
    height: number
    color: Color
    cardRegion: AnyCardRegion

    showTopCard: boolean
    draw?: 'crypt' | 'library'
}>()

const gameState = useGameStateStore()
const gameBus = useGameBusStore()

const image = refObj<GameObjects.Image>()
const isDraggedOver = ref(false)

function closeUpAshHeap() {
    // Close up top card of the ash heap
    if (
        props.cardRegion.name == RegionName.AshHeap &&
        props.cardRegion.length > 0 &&
        !isDraggedOver.value
    ) {
        gameBus.setCloseUpCard(props.cardRegion.firstCard)
    }
}

/**
 * Boundaries
 */

function onBoundariesCreate(boundaries: GameObjects.Rectangle) {
    boundaries.setData(PhaserDataKey.CardRegion, props.cardRegion)

    // boundaries is already interactive because it declare a dropZone
    // so we update its cursor property instead of using setInteractive()
    if (boundaries.input?.cursor) {
        boundaries.input.cursor = 'pointer'
    }

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

const isRegionHovered = ref(false)

function onBoundariesPointerOver() {
    isRegionHovered.value = true
    closeUpAshHeap()
}

function onBoundariesPointerOut() {
    isRegionHovered.value = false
}

/**
 * Wield card stack on click
 */

function onBoundariesPointerDown() {
    gameBus.wieldCardStack.show = true
    gameBus.wieldCardStack.cardRegion = props.cardRegion
}

/**
 * Outline stack + tooltip on pointer over
 */

const drawHoverAttrs = reactive({
    isHovered: false,
    x: 0,
    y: 0,
})

function onImagePointerMove(pointer: Pointer) {
    if (props.draw) {
        drawHoverAttrs.isHovered = true
        drawHoverAttrs.x = pointer.x
        drawHoverAttrs.y = pointer.y
    }
}

function onImagePointerOver() {
    closeUpAshHeap()
}

function onImagePointerOut() {
    drawHoverAttrs.isHovered = false
}

function onImageCreate(image: GameObjects.Image) {
    if (props.draw) {
        image.setInteractive({ draggable: false, cursor: 'pointer' })
    }
}

/**
 * Draw card on click
 */

function onImagePointerDown() {
    if (props.draw == 'library') {
        gameMutations.drawLibrary.actSelf({
            player: gameState.selfPlayer,
        })
    } else if (props.draw == 'crypt') {
        gameMutations.drawCrypt.actSelf({
            player: gameState.selfPlayer,
        })
    }
}
</script>

<style lang="scss">
.tooltip {
    padding: 10px;
    position: absolute;
    border: solid 1px black;
    background: $bone-grey;
    color: white;
}
</style>
