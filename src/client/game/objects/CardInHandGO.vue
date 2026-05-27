<template>
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
            :color="Colors.CARD_GLOW.color"
            :outerStrength="CARD_IN_HAND_GLOW_OUTER_STRENGTH"
            :innerStrength="CARD_IN_HAND_GLOW_INNER_STRENGTH"
            :scale="CARD_IN_HAND_GLOW_SCALE"
            @create="onGlowCreate"
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
import Phaser, { GameObjects } from 'phaser'
import { FxGlow, Image, Rectangle, refPhaserInstance } from 'phavuer'

import { Colors } from '@/client/colors.ts'
import {
    CARD_DRAGGING_ALPHA,
    CARD_HEIGHT,
    CARD_IN_HAND_GLOW_INNER_STRENGTH,
    CARD_IN_HAND_GLOW_OUTER_STRENGTH,
    CARD_IN_HAND_GLOW_SCALE,
    CARD_IN_HAND_SCALE,
    CARD_OUTLINE_THICKNESS,
    CARD_WIDTH,
    COUNTER_OUTLINE_THICKNESS,
    HAND_WIDTH,
    OVERLAY_BUTTON_SIZE,
} from '@/shared/const/game.ts'
import { Card, LibraryCard } from '@/shared/model/Card.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { useCommands } from '@/client/game/composables/useCommands.ts'
import { CardAttrs, PhaserDataKey, RegionCategory } from '@/client/game/types.ts'
import { useCardDragDrop } from '@/client/game/composables/useCardDragDrop.ts'
import ButtonGo from '@/client/game/objects/ButtonGo.vue'
import { useCardClick } from '@/client/game/composables/useCardClick.ts'
import { useCardOutline } from '@/client/game/composables/useCardOutline.ts'
import { getCardScale, reorderCardIndex } from '@/client/game/utils.ts'
import { playCardFromHand } from '@/client/game/declaration.ts'
import { selfCanPlay } from '@/client/state/self.ts'
import { useCardTexture } from '@/client/game/composables/useCardTexture.ts'
import { useUIFeatures } from '@/client/game/composables/useUIFeatures.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'

const { card } = defineProps<{
    card: LibraryCard
}>()

const players = usePlayersStore()
const gameBus = useGameBusStore()
const gameState = useGameStateStore()
const commands = useCommands()
const { displayedTexture } = useCardTexture(card)
const image = refPhaserInstance<GameObjects.Image>(null)
const cardOutline = refPhaserInstance<GameObjects.Rectangle>(null)
const playButton = ref<typeof ButtonGo>()
const discardButton = ref<typeof ButtonGo>()

const key = computed(() => `hand${card.oid.toString()}`)

const cardAttrs = computed((): CardAttrs => {
    const category = RegionCategory.Hand
    const hand = players.selfPlayer?.hand
    let x = 0

    if (hand) {
        const { index: cardIndex, length: handLength } = reorderCardIndex(
            hand.indexOf(card),
            hand.length,
            gameBus.handDropGapPosition,
            gameBus.draggedHandCardPosition,
        )

        const maxSpacing = CARD_WIDTH * CARD_IN_HAND_SCALE + 10
        const spacing = Math.min(
            (HAND_WIDTH - CARD_WIDTH * CARD_IN_HAND_SCALE) / (handLength - 1),
            maxSpacing,
        )
        const totalWidth = spacing * (handLength - 1) + CARD_WIDTH * CARD_IN_HAND_SCALE
        const offsetX = players.is2pGame ? HAND_WIDTH - totalWidth : (HAND_WIDTH - totalWidth) / 2
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
 * Card Glow
 */

function onGlowCreate(glowFx: Phaser.Filters.Controller) {
    glowFx.setPaddingOverride(-50, -50, 50, 50)
}

/**
 * Bring to top
 */

function bringToTop(withOutline = false) {
    if (!image.value) {
        return
    }

    const container = image.value.parentContainer
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
    playCardFromHand({ card, actingMinion: gameState.action?.minionAction.actingMinion })
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
    if (!players.selfPlayer) {
        return
    }
    gameBus.draggedHandCardPosition = players.selfPlayer.hand.indexOf(card)
    onDragStart()
}

function onDragEndFromHand() {
    gameBus.draggedHandCardPosition = null
    onDragEnd()
}

/**
 * Glow effect on usable card, depending on the phase of the turn.
 */

const { glowInHandEnabled } = useUIFeatures()
const showGlowEffect = computed(
    () => glowInHandEnabled.value && selfCanPlay(card) && !dragAttrs.isDragging,
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
