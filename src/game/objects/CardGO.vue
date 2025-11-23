<template>
    <!-- Drag Placeholder -->
    <Image
        ref="dragPlaceholder"
        :key="key + 'dragPlaceholder'"
        :origin="0.5"
        :x="cardAttrs.x"
        :y="cardAttrs.y"
        :texture="card.displayedTexture.textureName"
        :frame="card.displayedTexture.frameName"
        :scale="cardScale"
        :rotation="cardAttrs.rotation"
        :tween="rotationTween"
    />

    <!-- Main Card Image -->
    <Image
        ref="image"
        :key="key + 'image'"
        :origin="0.5"
        :x="dragAttrs.isDragging ? dragAttrs.x + (cardAttrs.offsetX ?? 0) : cardAttrs.x"
        :y="dragAttrs.isDragging ? dragAttrs.y + (cardAttrs.offsetY ?? 0) : cardAttrs.y"
        :texture="card.displayedTexture.textureName"
        :frame="card.displayedTexture.frameName"
        :alpha="dragAttrs.isDragging ? CARD_DRAGGING_ALPHA : 1"
        :scale="dragAttrs.isDragging ? dragAttrs.scale : cardAttrs.scale"
        :rotation="cardAttrs.rotation"
        :tween="rotationTween"
        @create="onImageCreate"
        @pointerover="onPointerOver"
        @pointerout="onPointerOut"
        @pointerdown="onPointerDown"
        @dragstart="dispatchDragStart"
        @drag="dispatchDrag"
        @dragend="dispatchDragEnd"
        @drop="dispatchDrop"
    />

    <!-- Card Outline -->
    <Rectangle
        v-if="gameState.isPlayer"
        ref="cardOutline"
        :key="key + 'cardOutline'"
        :visible="!!getCardOutlineColor"
        :origin="0.5"
        :x="cardAttrs.x"
        :y="cardAttrs.y"
        :width="displaySize.width"
        :height="displaySize.height"
        :rotation="cardAttrs.rotation"
        :lineWidth="CARD_OUTLINE_THICKNESS"
        :strokeColor="getCardOutlineColor"
        :tween="rotationTween"
    />

    <!-- Blood Counter -->
    <template v-if="card.blood > 0 || (card.isMinion() && !isTweening)">
        <!-- Red Circle -->
        <Circle
            ref="bloodCounterCircle"
            :radius="COUNTER_RADIUS"
            :fillColor="BLOOD_COUNTER_FILL_COLOR.color"
            :fillAlpha="1"
            :lineWidth="COUNTER_OUTLINE_THICKNESS"
            :strokeColor="COUNTER_OUTLINE_COLOR.color"
            :origin="0.5"
            :x="overlays.blood.x"
            :y="overlays.blood.y"
            :scale="scale"
        />
        <!-- Number text -->
        <Text
            ref="bloodCounterText"
            :text="card.blood.toString()"
            :style="COUNTER_TEXT_STYLE"
            :origin="0.5"
            :x="overlays.blood.x"
            :y="overlays.blood.y"
            :scale="scale"
        />

        <!-- Hovered change blood -->
        <template v-if="showOverlay">
            <!-- Burn Blood -->
            <ButtonGo
                ref="burnBloodButton"
                name="cardButton"
                :x="overlays.burnBlood.x"
                :y="overlays.burnBlood.y"
                :width="OVERLAY_BUTTON_SIZE"
                :height="OVERLAY_BUTTON_SIZE"
                :scale="scale"
                text="-"
                @pointerover="onPointerOver"
                @pointerout="onPointerOut"
                @click="overlayClick($event, commands.BurnBlood.cardAction)"
            />

            <!-- Gain Blood -->
            <ButtonGo
                ref="gainBloodButton"
                name="cardButton"
                :x="overlays.gainBlood.x"
                :y="overlays.gainBlood.y"
                :width="OVERLAY_BUTTON_SIZE"
                :height="OVERLAY_BUTTON_SIZE"
                :scale="scale"
                text="+"
                @pointerover="onPointerOver"
                @pointerout="onPointerOut"
                @click="overlayClick($event, commands.GainBlood.cardAction)"
            />
        </template>
    </template>

    <!-- Hovered buttons -->
    <template v-if="showOverlay">
        <!-- Ash Heap -->
        <ButtonGo
            v-if="card.isIn.controlled"
            ref="ashHeapButton"
            name="cardButton"
            :x="overlays.ashHeap.x"
            :y="overlays.ashHeap.y"
            :width="OVERLAY_BUTTON_SIZE"
            :height="OVERLAY_BUTTON_SIZE"
            :scale="scale"
            text="🔥"
            @pointerover="onPointerOver"
            @pointerout="onPointerOut"
            @click="overlayClick($event, commands.MoveToAshHeap.cardAction)"
        />

        <!-- Influence -->
        <ButtonGo
            v-if="card.isIn.uncontrolled"
            ref="influenceButton"
            name="cardButton"
            :x="overlays.influence.x"
            :y="overlays.influence.y"
            :width="CARD_WIDTH * CARD_IN_PLAY_BASE_SCALE * 0.95"
            :height="OVERLAY_BUTTON_SIZE"
            :scale="scale"
            text="Influence"
            :textStyle="{ fontSize: '12px' }"
            @pointerover="onPointerOver"
            @pointerout="onPointerOut"
            @click="overlayClick($event, commands.Influence.cardAction)"
        />
    </template>

    <template v-if="card.greenCounter > 0">
        <Circle
            ref="greenCounterCircle"
            :radius="COUNTER_RADIUS"
            :fillColor="GREEN_COUNTER_FILL_COLOR.color"
            :fillAlpha="1"
            :lineWidth="COUNTER_OUTLINE_THICKNESS"
            :strokeColor="COUNTER_OUTLINE_COLOR.color"
            :origin="0.5"
            :x="overlays.greenCounters.x"
            :y="overlays.greenCounters.y"
            :scale="scale"
        />
        <Text
            ref="greenCounterText"
            :text="card.greenCounter.toString()"
            :style="COUNTER_TEXT_STYLE"
            :origin="0.5"
            :x="overlays.greenCounters.x"
            :y="overlays.greenCounters.y"
            :scale="scale"
        />
    </template>

    <template
        v-for="(marker, index) in card.markers"
        :key="`${marker}${index}`"
    >
        <Rectangle
            :ref="el => registerMarkersRectangles(index, el as typeof Rectangle | null)"
            :originX="0.5"
            :originY="0.5"
            :x="markersPosition.x"
            :y="markersPosition.y + (MARKER_HEIGHT + 2) * index + MARKER_MARGIN_TOP"
            :width="MARKER_WIDTH_PER_CHAR * marker.length + MARKER_PADDING"
            :height="MARKER_HEIGHT"
            :fillColor="MARKERS_FILL_COLOR.color"
            :fillAlpha="MARKERS_FILL_COLOR.alphaGL"
            :scale="scale"
        />
        <Text
            :ref="el => registerMarkersTexts(index, el as typeof Text | null)"
            :originX="0.5"
            :originY="0.5"
            :x="markersPosition.x"
            :y="markersPosition.y + (MARKER_HEIGHT + 2) * index + MARKER_MARGIN_TOP"
            :text="marker"
            :style="MARKERS_TEXT_STYLE"
            :scale="scale"
        />
    </template>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'
