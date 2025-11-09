<template>
    <Image
        ref="image"
        :key="key + 'image'"
        :x="isDragging ? dragPosition.x + (image ? image.displayWidth / 2 : 0) : cardAttrs.x"
        :y="(isDragging ? dragPosition.y : cardAttrs.y) + (image ? image.displayHeight / 2 : 0)"
        :texture="card.displayedTexture.textureName"
        :frame="card.displayedTexture.frameName"
        :alpha="isDragging ? CARD_DRAGGING_ALPHA : 1"
        :scale="cardAttrs.scale"
        @create="onImageCreate"
        @pointerover="onPointerOver"
        @pointerout="onPointerOut"
        @pointerdown="onPointerDown"
        @dragstart="onDragStartFromHand"
        @drag="onDrag"
        @dragend="onDragEndFromHand"
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
        :lineWidth="CARD_OUTLINE_THICKNESS"
        :strokeColor="getCardOutlineColor"
    />

    <!-- On hover : Play button  -->
    <template v-if="isHovered && !isDragging">
        <ButtonGo
            ref="playButton"
            name="cardButton"
            :x="cardAttrs.x + (image ? image.displayWidth / 2 : 0) - 32"
            :y="cardAttrs.y + 15"
            :width="60"
            :height="25"
            text="Play"
            @pointerover="onPointerOver"
            @pointerout="onPointerOut"
            @click="playCard"
        />
    </template>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watchEffect, toRef } from 'vue'
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
    CARD_WIDTH,
    GRID_SIZE,
    HAND_WIDTH,
    PLAY_AREA_WIDTH,
} from '@/game/const.ts'
import { LibraryCard } from '@/model/Card.ts'
import { useGameBusStore } from '@/store/bus.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import Pointer = Phaser.Input.Pointer
import Glow = Phaser.FX.Glow
import { CardAttrs, CardCategory, PhaserDataKey } from '@/game/types.ts'
import { useCardDragDrop } from '@/game/composables/useCardDragDrop.ts'
import { positionContextMenu } from '@/game/utils.ts'
import ButtonGo from '@/game/objects/ButtonGo.vue'
import { gameMutations } from '@/state/gameMutations.ts'

const { card } = defineProps<{
    card: LibraryCard
}>()

const gameState = useGameStateStore()
const gameBus = useGameBusStore()
const scene = useScene()
const image = refObj<GameObjects.Image>()
const dragPlaceholder = refObj<GameObjects.Image>()
const cardOutline = refObj<GameObjects.Rectangle>()
const playButton = ref<typeof ButtonGo>()

const key = computed(() => `hand${card.oid.toString()}`)

const cardAttrs = computed((): CardAttrs => {
    const category = CardCategory.CardInHand

    if (!gameState.selfPlayer) {
        return { category, x: 0, y: 0, rotation: 0, scale: 1 }
    }

    const hand = gameState.selfPlayer.hand

    let handLength = hand.length
    let cardIndex = hand.indexOf(card)
    let cardIndexOffset = 0
    // When dragging any card into the hand,
    // display the card at its position after drop
    if (gameBus.handDropGapPosition !== null) {
        handLength++
        if (cardIndex >= gameBus.handDropGapPosition) {
            cardIndexOffset++
        }
    }
    // When the dragged card comes from the hand, remove it from calculations
    if (gameBus.draggedHandCardPosition !== null) {
        handLength--
        if (cardIndex > gameBus.draggedHandCardPosition) {
            cardIndexOffset--
        }
    }
    cardIndex += cardIndexOffset

    const maxSpacing = CARD_WIDTH * CARD_IN_HAND_SCALE + 10
    const spacing = Math.min(
        (HAND_WIDTH - CARD_WIDTH * CARD_IN_HAND_SCALE) / (handLength - 1),
        maxSpacing,
    )
    const totalWidth = spacing * (handLength - 1) + CARD_WIDTH * CARD_IN_HAND_SCALE
    const offsetX = (HAND_WIDTH - totalWidth) / 2
    const x = offsetX + spacing * cardIndex + (image.value?.displayWidth ?? 0) / 2
    return { category, x, y: 0, rotation: 0, scale: CARD_IN_HAND_SCALE }
})

/**
 * Save Card model on the Image Game Object
 */

function onImageCreate(image: GameObjects.Image) {
    image.setData(PhaserDataKey.CardOid, card.oid)
    image.setData(PhaserDataKey.CardAttrs, cardAttrs)

    // Watch for usable and dragging state changes to toggle glow
    watchEffect(toggleGlowEffect)
}

/**
 * Play button
 */

function playCard() {
    gameMutations.moveCardToRegion.actSelf({
        card,
        fromCardRegion: card.region,
        toCardRegion: card.owner.ready,
        x: PLAY_AREA_WIDTH / 2 - GRID_SIZE * 2,
        y: GRID_SIZE * 4,
    })
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
    playButton.value?.bringToTop()
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
    gameBus.selectedCards = [card]
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
    toRef(() => card),
    cardAttrs,
    image,
    cardOutline,
)

function onDragStartFromHand() {
    if (!gameState.selfPlayer) {
        return
    }
    gameBus.draggedHandCardPosition = gameState.selfPlayer.hand.indexOf(card)
    onDragStart()
}

function onDrag({}, dragX: number, dragY: number) {
    if (!image.value) {
        return
    }
    dragPosition.x = Phaser.Math.Snap.To(dragX - image.value.displayWidth / 2, GRID_SIZE)
    dragPosition.y =
        Phaser.Math.Snap.Ceil(dragY - image.value.displayHeight / 2, GRID_SIZE) - GRID_SIZE / 2
}

function onDragEndFromHand() {
    if (!gameState.selfPlayer) {
        return
    }
    gameBus.draggedHandCardPosition = null
    onDragEnd()
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
