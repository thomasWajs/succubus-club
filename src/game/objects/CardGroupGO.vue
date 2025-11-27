<template>
    <template v-if="target && boundingBox">
        <!-- Card group bounding box -->
        <template v-if="target">
            <Rectangle
                :origin="0"
                :x="boundingBox.x"
                :y="boundingBox.y"
                :width="boundingBox.width"
                :height="boundingBox.height"
                :lineWidth="CARD_GROUP_BOUNDING_BOX_THICKNESS"
                :strokeColor="CARD_GROUP_BOUNDING_BOX_COLOR.color"
            />
        </template>

        <template v-if="target.type == 'selected'">
            <ButtonGo
                :originX="0.5"
                :originY="0"
                :x="boundingBox.x + boundingBox.width / 2"
                :y="boundingBox.y + boundingBox.height + CARD_GROUP_ICON_MARGIN"
                :width="CARD_GROUP_ICON_WIDTH"
                :height="CARD_GROUP_ICON_HEIGHT"
                :backgroundColor="CARD_GROUP_BACKGROUND_COLOR"
                @click="onClick"
            >
                <Image
                    ref="cardGroupIcon"
                    :texture="Texture.BrokenChain"
                    :originY="0"
                    :x="boundingBox.x + boundingBox.width / 2"
                    :y="
                        boundingBox.y +
                        boundingBox.height +
                        CARD_GROUP_ICON_MARGIN +
                        CARD_GROUP_ICON_HEIGHT * 0.1
                    "
                    :displayWidth="CARD_GROUP_ICON_WIDTH * 0.8"
                    :displayHeight="CARD_GROUP_ICON_HEIGHT * 0.8"
                />
            </ButtonGo>
        </template>
        <template v-else>
            <Image
                :texture="Texture.CardGroup"
                :originX="0.5"
                :originY="0"
                :x="boundingBox.x + boundingBox.width / 2"
                :y="boundingBox.y + boundingBox.height + CARD_GROUP_ICON_MARGIN"
                :displayWidth="CARD_GROUP_ICON_WIDTH"
                :displayHeight="CARD_GROUP_ICON_HEIGHT"
            />
        </template>

        <!-- Dragged card outline -->
        <template v-if="target.type == 'drag'">
            <Rectangle
                :origin="0"
                :x="
                    target.cardRectangle.x +
                    (target.card.isLocked ? target.cardRectangle.height : 0)
                "
                :y="target.cardRectangle.y"
                :width="target.cardRectangle.width"
                :height="target.cardRectangle.height"
                :rotation="target.card.isLocked ? Math.PI / 2 : 0"
                :lineWidth="CARD_OUTLINE_THICKNESS"
                :strokeColor="CARD_GROUP_OUTLINE_COLOR.color"
            />
        </template>
    </template>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Phaser from 'phaser'
import { Image, Rectangle } from 'phavuer'
import { useGameBusStore } from '@/store/bus.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { dilateRectangle, getCardRectangle, getCardRectangleAt } from '@/game/utils.ts'
import { Texture } from '@/resources/textures.ts'
import {
    CARD_GROUP_BACKGROUND_COLOR,
    CARD_GROUP_BOUNDING_BOX_COLOR,
    CARD_GROUP_BOUNDING_BOX_THICKNESS,
    CARD_GROUP_ICON_HEIGHT,
    CARD_GROUP_ICON_MARGIN,
    CARD_GROUP_ICON_WIDTH,
    CARD_GROUP_OUTLINE_COLOR,
    CARD_OUTLINE_THICKNESS,
} from '@/game/const.ts'
import ButtonGo from '@/game/objects/ButtonGo.vue'
import { CardGroup } from '@/game/types.ts'

const gameState = useGameStateStore()
const gameBus = useGameBusStore()

function cardsToRectangles(cards: CardGroup): Phaser.Geom.Rectangle[] {
    return [...cards].map(coid => getCardRectangle(gameState.cards[coid]))
}

const target = computed(() => {
    let type, card, cardRectangle, color, cardGroup, cardGroupRects

    if (
        gameBus.cardGroupCandidate &&
        gameBus.dragOver &&
        gameBus.dragOver.cardRegion &&
        gameBus.dragAttrs
    ) {
        type = 'drag'
        card = gameBus.dragOver.card
        cardRectangle = getCardRectangleAt(
            gameBus.dragOver.cardRegion,
            gameBus.dragAttrs.localX,
            gameBus.dragAttrs.localY,
        )
        cardGroupRects = cardsToRectangles(gameBus.cardGroupCandidate)
        cardGroupRects.push(cardRectangle)
    } else if (gameBus.hoveredCard && gameBus.hoveredCard.isIn.play) {
        type = 'hovered'
        card = gameBus.hoveredCard
        cardRectangle = getCardRectangle(card)
        cardGroup = gameBus.cardGroupsByCard[card.oid]
    } else if (gameBus.selectedCards.length == 1) {
        type = 'selected'
        card = gameBus.selectedCards[0]
        cardRectangle = getCardRectangle(card)
        cardGroup = gameBus.cardGroupsByCard[card.oid]
    }

    if (cardGroup) {
        cardGroupRects = cardsToRectangles(cardGroup)
    }

    return card && cardRectangle && cardGroupRects ?
            { type, card, cardRectangle, color, cardGroup, cardGroupRects }
        :   null
})

const boundingBox = computed(() => {
    if (!target.value) {
        return null
    }
    const { cardGroupRects } = target.value
    let [minX, minY, maxX, maxY] = [9999, 9999, -9999, -9999]
    for (const rectangle of cardGroupRects) {
        minX = Math.min(minX, rectangle.x)
        minY = Math.min(minY, rectangle.y)
        maxX = Math.max(maxX, rectangle.x)
        maxY = Math.max(maxY, rectangle.y)
    }
    const boundingBox = new Phaser.Geom.Rectangle(
        minX,
        minY,
        maxX - minX + cardGroupRects[0].width,
        maxY - minY + cardGroupRects[0].height,
    )
    return dilateRectangle(boundingBox, 10)
})

function onClick() {
    // Delete this card groups
    gameBus.cardGroups = gameBus.cardGroups.filter(group => group !== target.value?.cardGroup)
}
</script>

<style lang="scss"></style>
