<template>
    <WieldCardStackActions
        :cardRegion="cardRegion"
        :actionsStyle="actionsStyle"
    />

    <Rectangle
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
    RIGHT_COLUMN_WIDTH,
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
import { Container, Rectangle, Text, useScene } from 'phavuer'
import { useGameBusStore } from '@/client/store/bus.ts'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import CardInWieldCardStack from '@/client/game/objects/CardInWieldCardStack.vue'
import Phaser, { GameObjects } from 'phaser'
import WieldCardStackActions from '@/client/ui/ingame/WieldCardStackActions.vue'
import { display } from '@/client/game/display.ts'
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
const scene = useScene()
const { worldAlignment } = useUIFeatures()

const width = WORLD_WIDTH - WIELD_X * 2
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
    let right, top
    if (worldAlignment.value == WorldAlignment.TopRight) {
        right = RIGHT_COLUMN_WIDTH + display.horizontalPadding * display.scale
        top = 0
    } else {
        right = RIGHT_COLUMN_WIDTH + display.horizontalSpaceAvailable / 2
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
    cardsPanel.setData(PhaserDataKey.RegionCategory, RegionCategory.Stack)

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
    graphics.fillStyle(0x000000)
    graphics.fillRect(WIELD_X, WIELD_Y, cardsPanelWidth, cardsPanelHeight)
    graphics.fillRect(WIELD_X, cardsPanelHeight, width, WORLD_HEIGHT)
    cardsPanel.enableFilters()
    cardsPanel.filters?.external.addMask(graphics)

    cardsPanel.x = 0
    // Create scrollbar
    updateScrollbar()

    /**
     * Handle reordering for cards in the wield card stack
     */
    const stackBounds = new Phaser.Geom.Rectangle(WIELD_X, WIELD_Y, width, height)

    scene.input.on(Phaser.Input.Events.DRAG_START, onStackDragStart)
    scene.input.on(Phaser.Input.Events.DRAG, onStackDrag)
    scene.input.on(Phaser.Input.Events.DRAG_END, onStackDragEnd)

    function onStackDragStart() {
        gameBus.stackDropGapPosition = null
    }

    function onStackDrag(pointer: Pointer) {
        gameBus.stackDropGapPosition = null
        // Only compute gap when dragging from within this stack and no search filter
        if (gameBus.draggedStackCardPosition === null || gameBus.wieldCardStack.searchString) {
            return
        }
        // Reorder only when the pointer is within the wield stack window
        const worldPoint = getWorldPoint(pointer.x, pointer.y)
        if (!stackBounds.contains(worldPoint.x, worldPoint.y)) {
            return
        }
        const coord = dropCoordinates(pointer, cardsPanel)
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

function onWheel({}, {}, deltaX: number, {}, {}) {
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
