<template>
    <!-- Drag Placeholder -->
    <Image
        ref="dragPlaceholder"
        :key="key + 'dragPlaceholder'"
        :origin="0.5"
        :x="cardAttrs.x"
        :y="cardAttrs.y"
        :texture="displayedTexture.textureName"
        :frame="displayedTexture.frameName"
        :scale="cardScale"
        :rotation="cardAttrs.rotation"
        :tween="rotationTween"
        :visible="dragAttrs.isDragging"
    />

    <!-- Main Card Image -->
    <Image
        ref="image"
        :key="key + 'image'"
        :origin="0.5"
        :x="
            dragAttrs.isDragging ?
                dragAttrs.x + (cardAttrs.offsetX ?? 0) * dragAttrs.scaleRatio
            :   cardAttrs.x
        "
        :y="
            dragAttrs.isDragging ?
                dragAttrs.y + (cardAttrs.offsetY ?? 0) * dragAttrs.scaleRatio
            :   cardAttrs.y
        "
        :texture="displayedTexture.textureName"
        :frame="displayedTexture.frameName"
        :alpha="dragAttrs.isDragging ? CARD_DRAGGING_ALPHA : 1"
        :scale="dragAttrs.isDragging ? dragAttrs.cardScale : cardAttrs.scale"
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
    >
        <!-- Glow effect for "isDuringCurrentPhase" -->
        <FxGlow
            v-if="showGlowEffect"
            :color="Colors.CARD_GLOW.color"
            :outerStrength="CARD_IN_PLAY_GLOW_OUTER_STRENGTH"
            :innerStrength="CARD_IN_PLAY_GLOW_INNER_STRENGTH"
        />

        <FxPingCard v-if="gameBus.pingedCards.includes(card.oid)" />
    </Image>

    <!-- Card Outline -->
    <Rectangle
        v-if="players.isPlayer"
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
            :key="key + 'bloodCircle'"
            :radius="COUNTER_RADIUS"
            :fillColor="Colors.BLOOD_COUNTER_FILL.color"
            :fillAlpha="1"
            :lineWidth="COUNTER_OUTLINE_THICKNESS"
            :strokeColor="Colors.COUNTER_OUTLINE.color"
            :origin="0.5"
            :x="overlays.blood.x"
            :y="overlays.blood.y"
            :scale="scale"
        />
        <!-- Number text -->
        <Text
            ref="bloodCounterText"
            :key="key + 'bloodText'"
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
                :key="key + 'burnBloodButton'"
                name="burnBloodButton"
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
                :key="key + 'gainBloodButton'"
                name="gainBloodButton"
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
            v-if="card.isIn.controlled && !card.isMinion()"
            ref="ashHeapButton"
            :key="key + 'ashHeapButton'"
            name="ashHeapButton"
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
            v-if="
                card.isIn.uncontrolled && card.isMinion() && card.controller == players.selfPlayer
            "
            ref="influenceButton"
            :key="key + 'influenceButton'"
            name="influenceButton"
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
            :key="key + 'greenCircle'"
            :radius="COUNTER_RADIUS"
            :fillColor="Colors.GREEN_COUNTER_FILL.color"
            :fillAlpha="1"
            :lineWidth="COUNTER_OUTLINE_THICKNESS"
            :strokeColor="Colors.COUNTER_OUTLINE.color"
            :origin="0.5"
            :x="overlays.greenCounters.x"
            :y="overlays.greenCounters.y"
            :scale="scale"
        />
        <Text
            ref="greenCounterText"
            :key="key + 'greenText'"
            :text="card.greenCounter.toString()"
            :style="COUNTER_TEXT_STYLE"
            :origin="0.5"
            :x="overlays.greenCounters.x"
            :y="overlays.greenCounters.y"
            :scale="scale"
        />
    </template>

    <template v-if="card.orangeCounter > 0">
        <Circle
            ref="orangeCounterCircle"
            :key="key + 'orangeCircle'"
            :radius="COUNTER_RADIUS"
            :fillColor="Colors.ORANGE_COUNTER_FILL.color"
            :fillAlpha="1"
            :lineWidth="COUNTER_OUTLINE_THICKNESS"
            :strokeColor="Colors.COUNTER_OUTLINE.color"
            :origin="0.5"
            :x="overlays.orangeCounters.x"
            :y="overlays.orangeCounters.y"
            :scale="scale"
        />
        <Text
            ref="orangeCounterText"
            :key="key + 'orangeText'"
            :text="card.orangeCounter.toString()"
            :style="COUNTER_TEXT_STYLE"
            :origin="0.5"
            :x="overlays.orangeCounters.x"
            :y="overlays.orangeCounters.y"
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
            :fillColor="Colors.MARKERS_FILL.color"
            :fillAlpha="Colors.MARKERS_FILL.alphaGL"
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
import { Circle, FxGlow, Image, Rectangle, refObj, Text } from 'phavuer'
import { Colors } from '@/client/colors.ts'
import {
    CARD_DRAGGING_ALPHA,
    CARD_HEIGHT,
    CARD_IN_PLAY_BASE_SCALE,
    CARD_IN_PLAY_GLOW_INNER_STRENGTH,
    CARD_IN_PLAY_GLOW_OUTER_STRENGTH,
    CARD_OUTLINE_THICKNESS,
    CARD_WIDTH,
    COUNTER_HOVER_OFFSET_MULTIPLIER,
    COUNTER_OUTLINE_THICKNESS,
    COUNTER_RADIUS,
    COUNTER_TEXT_STYLE,
    MARKER_HEIGHT,
    MARKER_MARGIN_TOP,
    MARKER_PADDING,
    MARKER_WIDTH_PER_CHAR,
    MARKERS_TEXT_STYLE,
    OVERLAY_BUTTON_SIZE,
} from '@/shared/const/game.ts'
import { Card } from '@/shared/model/Card.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { CardAttrs, CardDragEvent, PhaserDataKey, RegionCategory } from '@/client/game/types.ts'
import { useCardClick } from '@/client/game/composables/useCardClick.ts'
import { useCardOutline } from '@/client/game/composables/useCardOutline.ts'
import { getCardScale, getOverlappingCards, getRegionScale } from '@/client/game/utils.ts'
import ButtonGo from '@/client/game/objects/ButtonGo.vue'
import { useCommands } from '@/client/game/composables/useCommands.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { useCardDragDrop } from '@/client/game/composables/useCardDragDrop.ts'
import { useCoreStore } from '@/client/store/core.ts'
import FxPingCard from './FxPingCard.vue'
import { useCardTexture } from '@/client/game/composables/useCardTexture.ts'
import Pointer = Phaser.Input.Pointer

