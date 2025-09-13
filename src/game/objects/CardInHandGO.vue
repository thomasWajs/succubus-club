<template>
    <!-- Drag placeholder -->
    <Image
        ref="dragPlaceholder"
        :key="key + 'dragPlaceholder'"
        :x="cardAttrs.x"
        :y="cardAttrs.y + (image ? image.displayHeight / 2 : 0)"
        :texture="card.texture.textureName"
        :frame="card.displayedTexture.frameName"
        :scale="cardAttrs.scale"
        :rotation="cardAttrs.rotation"
    />

    <Image
        ref="image"
        :key="key + 'image'"
        :x="isDragging ? dragPosition.x + (image ? image.displayWidth / 2 : 0) : cardAttrs.x"
        :y="(isDragging ? dragPosition.y : cardAttrs.y) + (image ? image.displayHeight / 2 : 0)"
        :texture="card.texture.textureName"
        :frame="card.displayedTexture.frameName"
        :alpha="isDragging ? CARD_DRAGGING_ALPHA : 1"
        :scale="cardAttrs.scale"
        :rotation="isDragging ? 0 : cardAttrs.rotation"
        @create="onImageCreate"
        @pointerover="onPointerOver"
        @pointerout="onPointerOut"
        @pointerdown="onPointerDown"
        @dragstart="onDragStart"
        @drag="onDrag"
        @dragend="onDragEnd"
        @drop="onDrop"
    />

    <Rectangle
        ref="cardOutline"
        :key="key + 'cardOutline'"
        :visible="!!getCardOutlineColor"
        :x="cardAttrs.x"
        :y="cardAttrs.y + (image ? image.displayHeight / 2 : 0)"
        :width="image ? image.displayWidth : 0"
        :height="image ? image.displayHeight : 0"
        :rotation="cardAttrs.rotation"
        :lineWidth="CARD_OUTLINE_THICKNESS"
        :strokeColor="getCardOutlineColor"
    />
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watchEffect } from 'vue'
import Phaser, { GameObjects } from 'phaser'
import { Image, Rectangle, refObj, useScene } from 'phavuer'

import {
    CARD_DRAGGING_ALPHA,
    CARD_GLOW_COLOR,
    CARD_GLOW_INNER_STRENGTH,
    CARD_GLOW_OUTER_STRENGTH,
    CARD_GLOW_TWEEN_OUTER_STRENGTH,
    CARD_IN_HAND_SCALE,
    CARD_OUTLINE_COLOR_HOVER,
    CARD_OUTLINE_THICKNESS,
    HAND_ARC_ORIGIN_X,
    HAND_ARC_ORIGIN_Y,
    GRID_SIZE,
} from '@/game/const.ts'
import { LibraryCard } from '@/model/Card.ts'
import { useGameBusStore } from '@/store/bus.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import RotateAround = Phaser.Math.RotateAround
import Pointer = Phaser.Input.Pointer
import Glow = Phaser.FX.Glow
import { CardAttrs, CardCategory, PhaserDataKey } from '@/game/types.ts'
import { useCardDragDrop } from '@/game/composables/useCardDragDrop.ts'
import { positionContextMenu } from '@/game/utils.ts'

const { card } = defineProps<{
    card: LibraryCard
}>()

const gameState = useGameStateStore()
const gameBus = useGameBusStore()
const scene = useScene()
const image = refObj<GameObjects.Image>()
const dragPlaceholder = refObj<GameObjects.Image>()
const cardOutline = refObj<GameObjects.Rectangle>()

const key = computed(() => `hand${card.oid.toString()}`)

const cardAttrs = computed((): CardAttrs => {
    const category = CardCategory.CardInHand
    const hand = gameState.selfPlayer.hand

    let scale = CARD_IN_HAND_SCALE
    const center_x = HAND_ARC_ORIGIN_X
    let center_y = HAND_ARC_ORIGIN_Y

    // If there's too much cards in hand, reduce the scale and up the center
    if (hand.length > 9) {
        scale *= 0.75
        center_y -= 120
    } else if (hand.length > 7) {
        scale *= 0.95
        center_y -= 100
    }

    let cardIndex = hand.indexOf(card)
    let handLength = hand.length
    if (gameBus.handDropGapPosition != null && cardIndex >= gameBus.handDropGapPosition) {
        const DROP_GAP = 2
        cardIndex += DROP_GAP
        handLength += DROP_GAP
    }
    const rotation = Phaser.Math.DegToRad(10 * Math.ceil(cardIndex - handLength / 2))
    const { x, y } = RotateAround({ x: center_x, y: -10 }, center_x, center_y, rotation)
    return { category, x, y, rotation, scale }
})

