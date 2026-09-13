<template>
    <WieldCardStackActions
        :cardRegion="cardRegion"
        :actionsStyle="actionsStyle"
    />

    <Rectangle
        ref="overlay"
        key="overlay"
        :origin="0"
        :x="-5000"
        :y="-5000"
        :width="10000"
        :height="10000"
        :fillAlpha="0"
        @pointerdown="onOverlayPointerDown"
    />

    <Rectangle
        key="window"
        :depth="1"
        :origin="0"
        :x="WIELD_X"
        :y="WIELD_Y"
        :width="width"
        :height="height"
        :lineWidth="2"
        :strokeColor="Colors.WIELD_BORDER.color"
        :fillColor="Colors.WIELD_BACKGROUND.color"
    />

    <Container
        key="cardsPanel"
        :depth="2"
        :x="WIELD_X"
        :y="WIELD_Y"
        @create="onCardsPanelCreate"
        @wheel="onWheel"
    >
        <!-- Top Indicator -->
        <Rectangle
            key="topIndicator"
            :origin="0"
            :x="WIELD_X"
            :y="0"
            :width="WIELD_INDICATOR_WIDTH"
            :height="cardsPanelHeight - (hasScroll ? WIELD_SCROLLBAR_HEIGHT : 0)"
            :fillColor="Colors.WIELD_BORDER.color"
            :fillAlpha="0.8"
        />
        <Text
            key="topIndicatorText"
            text="T o p"
            :style="INDICATOR_TEXT_STYLE"
            :originY="0.5"
            :originX="0.25"
            :x="WIELD_X + WIELD_INDICATOR_WIDTH / 2"
            :y="cardsPanelHeight / 2"
        />

        <!-- Cards -->
        <template
            v-for="(card, index) in cards"
            :key="index + cardRegion.name + card.oid"
        >
            <CardInWieldCardStack
                :card="card"
                :cardRegion="cardRegion"
                :displayIndex="index"
                @wheel="onWheel"
            />
        </template>

        <!-- Bottom Indicator -->
        <Rectangle
            key="bottomIndicator"
            :origin="0"
            :x="
                WIELD_X +
                cards.length * WIELD_CARD_DISPLAY_WIDTH +
                WIELD_CARDS_OFFSET +
                WIELD_INDICATOR_WIDTH
            "
            :y="0"
            :width="WIELD_INDICATOR_WIDTH"
            :height="cardsPanelHeight - (hasScroll ? WIELD_SCROLLBAR_HEIGHT : 0)"
            :fillColor="Colors.WIELD_BORDER.color"
            :fillAlpha="0.8"
        />
        <Text
            key="bottomIndicatorText"
            text="B o t t o m"
            :style="INDICATOR_TEXT_STYLE"
            :originY="0.5"
            :originX="0.25"
            :x="
                WIELD_X +
                cards.length * WIELD_CARD_DISPLAY_WIDTH +
                WIELD_CARDS_OFFSET +
                WIELD_INDICATOR_WIDTH / 2 +
                WIELD_INDICATOR_WIDTH
            "
            :y="cardsPanelHeight / 2"
        />
    </Container>

    <Rectangle
        v-if="cards.length > 8"
        key="scrollbar"
        :depth="3"
        :origin="0"
        :x="scrollbarX"
        :y="scrollbarY"
        :width="scrollbarWidth"
        :height="WIELD_SCROLLBAR_HEIGHT"
        :fillColor="Colors.WIELD_SCROLLBAR.color"
        :fillAlpha="WIELD_SCROLLBAR_ALPHA"
        @pointerdown="onScrollbarPointerDown"
        @wheel="onWheel"
    />
</template>