const { card, regionName } = defineProps<{
    card: Card
    regionName: string
}>()

const key = computed(() => regionName + card.oid.toString())

const core = useCoreStore()
const gameState = useGameStateStore()
const players = usePlayersStore()
const gameBus = useGameBusStore()
const commands = useCommands()
const { displayedTexture } = useCardTexture(card)

const image = refObj<GameObjects.Image>()
const dragPlaceholder = refObj<GameObjects.Image>()
const cardOutline = refObj<GameObjects.Rectangle>()
const bloodCounterCircle = refObj<GameObjects.Arc>()
const bloodCounterText = refObj<GameObjects.Text>()
const greenCounterCircle = refObj<GameObjects.Arc>()
const greenCounterText = refObj<GameObjects.Text>()
const orangeCounterCircle = refObj<GameObjects.Arc>()
const orangeCounterText = refObj<GameObjects.Text>()
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

const scale = computed(() => getRegionScale(card.region))
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
    }
})

// cardAttrs watcher for non-declarative programming
watch(cardAttrs, (newAttrs, oldAttrs) => {
    if (oldAttrs.rotation !== newAttrs.rotation) {
        startRotationTween(newAttrs, oldAttrs)
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

function startRotationTween(newAttrs: CardAttrs, oldAttrs: CardAttrs) {
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

/**
 * Glow effect on usable card, depending on the phase of the turn.
 */

const glowInPlayEnabled = computed(() => core.userProfile.preferences.glowInPlay ?? true)
const showGlowEffect = computed(
    () => glowInPlayEnabled.value && card.isDuringCurrentPhase() && !dragAttrs.isDragging,
)

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
        orangeCounterCircle,
        orangeCounterText,
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

    // If the player is ousted, the ousted overlay always takes precedence
    const bringOustedToTop = container.getData(PhaserDataKey.BringOustedToTop)
    bringOustedToTop?.()
}

/**
 * Overlay ( counters & buttons )
 */

const showOverlay = computed(() => {
    return (
        isHovered.value &&
        gameBus.selectedCards.length <= 1 &&
        players.isPlayer &&
        !dragAttrs.isDragging &&
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

    let bloodX,
        bloodY,
        greenCounterY,
        orangeCounterX,
        orangeCounterY,
        ashHeapX,
        ashHeapY,
        influenceX,
        influenceY

    // Unlocked card
    if (!card.isLocked) {
        bloodX = baseBloodX + displaySize.value.width
        bloodY = card.y + counterRadius
        greenCounterY = card.y + displaySize.value.height - counterRadius
        orangeCounterX = card.x + displaySize.value.width - counterRadius
        orangeCounterY = card.y + displaySize.value.height - counterRadius
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
        orangeCounterX = card.x + counterRadius
        orangeCounterY = card.y + displaySize.value.width - counterRadius
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
        orangeCounters: {
            x: orangeCounterX,
            y: orangeCounterY,
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
    onPointerOut: outlineOut,
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

function onPointerOut() {
    outlineOut()

    const overlappingCards = getOverlappingCards(card)
    // When not overing, always keep minions on top of other cards
    for (const otherCard of overlappingCards) {
        if (otherCard.isMinion()) {
            gameBus.cardsInGame[otherCard.oid]?.bringToTop()
        }
    }
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

    // Put this card first.
    // For drag, this will compute this card position first,
    // so the other cards can position themselves depending on this card.
    const cardsInGame = [
        cardInGame,
        ...gameBus.selectedCardsInGame.filter(c => c.cardOid !== card.oid),
        ...gameBus.indirectSelectedCardsInGame.filter(c => c.cardOid !== card.oid),
    ]

    // For non-drag events, sort the cards by x/y, depending on the direction of the drag,
    // so a card at an old position won't be shifted by Card.setCoordinates()
    if (eventName != 'onDrag') {
        cardsInGame.sort((c1, c2) => {
            const _dragX = dragAttrs.x - card.x
            const _dragY = dragAttrs.y - card.y

            const card1 = gameState.cards[c1.cardOid]
            const card2 = gameState.cards[c2.cardOid]

            // Compare X positions based on drag direction
            // If dragging right (_dragX > 0), prioritize cards on the right (higher x)
            // If dragging left (_dragX < 0), prioritize cards on the left (lower x)
            const xDelta = (card2.x - card1.x) * (_dragX >= 0 ? 1 : -1)

            // Compare Y positions based on drag direction
            // If dragging down (_dragY > 0), prioritize cards at the bottom (higher y)
            // If dragging up (_dragY < 0), prioritize cards at the top (lower y)
            const yDelta = (card2.y - card1.y) * (_dragY >= 0 ? 1 : -1)

            // Prioritize Y axis first, then X axis
            return yDelta * 10000 + xDelta
        })
    }

    for (const cardInGame of cardsInGame) {
        cardInGame[eventName](event)
        cardInGame.bringToTop()
    }

    // End by a bringToTop the direct recipient of the event,
    // so he's the one entirely visible
    bringToTop()
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

/**
 * Raise the whole source play area above the others for the duration of the drag.
 * The dragged card image stays parented to its source container, and bringToTop()
 * only reorders within a container : it can't lift the card above the drop-highlight
 * Fx of a target region that lives in another (higher) container. Temporarily moving
 * the source container to the top of the scene display list fixes that, and we restore
 * its exact original position on drag end so the natural stacking is preserved.
 */
let raisedContainer: GameObjects.Container | null = null
let raisedContainerIndex = 0

function raiseSourceContainer() {
    const container = image.value?.parentContainer
    const list = container?.displayList
    if (!container || !list) {
        return
    }
    raisedContainer = container
    raisedContainerIndex = list.getIndex(container)
    list.bringToTop(container)
}

function restoreSourceContainer() {
    const list = raisedContainer?.displayList
    if (raisedContainer && list) {
        // Clamp : moveTo() throws on an out-of-bounds index, and the list may have
        // shrunk during the drag (e.g. an arrow or player area was removed).
        const index = Math.min(raisedContainerIndex, list.length - 1)
        list.moveTo(raisedContainer, index)
    }
    raisedContainer = null
}

function onDragStart(event: CardDragEvent) {
    dragDrop.onDragStart(event.originCard)
    // Only the drag initiator raises the container ; group members share it,
    // so a single raise (and a single restore) keeps the display list consistent.
    if (card === event.originCard) {
        raiseSourceContainer()
    }
}

function onDrag(event: CardDragEvent) {
    if (event.dragX && event.dragY) {
        dragDrop.onDrag(event.pointer, event.dragX, event.dragY, event.originDragAttrs)
    }
}

function onDragEnd() {
    dragDrop.onDragEnd()
    restoreSourceContainer()
}

function onDrop() {
    dragDrop.onDrop()
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