/**
 * Save Card model on the Image Game Object
 */

function onImageCreate(image: GameObjects.Image) {
    image.setData(PhaserDataKey.Card, card)
    image.setData(PhaserDataKey.CardAttrs, cardAttrs)

    // Watch for usable and dragging state changes to toggle glow
    watchEffect(toggleGlowEffect)
}

/**
 * Outline and bring to top on pointer over
 */

const isHovered = ref(false)

function bringToTop(withOutline = false) {
    if (!image.value) {
        return
    }

    const container = image.value.parentContainer
    if (dragPlaceholder.value) {
        container.bringToTop(dragPlaceholder.value)
    }
    container.bringToTop(image.value)
    if (withOutline && cardOutline.value) {
        container.bringToTop(cardOutline.value)
    }
}

function onPointerOver() {
    isHovered.value = true
    gameBus.setCloseUpCard(card)
    bringToTop(true)
}

function onPointerOut() {
    isHovered.value = false
    emit('resetVisibility')
}

const getCardOutlineColor = computed(() => {
    return isHovered.value && gameBus.handDropGapPosition == null ?
            CARD_OUTLINE_COLOR_HOVER.color
        :   undefined
})

/**
 * Context Menu on right click
 */

function onRightClick(pointer: Pointer) {
    gameBus.contextMenu.cards = [card]
    gameBus.contextMenu.show = true

    const setXY = (x: number, y: number) => {
        gameBus.contextMenu.x = x
        // Always add an Y offset to keep some space from the bottom of the screen
        gameBus.contextMenu.y = y - 20
    }
    positionContextMenu(pointer.x, pointer.y, pointer.y, '.context-menu', setXY)
}

function onPointerDown(pointer: Pointer) {
    if (pointer.rightButtonDown()) {
        onRightClick(pointer)
    }
}

/**
 * Drag'n'Drop
 */

const { isDragging, dragPosition, onDragStart, onDragEnd, onDrop } = useCardDragDrop(
    card,
    cardAttrs,
    image,
    cardOutline,
)

function onDrag({}, dragX: number, dragY: number) {
    if (!image.value) {
        return
    }
    dragPosition.x = Phaser.Math.Snap.To(dragX - image.value.displayWidth / 2, GRID_SIZE)
    dragPosition.y = Phaser.Math.Snap.To(dragY - image.value.displayHeight / 2, GRID_SIZE)
}

/**
 * Glow effect on usable card, depending on the phase of the turn.
 * On hold for now, as the glow effect create aliasing on the border of glowing cards.
 */

const GLOW_ENABLED = false

let glowFx: Glow | undefined

function applyGlowEffect() {
    if (!image || !image.value) {
        return
    }

    glowFx = image.value.preFX?.addGlow(
        CARD_GLOW_COLOR.color,
        CARD_GLOW_OUTER_STRENGTH,
        CARD_GLOW_INNER_STRENGTH,
        false,
    )
    if (glowFx) {
        scene.tweens.add({
            targets: glowFx,
            outerStrength: CARD_GLOW_TWEEN_OUTER_STRENGTH,
            yoyo: true,
            loop: -1,
            ease: 'sine.inout',
        })
    }
}

function removeGlowEffect() {
    if (glowFx) {
        glowFx.destroy()
        glowFx = undefined
    }
}

function toggleGlowEffect() {
    if (!GLOW_ENABLED) {
        return
    }
    if (card.isUsable() && !isDragging.value) {
        applyGlowEffect()
    } else if (glowFx) {
        removeGlowEffect()
    }
}

if (GLOW_ENABLED) {
    onUnmounted(() => removeGlowEffect())
}

/**
 * Expose/Emit
 */

const emit = defineEmits(['resetVisibility'])

defineExpose({
    bringToTop,
    cardAttrs,
    card,
})
</script>