<script setup lang="ts">
import { Colors } from '@/client/colors.ts'
import {
    WIELD_ACTIONS_WIDTH,
    WIELD_CARD_DISPLAY_WIDTH,
    WIELD_CARD_STACK_HEIGHT,
    WIELD_CARDS_OFFSET,
    WIELD_INDICATOR_WIDTH,
    WIELD_SCROLLBAR_ALPHA,
    WIELD_SCROLLBAR_HEIGHT,
    WIELD_X,
    WIELD_Y,
    WORLD_HEIGHT,
    WORLD_WIDTH,
} from '@/shared/const/game.ts'
import { Container, Rectangle, refObj, Text, useScene } from 'phavuer'
import { useGameBusStore } from '@/client/store/bus.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import CardInWieldCardStack from '@/client/game/objects/CardInWieldCardStack.vue'
import Phaser, { GameObjects } from 'phaser'
import WieldCardStackActions from '@/client/ui/ingame/WieldCardStackActions.vue'
import { display, layout } from '@/client/game/display.ts'
import { getFreeTableUICamera } from '@/client/game/camera.ts'
import { WorldAlignment } from '@/client/gateway/db.ts'
import { AnyCardRegion } from '@/shared/types/model.ts'
import { selfSecureName } from '@/client/state/self.ts'
import { useUIFeatures } from '@/client/game/composables/useUIFeatures.ts'
import { dropCoordinates, getWorldPoint } from '@/client/game/utils.ts'
import { PhaserDataKey, RegionCategory } from '@/client/game/types.ts'
import EventData = Phaser.Types.Input.EventData
import Pointer = Phaser.Input.Pointer

const { cardRegion } = defineProps<{
    cardRegion: AnyCardRegion
}>()

const gameBus = useGameBusStore()
const gameState = useGameStateStore()
const scene = useScene()
const { worldAlignment } = useUIFeatures()

const overlay = refObj<GameObjects.Rectangle>()

// Free Table : this panel's "world" coordinates are raw screen pixels ( see
// getFreeTableUICamera ), unlike standard mode's fixed-size WORLD_WIDTH world -
// size it against the actual screen width instead.
const width = (gameState.isFreeTable ? display.actualWidth : WORLD_WIDTH) - WIELD_X * 2
const height = WIELD_CARD_STACK_HEIGHT

const wieldsActionsWidth = WIELD_ACTIONS_WIDTH + 4
const wieldsActionsHeight = WIELD_CARD_STACK_HEIGHT

const cardsPanelWidth = width - wieldsActionsWidth
const cardsPanelHeight = height

const INDICATOR_TEXT_STYLE = {
    color: 'white',
    fontStyle: 'bold',
    fontSize: '14px',
    wordWrap: { width: 1 },
}

/** Wield Actions positioning */

const actionsStyle = computed(() => {
    const rightBase = gameBus.focusMode ? 0 : layout.rightColumnWidth

    // Free Table : the Phaser card panel reserves wieldsActionsWidth raw
    // pixels ( no display.scale zoom, see getFreeTableUICamera ) for this DOM
    // panel on its right - match that exactly or cards show through the gap.
    if (gameState.isFreeTable) {
        return {
            width: `${wieldsActionsWidth}px`,
            height: `${wieldsActionsHeight}px`,
            top: '0px',
            right: `${rightBase}px`,
        }
    }

    let right, top
    if (worldAlignment.value == WorldAlignment.TopRight) {
        right = rightBase + display.horizontalPadding * display.scale
        top = 0
    } else {
        right = rightBase + display.horizontalSpaceAvailable / 2
        top = display.verticalSpaceAvailable / 2
    }

    return {
        width: `${wieldsActionsWidth}px`,
        height: `${wieldsActionsHeight}px`,
        top: `${top}px`,
        right: `${right}px`,
        transform: `scale(${display.scale})`,
    }
})

/** Do some reset when the panel is opened */

onMounted(() => {
    // Reset search string
    gameBus.wieldCardStack.searchString = ''
    // Reset selected cards
    gameBus.selectedCards = []
})

/**
 * Get cards, optionally filtered by the search term
 */

