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
            name="playButton"
            :x="overlays.play.x"
            :y="overlays.play.y"
            :width="60"
            :height="25"
            text="Play"
            @pointerover="onPointerOver"
            @pointerout="onPointerOut"
            @click="overlayClick(playCardFromHand)"
        />

        <!-- Discard -->
        <ButtonGo
            ref="discardButton"
            name="discardButton"
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
import { GameObjects, Geom, Input } from 'phaser'
import { FxGlow, Image, Rectangle, refObj } from 'phavuer'

import { Colors } from '@/client/colors.ts'
import {
    CARD_DRAGGING_ALPHA,
    CARD_HEIGHT,
    CARD_IN_HAND_GLOW_INNER_STRENGTH,
    CARD_IN_HAND_GLOW_OUTER_STRENGTH,
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
import {
    dilateRectangle,
    getCardScale,
    getWorldPoint,
    reorderCardIndex,
} from '@/client/game/utils.ts'
import { playCard } from '@/client/game/declaration.ts'
import { selfCanPlay } from '@/client/state/self.ts'
import { useCardTexture } from '@/client/game/composables/useCardTexture.ts'
import { useUIFeatures } from '@/client/game/composables/useUIFeatures.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'

const { card, handWidth, interactive } = defineProps<{
    card: LibraryCard
    handWidth: number
    interactive: boolean
}>()

const players = usePlayersStore()
const gameBus = useGameBusStore()
const gameState = useGameStateStore()
const commands = useCommands()
const { displayedTexture } = useCardTexture(card)
const image = refObj<GameObjects.Image>()
const cardOutline = refObj<GameObjects.Rectangle>()
const playButton = ref<typeof ButtonGo>()
const discardButton = ref<typeof ButtonGo>()

const key = computed(() => `hand${card.oid.toString()}`)

const cardAttrs = computed((): CardAttrs => {
    const category = RegionCategory.Hand
    const hand = card.region
    let x = 0

    if (hand) {
        const { index: cardIndex, length: handLength } = reorderCardIndex(
            hand.indexOf(card),
            hand.length,
            interactive ? gameBus.handDropGapPosition : null,
            interactive ? gameBus.draggedHandCardPosition : null,
        )

        const maxSpacing = CARD_WIDTH * CARD_IN_HAND_SCALE + 10
        const spacing = Math.min(
            (handWidth - CARD_WIDTH * CARD_IN_HAND_SCALE) / (handLength - 1),
            maxSpacing,
        )
        const totalWidth = spacing * (handLength - 1) + CARD_WIDTH * CARD_IN_HAND_SCALE
        // In the standard full-width 2p game, right-align cards to sit under the right play area.
        // For Puppeteer hand sections (narrower width), always center.
        const offsetX =
            handWidth === HAND_WIDTH && players.is2pGame ?
                handWidth - totalWidth
            :   (handWidth - totalWidth) / 2
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

function playCardFromHand(card: Card) {
    playCard({ card, actingMinion: gameState.action?.minionAction.actingMinion })
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
    if (interactive) {
        gameBus.draggedHandCardPosition = players.selfPlayer.hand.indexOf(card)
    }
    onDragStart()
}

/**
 * Card Dropiing
 */

// Margin (px) around the hand area within which a drop is still considered "in hand".
// A drop must land beyond this margin from the hand edge to play the card, so releasing
// just outside the hand keeps the card in hand.
const HAND_DROP_PLAY_MARGIN = 30

function getHandWorldBounds(): Geom.Rectangle | null {
    const boundaries = image.value?.parentContainer.list.find(
        (obj): obj is GameObjects.Rectangle =>
            obj instanceof GameObjects.Rectangle &&
            obj.getData(PhaserDataKey.CardRegionOid) === card.region.oid,
    )
    return boundaries ? boundaries.getBounds() : null
}

function onDragEndFromHand(
    pointer: Input.Pointer,
    _dragX: number,
    _dragY: number,
    dropped: boolean,
) {
    gameBus.draggedHandCardPosition = null
    onDragEnd()

    // Dropped outside of any drop zone : play the card instead of leaving it in hand,
    // unless the drop landed too close to the hand area (likely an accidental drag).
    if (!dropped) {
        const handBounds = getHandWorldBounds()
        const dropPoint = getWorldPoint(pointer.x, pointer.y)

        if (
            handBounds &&
            !dilateRectangle(handBounds, HAND_DROP_PLAY_MARGIN).contains(dropPoint.x, dropPoint.y)
        ) {
            playCardFromHand(card)
        }
    }
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