import Phaser, { GameObjects } from 'phaser'
import { Circle, Image, Rectangle, refObj, Text } from 'phavuer'
import {
    BLOOD_COUNTER_FILL_COLOR,
    CARD_DRAGGING_ALPHA,
    CARD_HEIGHT,
    CARD_IN_PLAY_BASE_SCALE,
    CARD_OUTLINE_THICKNESS,
    CARD_WIDTH,
    COUNTER_HOVER_OFFSET_MULTIPLIER,
    COUNTER_OUTLINE_COLOR,
    COUNTER_OUTLINE_THICKNESS,
    COUNTER_RADIUS,
    COUNTER_TEXT_STYLE,
    GREEN_COUNTER_FILL_COLOR,
    MARKER_HEIGHT,
    MARKER_MARGIN_TOP,
    MARKER_PADDING,
    MARKER_WIDTH_PER_CHAR,
    MARKERS_FILL_COLOR,
    MARKERS_TEXT_STYLE,
    OVERLAY_BUTTON_SIZE,
} from '@/game/const.ts'
import { Card } from '@/model/Card.ts'
import { useGameBusStore } from '@/store/bus.ts'
import { CardAttrs, RegionCategory, PhaserDataKey, CardDragEvent } from '@/game/types.ts'
import { useCardClick } from '@/game/composables/useCardClick.ts'
import { useCardOutline } from '@/game/composables/useCardOutline.ts'
import { getCardScale } from '@/game/utils.ts'
import ButtonGo from '@/game/objects/ButtonGo.vue'
import { useCommands } from '@/game/composables/useCommands.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import Pointer = Phaser.Input.Pointer
import { useCardDragDrop } from '@/game/composables/useCardDragDrop.ts'

const { card, regionName } = defineProps<{
    card: Card
    regionName: string
}>()

const key = computed(() => regionName + card.oid.toString())

const gameState = useGameStateStore()
const gameBus = useGameBusStore()
const commands = useCommands()