const cards = computed(() => {
    let cards = cardRegion.cards
    if (gameBus.wieldCardStack.searchString) {
        cards = cards.filter(card =>
            selfSecureName(card)
                .toLowerCase()
                .includes(gameBus.wieldCardStack.searchString.toLowerCase()),
        )
    }
    return cards
})
watch(cards, updateScrollbar)

/**
 * Setup wheel scrolling
 */

let cardsPanel: GameObjects.Container
let isDraggingScrollbar = false
let dragScrollbarStartX = 0
let initialScrollbarX = 0
const scrollbarX = ref(0)
const scrollbarY = WIELD_Y + cardsPanelHeight - WIELD_SCROLLBAR_HEIGHT
const scrollbarWidth = ref(0)

const totalCardsWidth = computed(() => {
    return (
        cards.value.length * WIELD_CARD_DISPLAY_WIDTH +
        WIELD_CARDS_OFFSET +
        WIELD_INDICATOR_WIDTH * 2
    )
})

const hasScroll = computed(() => {
    return totalCardsWidth.value > cardsPanelWidth
})

function updateScrollbar() {
    if (!hasScroll.value) {
        // Reset position when no scrolling is needed
        cardsPanel.x = 0
        return
    }

    const contentRatio = cardsPanelWidth / totalCardsWidth.value
    scrollbarWidth.value = Math.max(30, cardsPanelWidth * contentRatio)
    const scrollProgress = -cardsPanel.x / (totalCardsWidth.value - cardsPanelWidth)
    scrollbarX.value = WIELD_X + (cardsPanelWidth - scrollbarWidth.value) * scrollProgress
}

function onCardsPanelCreate(cardsPanel_: GameObjects.Container) {
    cardsPanel = cardsPanel_

    cardsPanel.setData(PhaserDataKey.CardRegionOid, cardRegion.oid)
    cardsPanel.setData(PhaserDataKey.RegionCategory, RegionCategory.WieldCardStack)

    // Set Interactive to listen to drop and wheel events
    cardsPanel.setInteractive({
        // wider hit area for easier grabbing
        hitArea: new Phaser.Geom.Rectangle(
            WIELD_X,
            WIELD_Y,
            100 * WIELD_CARD_DISPLAY_WIDTH, // Scroll up to 100 cards, should be enough
            cardsPanelHeight,
        ),
        hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        dropZone: true,
    })

    // Add a mask to hide cards overflowing from the cards panel
    const graphics = scene.make.graphics()
    graphics.fillRect(WIELD_X, WIELD_Y, cardsPanelWidth, cardsPanelHeight)
    graphics.fillRect(
        WIELD_X,
        cardsPanelHeight,
        width,
        gameState.isFreeTable ? display.actualHeight : WORLD_HEIGHT,
    )
    const mask = new Phaser.Display.Masks.GeometryMask(scene, graphics)
    cardsPanel.setMask(mask)

    cardsPanel.x = 0
    // Create scrollbar
    updateScrollbar()

    /**
     * Handle reordering for cards in the wield card stack
     */
    const stackBounds = new Phaser.Geom.Rectangle(WIELD_X, WIELD_Y, width, height)
    // Free Table : this panel lives in the pinned Container, rendered through
    // the UI camera, not the main one - pointer <-> world conversions must go
    // through that same camera, or they resolve against the wrong ( panned/
    // zoomed ) view. See camera.ts's getFreeTableUICamera().
    const stackCamera = gameState.isFreeTable ? getFreeTableUICamera() : undefined

    scene.input.on(Phaser.Input.Events.DRAG_START, onStackDragStart)
    scene.input.on(Phaser.Input.Events.DRAG, onStackDrag)
    scene.input.on(Phaser.Input.Events.DRAG_END, onStackDragEnd)

    function onStackDragStart() {
        gameBus.stackDropGapPosition = null
        // The full-screen dismiss backdrop, left hit-testable, would shadow
        // the table's drop zone during a drag ( hitTestPointer stops at the
        // first camera with any hit, see input.ts ) - disable it for the drag.
        if (overlay.value?.input) {
            overlay.value.input.enabled = false
        }
    }

    function onStackDrag(pointer: Pointer) {
        gameBus.stackDropGapPosition = null
        // Only compute gap when dragging from within this stack and no search filter
        if (gameBus.draggedStackCardPosition === null || gameBus.wieldCardStack.searchString) {
            return
        }
        // Reorder only when the pointer is within the wield stack window
        const worldPoint = getWorldPoint(pointer.x, pointer.y, stackCamera)
        if (!stackBounds.contains(worldPoint.x, worldPoint.y)) {
            return
        }
        const coord = dropCoordinates(pointer, cardsPanel, undefined, false, false, stackCamera)
        gameBus.stackDropGapPosition = 0
        for (let i = 0; i < cardRegion.cards.length; i++) {
            const cardX =
                WIELD_X + i * WIELD_CARD_DISPLAY_WIDTH + WIELD_CARDS_OFFSET + WIELD_INDICATOR_WIDTH
            if (cardX < coord.x) {
                gameBus.stackDropGapPosition = i
            }
        }
    }

    function onStackDragEnd() {
        gameBus.stackDropGapPosition = null
        if (overlay.value?.input) {
            overlay.value.input.enabled = true
        }
    }

    onUnmounted(() => {
        scene.input.off(Phaser.Input.Events.DRAG_START, onStackDragStart)
        scene.input.off(Phaser.Input.Events.DRAG, onStackDrag)
        scene.input.off(Phaser.Input.Events.DRAG_END, onStackDragEnd)
    })
}

