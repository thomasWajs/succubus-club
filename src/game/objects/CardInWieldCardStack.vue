<template>
    <Image
        ref="dragPlaceholder"
        :key="key + 'dragPlaceholder'"
        :origin="0"
        :x="cardAttrs.x"
        :y="cardAttrs.y"
        :texture="card.displayedTexture.textureName"
        :frame="card.displayedTexture.frameName"
        :scale="cardAttrs.scale"
        :visible="dragAttrs.isDragging"
    />

    <Image
        ref="image"
        :key="key + 'image'"
        :origin="0"
        :x="dragAttrs.isDragging ? dragAttrs.x : cardAttrs.x"
        :y="dragAttrs.isDragging ? dragAttrs.y : cardAttrs.y"
        :texture="card.displayedTexture.textureName"
        :frame="card.displayedTexture.frameName"
        :alpha="dragAttrs.isDragging ? CARD_DRAGGING_ALPHA : 1"
        :scale="dragAttrs.isDragging ? dragAttrs.cardScale : cardAttrs.scale"
        @create="onImageCreate"
        @pointerover="onPointerOver"
        @pointerout="onPointerOut"
        @pointerdown="onPointerDown"
        @dragstart="onDragStart()"
        @drag="onDrag"
        @dragend="onDragEndFromStack"
        @drop="onDrop"
        @wheel="(...args: [WheelEvent]) => emit('wheel', ...args)"
    />

    <Rectangle
        v-if="gameState.isPlayer"
        ref="cardOutline"
        :key="key + 'cardOutline'"
        :visible="!!getCardOutlineColor"
        :origin="0"
        :x="cardAttrs.x"
        :y="cardAttrs.y"
        :width="CARD_WIDTH * cardAttrs.scale"
        :height="CARD_HEIGHT * cardAttrs.scale"
        :lineWidth="CARD_OUTLINE_THICKNESS"
        :strokeColor="getCardOutlineColor"
    />
</template>

<script setup lang="ts">
import { computed, toRef } from 'vue'
import { GameObjects } from 'phaser'
import { Image, Rectangle, refObj } from 'phavuer'

import {
    CARD_DRAGGING_ALPHA,
    CARD_HEIGHT,
    CARD_OUTLINE_THICKNESS,
    CARD_WIDTH,
} from '@/game/const.ts'
import { Card } from '@/model/Card.ts'
import { CardAttrs, RegionCategory, PhaserDataKey } from '@/game/types.ts'
import { useCardClick } from '@/game/composables/useCardClick.ts'
import { useCardOutline } from '@/game/composables/useCardOutline.ts'
import { useCardDragDrop } from '@/game/composables/useCardDragDrop.ts'
import { useGameBusStore } from '@/store/bus.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { getCardScale } from '@/game/utils.ts'

const gameBus = useGameBusStore()
const gameState = useGameStateStore()

const { card, x, y } = defineProps<{
    card: Card
    x: number
    y: number
}>()

const image = refObj<GameObjects.Image>()
const dragPlaceholder = refObj<GameObjects.Image>()
const cardOutline = refObj<GameObjects.Rectangle>()

const key = computed(() => `wield${card.oid.toString()}`)

const cardAttrs = computed((): CardAttrs => {
    return {
        category: RegionCategory.Stack,
        x,
        y,
        rotation: 0,
        scale: getCardScale(RegionCategory.Stack),
    }
})

/**
 * Save Card model on the Image Game Object
 */

function onImageCreate(image: GameObjects.Image) {
    image.setData(PhaserDataKey.CardOid, card.oid)
    image.setData(PhaserDataKey.CardAttrs, cardAttrs)
}

/**
 * Bring to top
 */

function bringToTop() {
    if (!image.value) {
        return
    }

    const container = image.value.parentContainer
    if (dragPlaceholder.value) {
        container.bringToTop(dragPlaceholder.value)
    }
    container.bringToTop(image.value)
    if (cardOutline.value) {
        container.bringToTop(cardOutline.value)
    }
}

/**
 * Outline on pointer over / selection area
 */

const { onPointerOver, onPointerOut, getCardOutlineColor } = useCardOutline(
    toRef(() => card),
    image,
    false,
)

/**
 * Select/Deselect on simple click
 * Context Menu on right click
 */

const { onPointerDown } = useCardClick(
    toRef(() => card),
    false,
)

/**
 * Drag'n'Drop
 */

const { dragAttrs, onDragStart, onDrag, onDragEnd, onDrop } = useCardDragDrop(
    toRef(() => card),
    cardAttrs,
    bringToTop,
)

// A modified version of onDragEnd that unselect the card at the end of the drag.
function onDragEndFromStack() {
    onDragEnd()
    gameBus.selectedCards = []
}

/**
 * Expose/Emit
 */

const emit = defineEmits(['wheel'])
</script>
