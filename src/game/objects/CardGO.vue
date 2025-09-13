<template>
    <Image
        ref="dragPlaceholder"
        :key="key + 'dragPlaceholder'"
        :x="cardAttrs.x"
        :y="cardAttrs.y"
        :texture="card.displayedTexture.textureName"
        :frame="card.displayedTexture.frameName"
        :scale="cardAttrs.scale"
        :rotation="cardAttrs.rotation"
    />

    <Image
        ref="image"
        :key="key + 'image'"
        :x="dragAttrs.x + offsetX"
        :y="dragAttrs.y + offsetY"
        :texture="card.displayedTexture.textureName"
        :frame="card.displayedTexture.frameName"
        :alpha="dragAttrs.alpha"
        :scale="cardAttrs.scale"
        :rotation="cardAttrs.rotation"
        @create="onImageCreate"
        @pointerover="onPointerOver"
        @pointerout="onPointerOut"
        @pointerdown="onPointerDown"
        @dragstart="dispatchDragStart"
        @drag="dispatchDrag"
        @dragend="dispatchDragEnd"
        @drop="dispatchDrop"
    />

    <Rectangle
        ref="cardOutline"
        :key="key + 'cardOutline'"
        :visible="!!getCardOutlineColor"
        :x="cardAttrs.x"
        :y="cardAttrs.y"
        :width="image ? image.displayWidth : 0"
        :height="image ? image.displayHeight : 0"
        :rotation="cardAttrs.rotation"
        :lineWidth="CARD_OUTLINE_THICKNESS"
        :strokeColor="getCardOutlineColor"
    />

    <template v-if="card.blood > 0">
        <Circle
            ref="bloodCounterCircle"
            :radius="COUNTER_RADIUS"
            :fillColor="BLOOD_COUNTER_FILL_COLOR.color"
            :fillAlpha="1"
            :lineWidth="COUNTER_OUTLINE_THICKNESS"
            :strokeColor="COUNTER_OUTLINE_COLOR.color"
            :origin="0.5"
            :x="bloodCounterPosition.x"
            :y="bloodCounterPosition.y"
        />
        <Text
            ref="bloodCounterText"
            :text="card.blood.toString()"
            :style="COUNTER_TEXT_STYLE"
            :origin="0.5"
            :x="bloodCounterPosition.x"
            :y="bloodCounterPosition.y"
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
            :x="greenCounterPosition.x"
            :y="greenCounterPosition.y"
        />
        <Text
            ref="greenCounterText"
            :text="card.greenCounter.toString()"
            :style="COUNTER_TEXT_STYLE"
            :origin="0.5"
            :x="greenCounterPosition.x"
            :y="greenCounterPosition.y"
        />
    </template>

    <template
        v-for="(marker, index) in card.markers"
        :key="`${marker}${index}`"
    >
        <Rectangle
            :ref="el => registerMarkersRectangles(index, el)"
            :originX="0.5"
            :originY="0.5"
            :x="markersPosition.x"
            :y="markersPosition.y + (MARKER_HEIGHT + 2) * index + MARKER_MARGIN_TOP"
            :width="MARKER_WIDTH_PER_CHAR * marker.length + MARKER_PADDING"
            :height="MARKER_HEIGHT"
            :fillColor="MARKERS_FILL_COLOR.color"
            :fillAlpha="MARKERS_FILL_COLOR.alphaGL"
        />
        <Text
            :ref="el => registerMarkersTexts(index, el)"
            :originX="0.5"
            :originY="0.5"
            :x="markersPosition.x"
            :y="markersPosition.y + (MARKER_HEIGHT + 2) * index + MARKER_MARGIN_TOP"
            :text="marker"
            :style="MARKERS_TEXT_STYLE"
        />
    </template>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, watch } from 'vue'
import Phaser, { GameObjects } from 'phaser'
import { Circle, Image, Rectangle, refObj, Text } from 'phavuer'

import {
    BLOOD_COUNTER_FILL_COLOR,
    CARD_DRAGGING_ALPHA,
    CARD_IN_PLAY_SCALE,
    CARD_OUTLINE_THICKNESS,
    COUNTER_OUTLINE_COLOR,
    COUNTER_OUTLINE_THICKNESS,
    COUNTER_RADIUS,
    COUNTER_TEXT_STYLE,
    GREEN_COUNTER_FILL_COLOR,
    GRID_SIZE,
    MARKER_HEIGHT,
    MARKER_MARGIN_TOP,
    MARKER_PADDING,
    MARKER_WIDTH_PER_CHAR,
    MARKERS_FILL_COLOR,
    MARKERS_TEXT_STYLE,
} from '@/game/const.ts'
import { Card } from '@/model/Card.ts'
import { CardDragEvent, useGameBusStore } from '@/store/bus.ts'
import { gameMutations } from '@/state/gameMutations.ts'
import Vector2Like = Phaser.Types.Math.Vector2Like
import Pointer = Phaser.Input.Pointer
import { CardAttrs, CardCategory, PhaserDataKey } from '@/game/types.ts'
import { AnyCardRegion } from '@/model/CardRegion.ts'
import { RegionName } from '@/model/const.ts'
import { useCardClick } from '@/game/composables/useCardClick.ts'
import { useCardOutline } from '@/game/composables/useCardOutline.ts'
import { Validity } from '@/state/types.ts'
import { dropCoordinatesSnapped } from '@/game/utils.ts'

