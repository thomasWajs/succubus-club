<template>
    <Image
        ref="dragPlaceholder"
        :key="key + 'dragPlaceholder'"
        :origin="0"
        :x="x"
        :y="y"
        :texture="card.displayedTexture.textureName"
        :frame="card.displayedTexture.frameName"
        :scale="WIELD_CARD_SCALE"
    />

    <Image
        ref="image"
        :key="key + 'image'"
        :origin="0"
        :x="isDragging ? dragPosition.x : x"
        :y="isDragging ? dragPosition.y : y"
        :texture="card.displayedTexture.textureName"
        :frame="card.displayedTexture.frameName"
        :alpha="isDragging ? CARD_DRAGGING_ALPHA : 1"
        :scale="WIELD_CARD_SCALE"
        @create="onImageCreate"
        @pointerover="onPointerOver"
        @pointerout="onPointerOut"
        @pointerdown="onPointerDown"
        @dragstart="onDragStart"
        @drag="onDrag"
        @dragend="onDragEnd"
        @drop="onDrop"
        @wheel="(...args: [WheelEvent]) => emit('wheel', ...args)"
    />

    <Rectangle
        ref="cardOutline"
        :key="key + 'cardOutline'"
        :visible="!!getCardOutlineColor"
        :origin="0"
        :x="x"
        :y="y"
        :width="image ? image.displayWidth : 0"
        :height="image ? image.displayHeight : 0"
        :lineWidth="CARD_OUTLINE_THICKNESS"
        :strokeColor="getCardOutlineColor"
    />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { GameObjects } from 'phaser'
import { Image, Rectangle, refObj } from 'phavuer'

import { CARD_DRAGGING_ALPHA, CARD_OUTLINE_THICKNESS, WIELD_CARD_SCALE } from '@/game/const.ts'
import { Card } from '@/model/Card.ts'
import { CardAttrs, CardCategory, PhaserDataKey } from '@/game/types.ts'
import { useCardClick } from '@/game/composables/useCardClick.ts'
import { useCardOutline } from '@/game/composables/useCardOutline.ts'
import { useCardDragDrop } from '@/game/composables/useCardDragDrop.ts'

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
        category: CardCategory.CardInStack,
        x,
        y,
        rotation: 0,
        scale: WIELD_CARD_SCALE,
    }
})

/**
 * Save Card model on the Image Game Object
 */

function onImageCreate(image: GameObjects.Image) {
    image.setData(PhaserDataKey.Card, card)
    image.setData(PhaserDataKey.CardAttrs, cardAttrs)
}

/**
 * Outline on pointer over / selection area
 */

const { onPointerOver, onPointerOut, getCardOutlineColor } = useCardOutline(card, image, false)

/**
 * Select/Deselect on simple click
 * Context Menu on right click
 */

const { onPointerDown } = useCardClick(card, false)

/**
 * Drag'n'Drop
 */

const { isDragging, dragPosition, onDragStart, onDrag, onDragEnd, onDrop } = useCardDragDrop(
    card,
    cardAttrs,
    image,
    cardOutline,
)

/**
 * Expose/Emit
 */

const emit = defineEmits(['wheel'])
</script>