const image = refObj<GameObjects.Image>()
const dragPlaceholder = refObj<GameObjects.Image>()
const cardOutline = refObj<GameObjects.Rectangle>()
const bloodCounterCircle = refObj<GameObjects.Arc>()
const bloodCounterText = refObj<GameObjects.Text>()
const greenCounterCircle = refObj<GameObjects.Arc>()
const greenCounterText = refObj<GameObjects.Text>()
const markersRectangles = [] as (GameObjects.Rectangle | null)[]
const markersTexts = [] as (GameObjects.Text | null)[]

const burnBloodButton = ref<typeof ButtonGo>()
const gainBloodButton = ref<typeof ButtonGo>()
const ashHeapButton = ref<typeof ButtonGo>()
const influenceButton = ref<typeof ButtonGo>()

function registerMarkersRectangles(index: number, rectangle: typeof Rectangle | null) {
    markersRectangles[index] = rectangle?.object ?? null
}
function registerMarkersTexts(index: number, text: typeof Text | null) {
    markersTexts[index] = text?.object ?? null
}

const scale = computed(() => card.region.owner.scale)
const cardScale = computed(() => getCardScale(RegionCategory.Table, card.region))

// This is available in image.value.displayWidth and image.value.displayHeight
// but it's not reactive, so we need to recompute it every time the card size changes
const displaySize = computed(() => {
    return {
        width: CARD_WIDTH * (cardScale.value ?? 0),
        height: CARD_HEIGHT * (cardScale.value ?? 0),
    }
})

