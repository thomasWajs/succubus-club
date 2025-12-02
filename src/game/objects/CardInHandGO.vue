<template>
    <Image
        ref="image"
        :key="key + 'image'"
        :origin="0"
        :x="dragAttrs.isDragging ? dragAttrs.x : cardAttrs.x"
        :y="dragAttrs.isDragging ? dragAttrs.y : cardAttrs.y"
        :texture="card.displayedTexture.textureName"
        :frame="card.displayedTexture.frameName"
        :alpha="dragAttrs.isDragging ? CARD_DRAGGING_ALPHA : 1"
        :scale="dragAttrs.isDragging ? dragAttrs.scale : cardAttrs.scale"
        @create="onImageCreate"
        @pointerover="onPointerOverHand"
        @pointerout="onPointerOutHand"
        @pointerdown="onPointerDown"
        @dragstart="onDragStartFromHand"
        @drag="onDrag"
        @dragend="onDragEndFromHand"
        @drop="onDrop"
    >
        <!-- Glow effect -->
        <FxGlow
            v-if="showGlowEffect"
            :color="CARD_GLOW_COLOR.color"
            :outerStrength="CARD_IN_HAND_GLOW_OUTER_STRENGTH"
            :innerStrength="CARD_IN_HAND_GLOW_INNER_STRENGTH"
        />
    </Image>

    <Rectangle
        ref="cardOutline"
        :key="key + 'cardOutline'"
        :visible="!dragAttrs.isDragging && !!getCardOutlineColor"
        :origin="0"
        :x="cardAttrs.x"
        :y="cardAttrs.y"
        :width="image ? image.displayWidth : 0"
        :height="image ? image.displayHeight : 0"
        :lineWidth="CARD_OUTLINE_THICKNESS"
        :strokeColor="getCardOutlineColor"
    />

    <!-- Hovered buttons -->
    <template v-if="isHovered && !dragAttrs.isDragging">
        <!-- Play -->
        <ButtonGo
            ref="playButton"
            name="cardButton"
            :x="overlays.play.x"
            :y="overlays.play.y"
            :width="60"
            :height="25"
            text="Play"
            @pointerover="onPointerOver"
            @pointerout="onPointerOut"
            @click="overlayClick(playCard)"
        />

        <!-- Discard -->
        <ButtonGo
            ref="discardButton"
            name="cardButton"
            :x="overlays.ashHeap.x"
            :y="overlays.ashHeap.y"
            :width="ASH_HEAP_BUTTON_SIZE"
            :height="ASH_HEAP_BUTTON_SIZE"
            text="🔥"
            @pointerover="onPointerOver"
            @pointerout="onPointerOut"
            @click="overlayClick(commands.MoveToAshHeap.cardAction)"
        />
    </template>
</template>

<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import { GameObjects } from 'phaser'
import { Image, Rectangle, FxGlow, refObj } from 'phavuer'

import {
    CARD_DRAGGING_ALPHA,
    CARD_GLOW_COLOR,
    CARD_IN_HAND_GLOW_INNER_STRENGTH,
    CARD_IN_HAND_GLOW_OUTER_STRENGTH,
    CARD_HEIGHT,
    CARD_IN_HAND_SCALE,
    CARD_OUTLINE_THICKNESS,
    CARD_WIDTH,
    COUNTER_OUTLINE_THICKNESS,
    GRID_SIZE,
    HAND_WIDTH,
    OVERLAY_BUTTON_SIZE,
    PLAY_AREA_WIDTH,
} from '@/game/const.ts'
import { Card, LibraryCard } from '@/model/Card.ts'
import { useGameBusStore } from '@/store/bus.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { useCommands } from '@/game/composables/useCommands.ts'
import { CardAttrs, RegionCategory, PhaserDataKey } from '@/game/types.ts'
import { useCardDragDrop } from '@/game/composables/useCardDragDrop.ts'
import ButtonGo from '@/game/objects/ButtonGo.vue'
import { gameMutations } from '@/state/gameMutations.ts'
import { useCardClick } from '@/game/composables/useCardClick.ts'
import { useCardOutline } from '@/game/composables/useCardOutline.ts'
import { useCoreStore } from '@/store/core.ts'
import { getCardScale } from '@/game/utils.ts'

const { card } = defineProps<{
    card: LibraryCard
}>()

const core = useCoreStore()
const gameState = useGameStateStore()
const gameBus = useGameBusStore()
const commands = useCommands()
const image = refObj<GameObjects.Image>()
const dragPlaceholder = refObj<GameObjects.Image>()
const cardOutline = refObj<GameObjects.Rectangle>()
const playButton = ref<typeof ButtonGo>()
const discardButton = ref<typeof ButtonGo>()

const key = computed(() => `hand${card.oid.toString()}`)

const cardAttrs = computed((): CardAttrs => {
    const category = RegionCategory.Hand
    const hand = gameState.selfPlayer?.hand
    let x = 0

    if (hand) {
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
        const offsetX = gameState.is2pGame ? HAND_WIDTH - totalWidth : (HAND_WIDTH - totalWidth) / 2
        x = offsetX + spacing * cardIndex
    }

    return { category, x, y: 0, rotation: 0, scale: getCardScale(category) }
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
    discardButton.value?.bringToTop()
}

/**
 * Overlay ( counters & buttons )
 */

const ASH_HEAP_BUTTON_SIZE = OVERLAY_BUTTON_SIZE * 1.5

const overlays = computed(() => {
    const totalAshHeapButtonSize = ASH_HEAP_BUTTON_SIZE + COUNTER_OUTLINE_THICKNESS
    const rightEdge = cardAttrs.value.x + CARD_WIDTH * CARD_IN_HAND_SCALE
    const bottomEdge = cardAttrs.value.y + CARD_HEIGHT * CARD_IN_HAND_SCALE

    return {
        play: {
            x: rightEdge - 32,
            y: cardAttrs.value.y + 15,
        },
        ashHeap: {
            x: rightEdge - totalAshHeapButtonSize / 2 - 1, // -1 is to account for outline thickness
            y: bottomEdge - totalAshHeapButtonSize / 2 - 1, // -1 is to account for outline thickness
        },
    }
})

function overlayClick(command: (card: Card) => void) {
    if (!gameBus.declaringTargetOrigin) {
        command(card)
    }
}

function playCard(card: Card) {
    gameMutations.moveCardToRegion.actSelf({
        card,
        fromCardRegion: card.region,
        toCardRegion: card.owner.ready,
        x: PLAY_AREA_WIDTH / 2 - GRID_SIZE * 2,
        y: GRID_SIZE * 4,
    })
}

/**
 * Outline and bring to top on pointer over / selection area
 */

const { isHovered, onPointerOver, onPointerOut, getCardOutlineColor } = useCardOutline(
    toRef(() => card),
    image,
    false,
)

function onPointerOverHand() {
    onPointerOver()
    bringToTop(true)
}

function onPointerOutHand() {
    onPointerOut()
    emit('resetVisibility')
}

/**
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

function onDragStartFromHand() {
    if (!gameState.selfPlayer) {
        return
    }
    gameBus.draggedHandCardPosition = gameState.selfPlayer.hand.indexOf(card)
    onDragStart()
}

function onDragEndFromHand() {
    gameBus.draggedHandCardPosition = null
    onDragEnd()
}

/**
 * Glow effect on usable card, depending on the phase of the turn.
 */

const glowInHandEnabled = computed(() => core.userProfile.preferences.glowInHand ?? true)
const showGlowEffect = computed(
    () => glowInHandEnabled.value && card.isPlayable() && !dragAttrs.isDragging,
)

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
