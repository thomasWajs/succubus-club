<template>
    <!-- Drag Placeholder -->
    <Image
        ref="dragPlaceholder"
        :key="key + 'dragPlaceholder'"
        :x="cardAttrs.x"
        :y="cardAttrs.y"
        :texture="card.displayedTexture.textureName"
        :frame="card.displayedTexture.frameName"
        :scale="cardScale"
        :rotation="cardAttrs.rotation"
    />

    <!-- Main Card Image -->
    <Image
        ref="image"
        :key="key + 'image'"
        :x="dragAttrs.x + offsetX"
        :y="dragAttrs.y + offsetY"
        :texture="card.displayedTexture.textureName"
        :frame="card.displayedTexture.frameName"
        :alpha="dragAttrs.alpha"
        :scale="cardScale"
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

    <!-- Card Outline -->
    <Rectangle
        v-if="gameState.isPlayer"
        ref="cardOutline"
        :key="key + 'cardOutline'"
        :visible="!!getCardOutlineColor"
        :x="cardAttrs.x"
        :y="cardAttrs.y"
        :width="displaySize.width"
        :height="displaySize.height"
        :rotation="cardAttrs.rotation"
        :lineWidth="CARD_OUTLINE_THICKNESS"
        :strokeColor="getCardOutlineColor"
    />

    <!-- Blood Counter -->
    <template v-if="card.blood > 0 || card.isMinion()">
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
                :width="overlayButtonSize"
                :height="overlayButtonSize"
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
                :width="overlayButtonSize"
                :height="overlayButtonSize"
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
            :width="overlayButtonSize"
            :height="overlayButtonSize"
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
            :height="overlayButtonSize"
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
            :scale="cardScale"
        />
        <Text
            :ref="el => registerMarkersTexts(index, el as typeof Text | null)"
            :originX="0.5"
            :originY="0.5"
            :x="markersPosition.x"
            :y="markersPosition.y + (MARKER_HEIGHT + 2) * index + MARKER_MARGIN_TOP"
            :text="marker"
            :style="MARKERS_TEXT_STYLE"
            :scale="cardScale"
        />
    </template>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount, onMounted, reactive, watch, toRef } from 'vue'
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
import { RegionName } from '@/model/const.ts'
import { useCardClick } from '@/game/composables/useCardClick.ts'
import { useCardOutline } from '@/game/composables/useCardOutline.ts'
import { Validity } from '@/state/types.ts'
import { dropCoordinatesSnapped, getDropCardRegion } from '@/game/utils.ts'
import ButtonGo from '@/game/objects/ButtonGo.vue'
import { useCommands } from '@/game/composables/useCommands.ts'
import { useGameStateStore } from '@/store/gameState.ts'

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
const cardScale = computed(() => CARD_IN_PLAY_BASE_SCALE * scale.value)

const offsetX = computed(() =>
    card.isLocked ? displaySize.value.height / 2 : displaySize.value.width / 2,
)
const offsetY = computed(() =>
    card.isLocked ? displaySize.value.width / 2 : displaySize.value.height / 2,
)

const cardAttrs = computed((): CardAttrs => {
    return {
        category: CardCategory.CardOnTable,
        x: card.x + offsetX.value,
        y: card.y + offsetY.value,
        rotation: card.isLocked ? Math.PI / 2 : 0,
        scale: cardScale.value,
    }
})

// This is available in image.value.displayWidth and image.value.displayHeight
// but it's not reactive, so we need to recompute it every time the card size changes
const displaySize = computed(() => {
    return {
        width: CARD_WIDTH * (cardScale.value ?? 0),
        height: CARD_HEIGHT * (cardScale.value ?? 0),
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
 * Positions for overlays ( counters & buttons )
 */

const overlayButtonSize = COUNTER_RADIUS * COUNTER_HOVER_OFFSET_MULTIPLIER

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
    bringCardToTop()
}

/**
 * Overlay
 */

function overlayClick(pointer: Pointer, command: (card: Card) => void) {
    if (gameBus.declaringTargetOrigin) {
        onPointerDown(pointer)
    } else {
        command(card)
    }
}

const showOverlay = computed(() => {
    return isHovered.value && gameBus.selectedCards.length <= 1 && gameState.isPlayer
})

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
    droppedOn?: GameObjects.Rectangle,
) {
    const event = {
        originCard: card,
        pointer,
        dragX,
        dragY,
        droppedOn,
    }
    for (const cardInGame of gameBus.selectedCardsInGame) {
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

function onDragStart(event: CardDragEvent) {
    // This may happen when moving region,
    // on the old CardGo component that is about to be unmounted
    if (!image.value) {
        return
    }
    // Spectators can't interact with the game
    if (gameState.isSpectator) {
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
    // Spectators can't interact with the game
    if (gameState.isSpectator) {
        return
    }

    dragAttrs.x = Phaser.Math.Snap.To(event.dragX + dragAttrs.deltaX - offsetX.value, GRID_SIZE)
    dragAttrs.y =
        Phaser.Math.Snap.Ceil(event.dragY + dragAttrs.deltaY - offsetY.value, GRID_SIZE) -
        GRID_SIZE / 2
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

    const targetCardRegion = getDropCardRegion(event.droppedOn)
    // Not dropped on any region, abort
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
    bringToTop: bringCardToTop,
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
