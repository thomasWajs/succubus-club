<template>
    <Container
        :x="HAND_X"
        :y="HAND_Y"
    >
        <Rectangle
            :origin="0"
            :x="0"
            :y="0"
            :height="HAND_HEIGHT"
            :width="HAND_WIDTH"
            :fillColor="Colors.REGION_BACKGROUND.color"
            :fillAlpha="isDraggedOver ? 0.05 : 0"
            :dropZone="true"
            @create="onBoundariesCreate"
        >
            <FxHighlightRegionDrop
                v-if="isDraggedOver"
                :color="getPlayerColor(players.selfPlayer!)"
            />
        </Rectangle>

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
import { Container, Rectangle, useScene } from 'phavuer'

import CardInHandGO from '@/client/game/objects/CardInHandGO.vue'
import { usePlayersStore } from '@/client/state/players.ts'
import { computed, nextTick, ref } from 'vue'
import { Colors } from '@/client/colors.ts'
import { HAND_HEIGHT, HAND_WIDTH, HAND_X, HAND_Y } from '@/shared/const/game.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { PhaserDataKey, RegionCategory } from '@/client/game/types.ts'

import {
    dropCoordinates,
    getCardDragged,
    getPlayerColor,
    getWorldPoint,
} from '@/client/game/utils.ts'
import { display } from '@/client/game/display.ts'
import { CardOid } from '@/shared/types/model.ts'
import FxHighlightRegionDrop from '@/client/game/objects/FxHighlightRegionDrop.vue'
import Pointer = Phaser.Input.Pointer

const players = usePlayersStore()
const gameBus = useGameBusStore()
const isDraggedOver = ref(false)

// Can't link directly to selfPlayer.hand because resync will change the object
const hand = computed(() => players.selfPlayer?.hand)

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
    return hand.value?.cards.map(card => cardInHandMap[card.oid]).filter(card => card) ?? []
}

/**
 * Keep the card image visibility in the correct order
 */
function sortCardInHandsVisibility() {
    for (const card of getOrderedCardsInHand()) {
        card?.bringToTop()
    }
}

function onBoundariesCreate(boundaries: GameObjects.Arc) {
    boundaries.setData(PhaserDataKey.CardRegionOid, hand.value?.oid)
    boundaries.setData(PhaserDataKey.RegionCategory, RegionCategory.Hand)

    const scene = useScene()
    scene.input.on(Phaser.Input.Events.DRAG_START, () => {
        gameBus.handDropGapPosition = null
    })
    scene.input.on(
        Phaser.Input.Events.DRAG_ENTER,
        ({}, cardImage: GameObjects.Image, target: GameObjects.Arc) => {
            // Highlight target region if it's different from the source region
            const card = getCardDragged(cardImage)
            if (card && target == boundaries && card.region.oid != hand.value?.oid) {
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
    scene.input.on(Phaser.Input.Events.DRAG, (pointer: Pointer, {}, {}, {}) => {
        const VERTICAL_MARGIN = 25

        gameBus.handDropGapPosition = null
        const bounds = boundaries.getBounds()
        // Add some margin to reorder when the pointer is atop of the cards
        bounds.y -= VERTICAL_MARGIN / display.scale

        const worldPoint = getWorldPoint(pointer.x, pointer.y)
        if (
            boundaries.parentContainer &&
            // Reorder only if we're in the bounds of the hand zone
            bounds.contains(worldPoint.x, worldPoint.y)
        ) {
            const coord = dropCoordinates(pointer, boundaries.parentContainer)
            gameBus.handDropGapPosition = 0
            for (const [i, card] of getOrderedCardsInHand().entries()) {
                if (card.cardAttrs.x < coord.x) {
                    gameBus.handDropGapPosition = i + 1
                }
            }
        }
    })
}
</script>