const { card, regionName } = defineProps<{
    card: Card
    regionName: string
}>()

const key = computed(() => regionName + card.oid.toString())

const gameBus = useGameBusStore()
const image = refObj<GameObjects.Image>()
const dragPlaceholder = refObj<GameObjects.Image>()
const cardOutline = refObj<GameObjects.Rectangle>()
const bloodCounterCircle = refObj<GameObjects.Arc>()
const bloodCounterText = refObj<GameObjects.Text>()
const greenCounterCircle = refObj<GameObjects.Arc>()
const greenCounterText = refObj<GameObjects.Text>()
const markersRectangles = [] as (GameObjects.Rectangle | null)[]
const markersTexts = [] as (GameObjects.Text | null)[]

function registerMarkersRectangles(index: number, rectangle: typeof Rectangle | null) {
    markersRectangles[index] = rectangle?.object ?? null
}
function registerMarkersTexts(index: number, text: typeof Text | null) {
    markersTexts[index] = text?.object ?? null
}

const offsetX = computed(() =>
    image.value ?
        card.isLocked ?
            image.value.displayHeight / 2
        :   image.value.displayWidth / 2
    :   0,
)
const offsetY = computed(() =>
    image.value ?
        card.isLocked ?
            image.value.displayWidth / 2
        :   image.value.displayHeight / 2
    :   0,
)