const cardAttrs = computed((): CardAttrs => {
    const offsetX = card.isLocked ? displaySize.value.height / 2 : displaySize.value.width / 2
    const offsetY = card.isLocked ? displaySize.value.width / 2 : displaySize.value.height / 2

    return {
        category: RegionCategory.Table,
        x: card.x + offsetX,
        y: card.y + offsetY,
        offsetX,
        offsetY,
        rotation: card.isLocked ? Math.PI / 2 : 0,
        scale: cardScale.value,
        container: image.value?.parentContainer,
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
 * Tweens
 */

const ROTATION_TWEEN_DURATION = 150

const isTweening = ref(false)
const rotationTween = ref({})

watch(cardAttrs, (newAttrs, oldAttrs) => {
    if (oldAttrs.rotation !== newAttrs.rotation) {
        isTweening.value = true
        rotationTween.value = {
            props: {
                rotation: { getStart: () => oldAttrs.rotation, getEnd: () => newAttrs.rotation },
                x: { getStart: () => oldAttrs.x, getEnd: () => newAttrs.x },
                y: { getStart: () => oldAttrs.y, getEnd: () => newAttrs.y },
            },
            duration: ROTATION_TWEEN_DURATION,
            onComplete: () => (isTweening.value = false),
        }
    }
})

/**
 * Bring to top
 */

function bringToTop() {
    if (!image.value) {
        return
    }

    const container = image.value.parentContainer
    container.bringToTop(image.value)

    for (const gameObject of [
        greenCounterCircle,
        greenCounterText,
        bloodCounterCircle,
        bloodCounterText,
        cardOutline,
    ]) {
        if (gameObject.value) container.bringToTop(gameObject.value)
    }
    for (const button of [burnBloodButton, gainBloodButton, ashHeapButton, influenceButton]) {
        button.value?.bringToTop()
    }

    markersRectangles.forEach(rectangle => {
        if (rectangle) container.bringToTop(rectangle)
    })
    markersTexts.forEach(text => {
        if (text) container.bringToTop(text)
    })
}

/**
 * Overlay ( counters & buttons )
 */

const showOverlay = computed(() => {
    return (
        isHovered.value &&
        gameBus.selectedCards.length <= 1 &&
        gameState.isPlayer &&
        !isTweening.value
    )
})

function overlayClick(pointer: Pointer, command: (card: Card) => void) {
    if (gameBus.declaringTargetOrigin) {
        onPointerDown(pointer)
    } else {
        command(card)
    }
}

// Positions for overlays
const overlays = computed(() => {
    const counterRadius = (COUNTER_RADIUS + COUNTER_OUTLINE_THICKNESS) * scale.value
    const overOffset = showOverlay.value ? counterRadius * COUNTER_HOVER_OFFSET_MULTIPLIER + 3 : 0
    const baseBloodX = card.x - counterRadius - overOffset
    const changeBloodOffset =
        (COUNTER_RADIUS + COUNTER_OUTLINE_THICKNESS + 1) *
        COUNTER_HOVER_OFFSET_MULTIPLIER *
        scale.value

    let bloodX, bloodY, greenCounterY, ashHeapX, ashHeapY, influenceX, influenceY

    // Unlocked card
    if (!card.isLocked) {
        bloodX = baseBloodX + displaySize.value.width
        bloodY = card.y + counterRadius
        greenCounterY = card.y + displaySize.value.height - counterRadius
        ashHeapX = card.x + displaySize.value.width - counterRadius
        ashHeapY = card.y + displaySize.value.height - counterRadius
        influenceX = card.x + displaySize.value.width / 2
        influenceY = card.y + displaySize.value.height - counterRadius
    }
    // Locked card
    else {
        bloodX = baseBloodX + displaySize.value.height
        bloodY = card.y + displaySize.value.width - counterRadius
        greenCounterY = card.y + counterRadius
        ashHeapX = card.x + counterRadius
        ashHeapY = card.y + displaySize.value.width - counterRadius
        influenceX = card.x + displaySize.value.height / 2
        influenceY = card.y + counterRadius
    }

    return {
        blood: {
            x: bloodX,
            y: bloodY,
        },
        greenCounters: {
            x: card.x + counterRadius,
            y: greenCounterY,
        },
        burnBlood: {
            x: bloodX - changeBloodOffset,
            y: bloodY,
        },
        gainBlood: {
            x: bloodX + changeBloodOffset,
            y: bloodY,
        },
        ashHeap: {
            x: ashHeapX,
            y: ashHeapY,
        },
        influence: {
            x: influenceX,
            y: influenceY,
        },
    }
})

/**
 * Markers position
 */

const markersPosition = computed(() => {
    if (!image.value) {
        return { x: 0, y: 0 }
    }
    if (card.isLocked) {
        return {
            x: cardAttrs.value.x,
            y: cardAttrs.value.y + displaySize.value.width / 2,
        }
    } else {
        return {
            x: cardAttrs.value.x,
            y: cardAttrs.value.y + displaySize.value.height / 2,
        }
    }
})

/**
 * Outline on pointer over / selection area
 */

const {
    isHovered,
    isUnderSelectionArea,
    onPointerOver: outlineOver,
    onPointerOut,
    getCardOutlineColor,
} = useCardOutline(
    toRef(() => card),
    image,
    true,
)

function onPointerOver() {
    outlineOver()
    bringToTop()
}

/**
 * Select/Deselect on simple click
 * Lock on double click
 * Context Menu on right click
 */

const { onPointerDown } = useCardClick(
    toRef(() => card),
    true,
)

/**
 * Dispatch Drag/Drop events to other cards, for group dragging
 */

function dispatchDragEvent(
    eventName: 'onDragStart' | 'onDrag' | 'onDragEnd' | 'onDrop',
    pointer: Pointer,
    dragX?: number,
    dragY?: number,
) {
    const event = {
        originCard: card,
        pointer,
        dragX,
        dragY,
        originDragAttrs: dragAttrs,
    }
    // First compute this card position.
    cardInGame[eventName](event)

    // Then for other cards of the selection,
    // they will position themselves depending on this card.
    for (const cardInGame of gameBus.selectedCardsInGame) {
        if (cardInGame.cardOid === card.oid) {
            continue
        }
        cardInGame[eventName](event)
    }
}

function dispatchDragStart(pointer: Pointer) {
    dispatchDragEvent('onDragStart', pointer)
}

function dispatchDrag(pointer: Pointer, dragX: number, dragY: number) {
    dispatchDragEvent('onDrag', pointer, dragX, dragY)
}

function dispatchDragEnd(pointer: Pointer) {
    dispatchDragEvent('onDragEnd', pointer)
}

function dispatchDrop(pointer: Pointer) {
    dispatchDragEvent('onDrop', pointer)
}

/**
 * Drag'n'Drop
 */

const dragDrop = useCardDragDrop(
    toRef(() => card),
    cardAttrs,
    bringToTop,
)

const dragAttrs = dragDrop.dragAttrs

function onDragStart(event: CardDragEvent) {
    dragDrop.onDragStart(event.originCard)
}

function onDrag(event: CardDragEvent) {
    if (event.dragX && event.dragY) {
        dragDrop.onDrag(event.pointer, event.dragX, event.dragY, event.originDragAttrs)
    }
}

function onDragEnd() {
    dragDrop.onDragEnd()
}

function onDrop() {
    dragDrop.onDrop()
}

// When any players move a card, it must appear on top of the other cards
watch([() => card.x, () => card.y], () => {
    bringToTop()
})

/**
 * World position ( for arrows )
 */

function getWorldPosition() {
    if (!image.value || !image.value.parentContainer) {
        return null
    }

    return image.value.parentContainer
        .getWorldTransformMatrix()
        .transformPoint(cardAttrs.value.x, cardAttrs.value.y)
}

/**
 * Register onto the gameBus
 */

const cardInGame = {
    cardOid: card.oid,
    getWorldPosition,
    bringToTop,
    isUnderSelectionArea,
    onDragStart,
    onDrag,
    onDragEnd,
    onDrop,
}
onMounted(() => {
    gameBus.cardsInGame[card.oid] = cardInGame
})
onBeforeUnmount(() => {
    delete gameBus.cardsInGame[card.oid]
})
</script>
