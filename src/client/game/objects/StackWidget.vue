<template>
    <Rectangle
        :origin="0.5"
        :x="x"
        :y="y"
        :width="width"
        :height="height"
        :lineWidth="2"
        :strokeColor="isDraggedOver ? Colors.HIGHLIGHT_YELLOW.color : Colors.BLACK.color"
        :strokeAlpha="isDraggedOver ? 1 : 0.5"
        :dropZone="true"
        @create="onBoundariesCreate"
        @pointerdown="onBoundariesPointerDown"
        @pointerover="topCardInteractions.onPointerOver"
        @pointerout="topCardInteractions.onPointerOut"
    />

    <!-- Stacks showing their top card get the title pinned to the top,
    with the card rotated 90deg displayed below it -->
    <template v-if="showTopCard">
        <Text
            :text="`${cardRegion.name} (${cardRegion.length})`"
            :style="{ color: '#000', fontSize: '13px' }"
            :origin="0.5"
            :x="x"
            :y="titleY"
        />

        <Image
            v-if="topCard"
            ref="image"
            :texture="displayedTexture.textureName"
            :frame="displayedTexture.frameName"
            :x="x"
            :y="cardY"
            :scale="rotatedCardScale"
            :rotation="Math.PI / 2"
            :origin="0.5"
            @create="topCardInteractions.onCreate"
            @pointermove="topCardInteractions.onPointerMove"
            @pointerover="topCardInteractions.onPointerOver"
            @pointerout="topCardInteractions.onPointerOut"
            @pointerdown="topCardInteractions.onPointerDown"
        />

        <Rectangle
            v-if="topCard"
            :visible="drawHoverAttrs.isHovered"
            :origin="0.5"
            :x="x"
            :y="cardY"
            :width="image ? image.displayHeight : 0"
            :height="image ? image.displayWidth : 0"
            :lineWidth="CARD_OUTLINE_THICKNESS"
            :strokeColor="Colors.CARD_OUTLINE_HOVER.color"
        />
    </template>

    <Text
        v-else
        :text="`${cardRegion.name} (${cardRegion.length})`"
        :style="{ color: '#000', fontSize: '13px' }"
        :origin="0.5"
        :x="x"
        :y="y"
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
import { computed } from 'vue'
import { GameObjects } from 'phaser'
import { Image, Rectangle, refObj, Text } from 'phavuer'
import { Colors } from '@/client/colors.ts'
import { CARD_HEIGHT, CARD_OUTLINE_THICKNESS, CARD_WIDTH } from '@/shared/const/game.ts'
import { AnyCardRegion } from '@/shared/types/model.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { PhaserDataKey, RegionCategory } from '@/client/game/types.ts'
import { useCardTexture } from '@/client/game/composables/useCardTexture.ts'
import { StackDraw, useStackTopCard } from '@/client/game/composables/useStackTopCard.ts'

const {
    x,
    y,
    width,
    height,
    cardRegion,
    showTopCard = false,
} = defineProps<{
    x: number
    y: number
    width: number
    height: number
    cardRegion: AnyCardRegion
    showTopCard?: boolean
}>()

const gameBus = useGameBusStore()

const image = refObj<GameObjects.Image>()

const topCard = computed(() => (cardRegion.length > 0 ? cardRegion.firstCard : null))

const displayedTexture = computed(() => {
    return topCard.value ?
            useCardTexture(topCard.value).displayedTexture.value
        :   { textureName: undefined, frameName: undefined }
})

// Free Table stacks reuse the tabletop stack behaviour : left-click draws,
// right-click opens the context menu, hovering the ash heap closes up its top
// card. The draw type is derived from the region, and crypt draws go through
// the Free Table mutation ( FT_drawCrypt ).
const draw = computed<StackDraw | undefined>(() => {
    if (cardRegion.is.library) {
        return 'library'
    }
    if (cardRegion.is.crypt) {
        return 'crypt'
    }
    return undefined
})

const topCardInteractions = useStackTopCard({
    cardRegion: () => cardRegion,
    topCard: () => topCard.value,
    draw: () => draw.value,
    freeTable: true,
})
const { drawHoverAttrs } = topCardInteractions

// When showing the top card, the title sits in a strip at the top of the
// box and the ( rotated ) card takes up the remaining space below it
const TITLE_AREA_HEIGHT = 16

const titleY = computed(() => y - height / 2 + TITLE_AREA_HEIGHT / 2)
const cardAreaHeight = computed(() => height - TITLE_AREA_HEIGHT)
const cardY = computed(() => y - height / 2 + TITLE_AREA_HEIGHT + cardAreaHeight.value / 2)

// The card is rotated 90deg, so its displayed bounding box has width/height
// swapped compared to the source texture
const rotatedCardScale = computed(() => {
    return Math.min(width / CARD_HEIGHT, cardAreaHeight.value / CARD_WIDTH) * 0.9
})

const isDraggedOver = computed(() => {
    return (
        gameBus.dragOver != null &&
        gameBus.dragOver.cardRegion?.oid == cardRegion.oid &&
        gameBus.dragOver.card.region.oid != cardRegion.oid
    )
})

function onBoundariesCreate(boundaries: GameObjects.Rectangle) {
    boundaries.setData(PhaserDataKey.CardRegionOid, cardRegion.oid)
    boundaries.setData(PhaserDataKey.RegionCategory, RegionCategory.Stack)

    // boundaries is already interactive because it declares a dropZone,
    // so we update its cursor property instead of using setInteractive()
    if (boundaries.input) {
        boundaries.input.cursor = 'pointer'
    }
}

function onBoundariesPointerDown() {
    gameBus.wieldCardStack.show = true
    gameBus.wieldCardStack.cardRegion = cardRegion
}
</script>

<style lang="scss"></style>
