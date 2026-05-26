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
            highlightDropZone || isRegionHovered ?
                Colors.REGION_BACKGROUND_DRAG_OVER.color
            :   Colors.REGION_BACKGROUND.color
        "
        :fillAlpha="
            highlightDropZone || isRegionHovered ?
                Colors.REGION_BACKGROUND_DRAG_OVER.alphaGL
            :   Colors.REGION_BACKGROUND.alphaGL
        "
        :dropZone="true"
        @create="onBoundariesCreate"
        @pointerover="onBoundariesPointerOver"
        @pointerout="onBoundariesPointerOut"
        @pointerdown="onBoundariesPointerDown"
    />

    <Text
        ref="cardCount"
        :text="cardRegion.cards.length.toString()"
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
        :texture="Texture.WieldCardStack"
        :origin="0.5"
        :x="x + width - 50"
        :y="y + 25"
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
        v-if="showTopCard && topCard"
        ref="image"
        :texture="displayedTexture.textureName"
        :frame="displayedTexture.frameName"
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
        :strokeColor="Colors.CARD_OUTLINE_HOVER.color"
    />

    <div
        v-show="drawHoverAttrs.isHovered && !cardRegion.isEmpty"
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
import { computed, reactive, ref } from 'vue'
import Phaser, { GameObjects } from 'phaser'
import { Image, Rectangle, refPhaserInstance, Text } from 'phavuer'
import { Colors } from '@/client/colors.ts'
import { CARD_IN_STACK_SCALE, CARD_OUTLINE_THICKNESS } from '@/shared/const/game.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { PhaserDataKey, RegionCategory } from '@/client/game/types.ts'
import { positionContextMenu } from '@/client/game/utils.ts'
import { Texture } from '@/client/resources/textures.ts'
import { AnyCardRegion } from '@/shared/types/model.ts'
import { useCardTexture } from '@/client/game/composables/useCardTexture.ts'
import Color = Phaser.Display.Color
import Pointer = Phaser.Input.Pointer

const { cardRegion, draw } = defineProps<{
    x: number
    y: number
    width: number
    height: number
    color: Color
    cardRegion: AnyCardRegion
    showTopCard: boolean
    draw?: 'crypt' | 'library'
}>()

const players = usePlayersStore()
const gameBus = useGameBusStore()

const image = refPhaserInstance<GameObjects.Image>(null)

const topCard = computed(() => (cardRegion.length > 0 ? cardRegion.firstCard : null))
const displayedTexture = computed(() => {
    return topCard.value ?
            useCardTexture(topCard.value).displayedTexture.value
        :   { textureName: undefined, frameName: undefined }
})

const isRegionHovered = ref(false)

/**
 * Boundaries
 */

function onBoundariesCreate(boundaries: GameObjects.Rectangle) {
    boundaries.setData(PhaserDataKey.CardRegionOid, cardRegion.oid)
    boundaries.setData(PhaserDataKey.RegionCategory, RegionCategory.Table)

    // boundaries is already interactive because it declare a dropZone
    // so we update its cursor property instead of using setInteractive()
    if (boundaries.input?.cursor) {
        boundaries.input.cursor = 'pointer'
    }
}

const highlightDropZone = computed(() => {
    return (
        players.isPlayer && // don't highlight for spectators
        gameBus.dragOver && // A drag is in progress
        gameBus.dragOver.cardRegion?.oid == cardRegion.oid && // This region is dragged over
        gameBus.dragOver.card.region.oid != cardRegion.oid // THe dragged card is not already in this region
    )
})

function onBoundariesPointerOver() {
    isRegionHovered.value = true
    closeUpAshHeap()
}

function onBoundariesPointerOut() {
    isRegionHovered.value = false
    gameBus.assignPinnedCloseUpCard()
}

/**
 * Wield card stack on click
 */

function onBoundariesPointerDown() {
    gameBus.wieldCardStack.show = true
    gameBus.wieldCardStack.cardRegion = cardRegion
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
    if (draw) {
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
    gameBus.assignPinnedCloseUpCard()
}

function onImageCreate(image: GameObjects.Image) {
    if (draw) {
        image.setInteractive({ draggable: false, cursor: 'pointer' })
    }
}

/**
 * Draw card on click
 */

function onImagePointerDown(pointer: Pointer) {
    if (!players.selfPlayer) {
        return
    }
    if (pointer.leftButtonDown()) {
        if (draw == 'library') {
            gameMutations.drawLibrary.actSelf({
                player: players.selfPlayer,
            })
        } else if (draw == 'crypt') {
            gameMutations.drawCrypt.actSelf({
                player: players.selfPlayer,
            })
        }
    } else if (pointer.rightButtonDown() && topCard.value) {
        gameBus.selectedCards = [topCard.value]
        gameBus.contextMenu.cards = [topCard.value]
        gameBus.contextMenu.show = true
        const setXY = (x: number, y: number) => {
            gameBus.contextMenu.x = x
            gameBus.contextMenu.y = y
        }
        positionContextMenu(pointer.x, pointer.y, pointer.y, '.context-menu', setXY)
    }
}

/**
 * Closeup for stacks
 */

function closeUpAshHeap() {
    // Close up top card of the ash heap
    if (cardRegion.is.ashHeap && cardRegion.length > 0 && !gameBus.dragOver) {
        gameBus.setCloseUpCard(cardRegion.firstCard)
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