const cardAttrs = computed((): CardAttrs => {
    return {
        category: CardCategory.CardOnTable,
        x: card.x + offsetX.value,
        y: card.y + offsetY.value,
        rotation: card.isLocked ? Math.PI / 2 : 0,
        scale: CARD_IN_PLAY_SCALE,
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
 * Counters position
 */

const bloodCounterPosition = computed(() => {
    if (!image.value) {
        return { x: 0, y: 0 }
    }
    if (card.isLocked) {
        return {
            x: card.x + image.value.displayHeight - COUNTER_RADIUS - COUNTER_OUTLINE_THICKNESS,
            y: card.y + image.value.displayWidth - COUNTER_RADIUS - COUNTER_OUTLINE_THICKNESS,
        }
    } else {
        return {
            x: card.x + image.value.displayWidth - COUNTER_RADIUS - COUNTER_OUTLINE_THICKNESS,
            y: card.y + COUNTER_RADIUS + COUNTER_OUTLINE_THICKNESS,
        }
    }
})

const greenCounterPosition = computed(() => {
    if (!image.value) {
        return { x: 0, y: 0 }
    }
    if (card.isLocked) {
        return {
            x: card.x + image.value.displayHeight - COUNTER_RADIUS - COUNTER_OUTLINE_THICKNESS,
            y: card.y + COUNTER_RADIUS + COUNTER_OUTLINE_THICKNESS,
        }
    } else {
        return {
            x: card.x + COUNTER_RADIUS - COUNTER_OUTLINE_THICKNESS + 2,
            y: card.y + COUNTER_RADIUS + COUNTER_OUTLINE_THICKNESS,
        }
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
            y: cardAttrs.value.y + image.value.displayWidth / 2,
        }
    } else {
        return {
            x: cardAttrs.value.x,
            y: cardAttrs.value.y + image.value.displayHeight / 2,
        }
    }
})

/**
 * Outline on pointer over / selection area
 */

const { isUnderSelectionArea, onPointerOver, onPointerOut, getCardOutlineColor } = useCardOutline(
    card,
    image,
    true,
)

/**
 * Select/Deselect on simple click
 * Lock on double click
 * Context Menu on right click
 */

const { onPointerDown } = useCardClick(card, true)

/**
 * Dispatch Drag/Drop events to other cards, for group dragging
 */

function dispatchDragEvent(
    eventName: 'onDragStart' | 'onDrag' | 'onDragEnd' | 'onDrop',
    pointer: Pointer,
    dragX?: number,
    dragY?: number,
    droppedOn?: GameObjects.Rectangle,
) {
    const event = {
        originCard: card,
        pointer,
        dragX,
        dragY,
        droppedOn,
    }
    for (const handleableCard of gameBus.selectedHandleableCards) {
        handleableCard[eventName](event)
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

function dispatchDrop(pointer: Pointer, droppedOn: GameObjects.Rectangle) {
    dispatchDragEvent('onDrop', pointer, 0, 0, droppedOn)
}

/**
 * Dragging
 */

// Track if the card were dropped into a drop zone
let droppedAfterDrag = false

const dragAttrs = reactive({
    x: card.x, // X position of the drag cursor
    y: card.y, // Y position of the drag cursor
    alpha: 1,
    deltaX: 0, // X distance from the dragged card origin
    deltaY: 0, // Y distance from the dragged card origin
})
// Redraw the Card GameObject when the position in Card's state is updated
watch([() => card.x, () => card.y], ([x, y]) => {
    dragAttrs.x = x
    dragAttrs.y = y

    // When any players move a card, it must appear on top of the other cards
    bringCardToTop()
})

function bringCardToTop() {
    if (!image.value) {
        return
    }

    const container = image.value.parentContainer
    container.bringToTop(image.value)

    if (greenCounterCircle.value) container.bringToTop(greenCounterCircle.value)
    if (greenCounterText.value) container.bringToTop(greenCounterText.value)
    if (bloodCounterCircle.value) container.bringToTop(bloodCounterCircle.value)
    if (bloodCounterText.value) container.bringToTop(bloodCounterText.value)
    if (cardOutline.value) container.bringToTop(cardOutline.value)

    markersRectangles.forEach(rectangle => {
        if (rectangle) container.bringToTop(rectangle)
    })
    markersTexts.forEach(text => {
        if (text) container.bringToTop(text)
    })
}

function onDragStart(event: CardDragEvent) {
    // This may happen when moving region,
    // on the old CardGo component that is about to be unmounted
    if (!image.value) {
        return
    }

    droppedAfterDrag = false

    // The dragged card must be on top of the other cards
    bringCardToTop()

    dragAttrs.alpha = CARD_DRAGGING_ALPHA
    dragAttrs.deltaX = card.x - event.originCard.x
    dragAttrs.deltaY = card.y - event.originCard.y
}

function onDrag(event: CardDragEvent) {
    // This may happen when moving region,
    // on the old CardGo component that is about to be unmounted
    if (!image.value || !event.dragX || !event.dragY) {
        return
    }

    dragAttrs.x = Phaser.Math.Snap.To(
        event.dragX + dragAttrs.deltaX - image.value.displayWidth / 2,
        GRID_SIZE,
    )
    dragAttrs.y = Phaser.Math.Snap.To(
        event.dragY + dragAttrs.deltaY - image.value.displayHeight / 2,
        GRID_SIZE,
    )
}

function onDragEnd() {
    dragAttrs.alpha = 1
    dragAttrs.deltaX = 0
    dragAttrs.deltaY = 0

    // We didn't dropped in a zone, get back to the initial position
    if (!droppedAfterDrag) {
        dragAttrs.x = card.x
        dragAttrs.y = card.y
    }
}

/**
 * Drop on new position
 */

function onDrop(event: CardDragEvent) {
    // This may happen when moving region,
    // on the old CardGo component that is about to be unmounted
    if (!image.value || !event.droppedOn) {
        return
    }

    const targetCardRegion = event.droppedOn.getData(PhaserDataKey.CardRegion) as AnyCardRegion

    // Not dropped on a card region
    if (!targetCardRegion) {
        return
    }

    let validity: Validity
    // Move inside the same region, just update card position
    if (targetCardRegion.oid == card.region.oid) {
        validity = gameMutations.moveCard.actSelf({
            card,
            x: dragAttrs.x,
            y: dragAttrs.y,
        })
    }
    // Move to hand
    else if (targetCardRegion.name == RegionName.Hand) {
        validity = gameMutations.moveCardToRegion.actSelf({
            card,
            fromCardRegion: card.region,
            toCardRegion: targetCardRegion,
            position: gameBus.handDropGapPosition ?? 0,
        })
    }
    // Move to another region
    else {
        let coord: Vector2Like = { x: dragAttrs.x, y: dragAttrs.y }

        const fromContainer = image.value.parentContainer
        const toContainer = event.droppedOn.parentContainer

        // If the card change of container, recompute its position to the new referential
        if (fromContainer != toContainer) {
            // Compute new card position in the target container referential
            coord = dropCoordinatesSnapped(event.pointer, toContainer)
            // Adjust position for dragging delta
            coord.x += dragAttrs.deltaX
            coord.y += dragAttrs.deltaY
        }

        validity = gameMutations.moveCardToRegion.actSelf({
            card,
            fromCardRegion: card.region,
            toCardRegion: targetCardRegion,
            x: coord.x,
            y: coord.y,
        })
    }

    // If the action is valid, the drop is confirmed.
    // Else, the card will go back to its initial position
    droppedAfterDrag = validity.isValid
}

/**
 * Register onto the gameBus
 */

const selectableCard = {
    card,
    isUnderSelectionArea,
    onDragStart,
    onDrag,
    onDragEnd,
    onDrop,
}
onMounted(() => {
    gameBus.handleableCards.push(selectableCard)
})
onBeforeUnmount(() => {
    const index = gameBus.handleableCards.indexOf(selectableCard)
    if (index != -1) {
        gameBus.handleableCards.splice(index, 1)
    }
})
</script>
