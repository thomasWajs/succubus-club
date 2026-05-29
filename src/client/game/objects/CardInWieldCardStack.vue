<template>
    <Image
        ref="dragPlaceholder"
        :key="key + 'dragPlaceholder'"
        :origin="0"
        :x="cardAttrs.x"
        :y="cardAttrs.y"
        :texture="displayedTexture.textureName"
        :frame="displayedTexture.frameName"
        :scale="cardAttrs.scale"
        :visible="dragAttrs.isDragging && gameBus.stackDropGapPosition === null"
    />

    <Image
        ref="image"
        :key="key + 'image'"
        :origin="0"
        :x="dragAttrs.isDragging ? dragAttrs.x : cardAttrs.x"
        :y="dragAttrs.isDragging ? dragAttrs.y : cardAttrs.y"
        :texture="displayedTexture.textureName"
        :frame="displayedTexture.frameName"
        :alpha="dragAttrs.isDragging ? CARD_DRAGGING_ALPHA : 1"
        :scale="dragAttrs.isDragging ? dragAttrs.cardScale : cardAttrs.scale"
        @create="onImageCreate"
        @pointerover="onPointerOver"
        @pointerout="onPointerOut"
        @pointerdown="onPointerDown"
        @dragstart="onDragStartFromStack"
        @drag="onDrag"
        @dragend="onDragEndFromStack"
        @drop="onDrop"
        @wheel="(...args: [WheelEvent]) => emit('wheel', ...args)"
    />

    <Rectangle
        v-if="players.isPlayer"
        ref="cardOutline"
        :key="key + 'cardOutline'"
        :visible="!dragAttrs.isDragging && !!getCardOutlineColor"
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
    WIELD_CARD_DISPLAY_WIDTH,
    WIELD_CARDS_OFFSET,
    WIELD_INDICATOR_WIDTH,
    WIELD_X,
} from '@/shared/const/game.ts'
import { Card } from '@/shared/model/Card.ts'
import { CardAttrs, PhaserDataKey, RegionCategory } from '@/client/game/types.ts'
import { useCardClick } from '@/client/game/composables/useCardClick.ts'
import { useCardOutline } from '@/client/game/composables/useCardOutline.ts'
import { useCardDragDrop } from '@/client/game/composables/useCardDragDrop.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { getCardScale, reorderCardIndex } from '@/client/game/utils.ts'
import { useCardTexture } from '@/client/game/composables/useCardTexture.ts'
import { AnyCardRegion } from '@/shared/types/model.ts'

const STACK_CARD_Y = 15

const { card, cardRegion, displayIndex } = defineProps<{
    card: Card
    cardRegion: AnyCardRegion
    displayIndex: number
}>()

const gameBus = useGameBusStore()
const players = usePlayersStore()
const { displayedTexture } = useCardTexture(card)

const image = refObj<GameObjects.Image>()
const dragPlaceholder = refObj<GameObjects.Image>()
const cardOutline = refObj<GameObjects.Rectangle>()

const key = computed(() => `wield${card.oid.toString()}`)

const cardAttrs = computed((): CardAttrs => {
    // When a search filter is active, use the display index as-is (no gap reordering)
    const { index } =
        gameBus.wieldCardStack.searchString ?
            { index: displayIndex }
        :   reorderCardIndex(
                cardRegion.cards.indexOf(card),
                cardRegion.cards.length,
                gameBus.stackDropGapPosition,
                gameBus.draggedStackCardPosition,
            )

    return {
        category: RegionCategory.Stack,
        x: WIELD_X + index * WIELD_CARD_DISPLAY_WIDTH + WIELD_CARDS_OFFSET + WIELD_INDICATOR_WIDTH,
        y: STACK_CARD_Y,
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

function onDragStartFromStack() {
    gameBus.draggedStackCardPosition = cardRegion.cards.indexOf(card)
    onDragStart()
}

// A modified version of onDragEnd that unselects the card and resets stack drag state.
function onDragEndFromStack() {
    gameBus.draggedStackCardPosition = null
    onDragEnd()
    gameBus.selectedCards = []
}

/**
 * Expose/Emit
 */

const emit = defineEmits(['wheel'])
</script>
