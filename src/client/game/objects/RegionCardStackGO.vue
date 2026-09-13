<template>
    <Rectangle
        ref="boundaries"
        :origin="0"
        :x="x - (highlightDropZone ? 4 : 0)"
        :y="y - (highlightDropZone ? 4 : 0)"
        :width="width + (highlightDropZone ? 8 : 0)"
        :height="height + (highlightDropZone ? 8 : 0)"
        :lineWidth="1"
        :strokeColor="isRegionHovered ? regionhigHlightColor.color : color.color"
        :strokeAlpha="isRegionHovered ? regionhigHlightColor.alphaGL : color.alphaGL"
        :fillColor="Colors.REGION_BACKGROUND.color"
        :fillAlpha="Colors.REGION_BACKGROUND.alphaGL"
        :dropZone="true"
        @create="onBoundariesCreate"
        @pointerover="onBoundariesPointerOver"
        @pointerout="onBoundariesPointerOut"
        @pointerdown="onBoundariesPointerDown"
    >
        <FxHighlightRegionDrop
            v-if="highlightDropZone"
            :color="color"
        />
    </Rectangle>

    <Rectangle
        :width="stackSizeWidth"
        :height="28"
        :fillColor="Colors.REGION_STACK_SIZE_BACKGROUND.color"
        :lineWidth="1"
        :strokeColor="color.color"
        :strokeAlpha="0.5"
        :origin="0"
        :x="x + width - stackSizeWidth"
        :y="y"
    />

    <Text
        ref="cardCount"
        :text="cardRegion.cards.length.toString()"
        :style="{
            color: color.rgba,
            fontSize: 22,
        }"
        :origin="1"
        :x="x + width - 3"
        :y="y + 25"
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
        :y="y + height - 5"
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
        @create="topCardInteractions.onCreate"
        @pointermove="topCardInteractions.onPointerMove"
        @pointerover="topCardInteractions.onPointerOver"
        @pointerout="topCardInteractions.onPointerOut"
        @pointerdown="topCardInteractions.onPointerDown"
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
        class="game-tooltip"
        :style="{
            left: drawHoverAttrs.x - 40 + 'px',
            top: `${drawHoverAttrs.y + 40}px`,
        }"
    >
        Draw {{ draw }}
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import Phaser, { GameObjects } from 'phaser'
import { Image, Rectangle, refObj, Text } from 'phavuer'
import { Colors } from '@/client/colors.ts'
import { CARD_IN_STACK_SCALE, CARD_OUTLINE_THICKNESS } from '@/shared/const/game.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { PhaserDataKey, RegionCategory } from '@/client/game/types.ts'
import { AnyCardRegion } from '@/shared/types/model.ts'
import { useCardTexture } from '@/client/game/composables/useCardTexture.ts'
import { useStackTopCard } from '@/client/game/composables/useStackTopCard.ts'
import FxHighlightRegionDrop from './FxHighlightRegionDrop.vue'
import Color = Phaser.Display.Color

const { color, cardRegion, draw } = defineProps<{
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

const image = refObj<GameObjects.Image>()

const topCard = computed(() => (cardRegion.length > 0 ? cardRegion.firstCard : null))
const displayedTexture = computed(() => {
    return topCard.value ?
            useCardTexture(topCard.value).displayedTexture.value
        :   { textureName: undefined, frameName: undefined }
})

const topCardInteractions = useStackTopCard({
    cardRegion: () => cardRegion,
    topCard: () => topCard.value,
    draw: () => draw,
})
const { drawHoverAttrs, closeUpAshHeap } = topCardInteractions

const isRegionHovered = ref(false)
const regionhigHlightColor = computed(() => {
    return color.clone().lighten(25).brighten(10)
})

/**
 * Boundaries
 */

const WIELD_CARD_STACK_CURSOR = 'url(assets/wieldCardStack.png) 12 12, zoom-in'
function onBoundariesCreate(boundaries: GameObjects.Rectangle) {
    boundaries.setData(PhaserDataKey.CardRegionOid, cardRegion.oid)
    boundaries.setData(PhaserDataKey.RegionCategory, RegionCategory.Stack)

    // boundaries is already interactive because it declare a dropZone
    // so we update its cursor property instead of using setInteractive()
    if (boundaries.input) {
        boundaries.input.cursor = WIELD_CARD_STACK_CURSOR
    }
}

const highlightDropZone = computed(() => {
    return (
        players.isPlayer && // don't highlight for spectator
        gameBus.dragOver && // A drag is in progress
        gameBus.dragOver.cardRegion?.oid == cardRegion.oid && // This region is dragged over
        gameBus.dragOver.card.region.oid != cardRegion.oid // The dragged card is not already in this region
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

const stackSizeWidth = computed(() => {
    return cardRegion.cards.length > 9 ? 32 : 24
})

/**
 * Wield card stack on click
 */

function onBoundariesPointerDown() {
    gameBus.wieldCardStack.show = true
    gameBus.wieldCardStack.cardRegion = cardRegion
}
</script>
