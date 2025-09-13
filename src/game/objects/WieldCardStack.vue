<template>
    <WieldCardStackActions
        :cardRegion="cardRegion"
        :actionsStyle="actionsStyle"
    />

    <Rectangle
        key="overlay"
        :origin="0"
        :x="0"
        :y="0"
        :width="WORLD_WIDTH"
        :height="WORLD_HEIGHT"
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
        :strokeColor="WIELD_BORDER_COLOR.color"
        :fillColor="WIELD_BACKGROUND_COLOR.color"
        :dropZone="true"
    />

    <Container
        key="cardsPanel"
        :depth="2"
        :x="WIELD_X"
        :y="WIELD_Y"
        @create="onCardsPanelCreate"
        @wheel="onWheel"
    >
        <template
            v-for="(card, index) in cards"
            :key="index + cardRegion.name + card.oid"
        >
            <CardInWieldCardStack
                :card="card"
                :x="index * CARD_DISPLAY_WIDTH + CARDS_OFFSET"
                :y="10"
                @wheel="onWheel"
            />
        </template>
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
        :fillColor="WIELD_SCROLLBAR_COLOR.color"
        :fillAlpha="WIELD_SCROLLBAR_ALPHA"
        @pointerdown="onScrollbarPointerDown"
        @wheel="onWheel"
    />
</template>

<script setup lang="ts">
import {
    CARD_WIDTH,
    WIELD_SCROLLBAR_ALPHA,
    WIELD_SCROLLBAR_COLOR,
    WIELD_SCROLLBAR_HEIGHT,
    WIELD_ACTIONS_WIDTH,
    WIELD_BACKGROUND_COLOR,
    WIELD_BORDER_COLOR,
    WIELD_CARD_SCALE,
    WIELD_INITIAL_HEIGHT,
    WIELD_X,
    WIELD_Y,
    WORLD_HEIGHT,
    WORLD_WIDTH,
} from '@/game/const.ts'
import { Container, Rectangle, useScene } from 'phavuer'
import { useGameBusStore } from '@/store/bus.ts'
import { computed, onMounted, ref } from 'vue'
import CardInWieldCardStack from '@/game/objects/CardInWieldCardStack.vue'
import { AnyCardRegion } from '@/model/CardRegion.ts'
import Phaser, { GameObjects } from 'phaser'
import EventData = Phaser.Types.Input.EventData
import WieldCardStackActions from '@/ui/ingame/WieldCardStackActions.vue'
import { display } from '@/game/display.ts'

const props = defineProps<{
    cardRegion: AnyCardRegion
}>()

const gameBus = useGameBusStore()
const scene = useScene()

const width = WORLD_WIDTH - WIELD_X * 2
const height = WIELD_INITIAL_HEIGHT

const wieldsActionsWidth = WIELD_ACTIONS_WIDTH + 4
const wieldsActionsHeight = WIELD_INITIAL_HEIGHT

const cardsPanelWidth = width - wieldsActionsWidth
const cardsPanelHeight = height

const CARD_DISPLAY_WIDTH = WIELD_CARD_SCALE * CARD_WIDTH + 8
const CARDS_OFFSET = 15

/** Wield Actions positionning */

const actionsStyle = computed(() => {
    const scaledCardsPanelWidth = (width - wieldsActionsWidth) * display.scale
    return {
        width: `${wieldsActionsWidth}px`,
        height: `${wieldsActionsHeight}px`,
        top: `0px`,
        left: `${scaledCardsPanelWidth + 4}px`,
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
    let cards = props.cardRegion.cards
    if (gameBus.wieldCardStack.searchString) {
        cards = cards.filter(card =>
            card.secureName
                .toLowerCase()
                .includes(gameBus.wieldCardStack.searchString.toLowerCase()),
        )
    }
    return cards
})

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
    return cards.value.length * CARD_DISPLAY_WIDTH + CARDS_OFFSET
})

function updateScrollbar() {
    if (totalCardsWidth.value <= cardsPanelWidth) {
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

    // Set Interactive to listen to wheel events
    cardsPanel.setInteractive(
        new Phaser.Geom.Rectangle(
            WIELD_X,
            WIELD_Y,
            100 * CARD_DISPLAY_WIDTH, // Scroll up to 100 cards, should be enough
            cardsPanelHeight,
        ),
        Phaser.Geom.Rectangle.Contains,
    )

    // Add a mask to hide cards overflowing from the cards panel
    const graphics = scene.make.graphics()
    graphics.fillRect(WIELD_X, WIELD_Y, cardsPanelWidth, cardsPanelHeight)
    graphics.fillRect(WIELD_X, cardsPanelHeight, width, WORLD_HEIGHT)
    const mask = new Phaser.Display.Masks.GeometryMask(scene, graphics)
    cardsPanel.setMask(mask)

    // Create scrollbar
    updateScrollbar()
}

function onScrollbarPointerDown(pointer: Phaser.Input.Pointer, {}, {}, event: EventData) {
    event.stopPropagation()

    isDraggingScrollbar = true
    dragScrollbarStartX = pointer.x
    // Calculate the offset relative to the scrollbar's current position, not the container
    initialScrollbarX = scrollbarX.value - WIELD_X

    scene.input.on('pointermove', onScrollbarPointerMove)
    scene.input.on('pointerup', onScrollbarPointerUp)
}

function onScrollbarPointerMove(pointer: Phaser.Input.Pointer) {
    if (!isDraggingScrollbar) {
        return
    }

    const deltaX = pointer.x - dragScrollbarStartX
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
}
</script>