function onScrollbarPointerDown(pointer: Phaser.Input.Pointer, {}, {}, event: EventData) {
    event.stopPropagation()

    isDraggingScrollbar = true
    dragScrollbarStartX = pointer.x / display.scale
    // Calculate the offset relative to the scrollbar's current position, not the container
    initialScrollbarX = scrollbarX.value - WIELD_X

    scene.input.on('pointermove', onScrollbarPointerMove)
    scene.input.on('pointerup', onScrollbarPointerUp)
}

function onScrollbarPointerMove(pointer: Phaser.Input.Pointer) {
    if (!isDraggingScrollbar) {
        return
    }

    const deltaX = pointer.x / display.scale - dragScrollbarStartX
    const scrollProgress = Phaser.Math.Clamp(
        (initialScrollbarX + deltaX) / (cardsPanelWidth - scrollbarWidth.value),
        0,
        1,
    )

    cardsPanel.x = -scrollProgress * (totalCardsWidth.value - cardsPanelWidth)
    updateScrollbar()
}

function onScrollbarPointerUp({}) {
    isDraggingScrollbar = false

    // Remove the scene listeners
    scene.input.off('pointermove', onScrollbarPointerMove)
    scene.input.off('pointerup', onScrollbarPointerUp)
}

function onWheel({}, {}, deltaX: number, {}, event: EventData) {
    // Stop the wheel event here so it doesn't also reach the Free Table
    // camera's scene-level 'wheel' listener ( see setupCameraControls() in
    // camera.ts ), which would otherwise zoom the table underneath the panel.
    // Done unconditionally - even when the stack is too short to scroll - so
    // scrolling anywhere over the browser never zooms the table.
    event.stopPropagation()

    if (totalCardsWidth.value < cardsPanelWidth) {
        return
    }

    cardsPanel.x -= deltaX * 0.5
    cardsPanel.x = Phaser.Math.Clamp(cardsPanel.x, -totalCardsWidth.value + cardsPanelWidth, 0)
    updateScrollbar()
}

/**
 * Hide wieldCardStack when clicking outside of it
 */
function onOverlayPointerDown() {
    gameBus.wieldCardStack.show = false
    gameBus.wieldCardStack.cardRegion = null
    gameBus.wieldCardStack.searchString = ''
}
</script>
