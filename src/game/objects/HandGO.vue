<template>
    <Container
        :x="HAND_X"
        :y="HAND_Y"
    >
        <Circle
            :x="HAND_ARC_ORIGIN_X"
            :y="HAND_ARC_ORIGIN_Y"
            :radius="HAND_ARC_RADIUS"
            :fillColor="REGION_BACKGROUND_COLOR_DRAG_OVER.color"
            :fillAlpha="isDraggedOver ? REGION_BACKGROUND_COLOR_DRAG_OVER.alphaGL : 0"
            :dropZone="true"
            @create="onBoundariesCreate"
        />

        <!-- @vue-ignore -->
        <CardInHandGO
            v-for="(card, index) in hand.cards"
            :ref="registerCardInHandGO"
            :key="'Hand|' + index + '|' + card.oid"
            :card="card"
            @reset-visibility="sortCardInHandsVisibility"
        />
    </Container>
</template>

<script setup lang="ts">
import Phaser, { GameObjects } from 'phaser'
import { Circle, Container, useScene } from 'phavuer'

import CardInHandGO from '@/game/objects/CardInHandGO.vue'
import { useGameStateStore } from '@/store/gameState.ts'
import { nextTick, ref } from 'vue'
import {
    HAND_ARC_ORIGIN_X,
    HAND_ARC_ORIGIN_Y,
    HAND_ARC_RADIUS,
    HAND_X,
    HAND_Y,
    REGION_BACKGROUND_COLOR_DRAG_OVER,
} from '@/game/const.ts'
import { useGameBusStore } from '@/store/bus.ts'
import Pointer = Phaser.Input.Pointer
import { CardAttrs, PhaserDataKey } from '@/game/types.ts'
import { AnyCard, CardOid } from '@/model/Card.ts'

import { dropCoordinates } from '@/game/utils.ts'

const gameState = useGameStateStore()
const gameBus = useGameBusStore()
const isDraggedOver = ref(false)
const hand = gameState.selfPlayer.hand

/**
 * Vue DOES NOT guarantee iterating order on ref arrays ( https://vuejs.org/guide/essentials/template-refs#refs-inside-v-for ).
 * Thus, we need to maintain a separate map of CardInHandGO objects
 */
const cardInHandMap = {} as Record<CardOid, typeof CardInHandGO>

function registerCardInHandGO(cardInHandGO: typeof CardInHandGO) {
    if (cardInHandGO) {
        cardInHandMap[cardInHandGO.card.oid] = cardInHandGO

        // Re-run a visibility ordering when cards change
        nextTick(() => {
            sortCardInHandsVisibility()
        })
    }
}

function getOrderedCardsInHand() {
    return gameState.selfPlayer.hand.cards.map(card => cardInHandMap[card.oid]).filter(card => card)
}

/**
 * Keep the card image visibility in the correct order
 */
function sortCardInHandsVisibility() {
    for (const card of getOrderedCardsInHand()) {
        if (card.bringToTop) {
            card.bringToTop()
        }
    }
}

function onBoundariesCreate(boundaries: GameObjects.Arc) {
    boundaries.setData(PhaserDataKey.CardRegion, hand)

    const scene = useScene()
    scene.input.on(Phaser.Input.Events.DRAG_START, () => {
        gameBus.handDropGapPosition = null
    })
    scene.input.on(
        Phaser.Input.Events.DRAG_ENTER,
        ({}, cardImage: GameObjects.Image, target: GameObjects.Arc) => {
            // Highlight target region if it's different from the source region
            const card = cardImage.getData(PhaserDataKey.Card) as AnyCard
            if (target == boundaries && card.region.oid != hand.oid) {
                isDraggedOver.value = true
            }
        },
    )
    scene.input.on(Phaser.Input.Events.DRAG_LEAVE, ({}, {}, target: GameObjects.Arc) => {
        if (target == boundaries) {
            isDraggedOver.value = false
        }
    })
    scene.input.on(Phaser.Input.Events.DRAG_END, ({}, {}, {}) => {
        isDraggedOver.value = false
        sortCardInHandsVisibility()

        gameBus.handDropGapPosition = null
    })

    /**
     * Handle reordering for cards in hand
     */
    scene.input.on(
        Phaser.Input.Events.DRAG,
        (pointer: Pointer, cardImage: GameObjects.Image, dragX: number, {}) => {
            const VERTICAL_MARGIN = 25
            // Deactivate horizontal travel for now by setting its value to 0
            const HORIZONTAL_TRAVEL = 0

            gameBus.handDropGapPosition = null

            const draggedCardAttrs = cardImage.getData(PhaserDataKey.CardAttrs).value as CardAttrs
            const bounds = boundaries.getBounds()
            // Add some margin to reorder when the pointer is atop of the cards
            bounds.y -= VERTICAL_MARGIN

            if (
                // Reorder only if we're in the bounds of the hand circle
                bounds.contains(pointer.x, pointer.y) &&
                // Reorder only if we've travelled far enough horizontally
                Math.abs(dragX - draggedCardAttrs.x) >= HORIZONTAL_TRAVEL
            ) {
                const coord = dropCoordinates(pointer, boundaries.parentContainer)
                gameBus.handDropGapPosition = 0
                for (const [i, card] of getOrderedCardsInHand().entries()) {
                    if (card.cardAttrs.x < coord.x) {
                        gameBus.handDropGapPosition = i + 1
                    }
                }
            }
        },
    )
}
</script>
