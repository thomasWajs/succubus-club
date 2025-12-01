<template>
    <template
        v-for="target of targets"
        :key="target.card.oid"
    >
        <!-- Card group bounding box -->
        <Rectangle
            :origin="0"
            :x="target.boundingBox.x"
            :y="target.boundingBox.y"
            :width="target.boundingBox.width"
            :height="target.boundingBox.height"
            :lineWidth="CARD_GROUP_BOUNDING_BOX_THICKNESS"
            :strokeColor="CARD_GROUP_BOUNDING_BOX_COLOR.color"
        />

        <template v-if="target.type == TargetType.Selected">
            <ButtonGo
                :originX="0.5"
                :originY="0"
                :x="target.boundingBox.x + target.boundingBox.width / 2"
                :y="target.boundingBox.y + target.boundingBox.height + CARD_GROUP_ICON_MARGIN"
                :width="CARD_GROUP_ICON_WIDTH"
                :height="CARD_GROUP_ICON_HEIGHT"
                :backgroundColor="CARD_GROUP_BACKGROUND_COLOR"
                @click="onClick(target)"
            >
                <Image
                    ref="cardGroupIcon"
                    :texture="Texture.BrokenChain"
                    :originY="0"
                    :x="target.boundingBox.x + target.boundingBox.width / 2"
                    :y="
                        target.boundingBox.y +
                        target.boundingBox.height +
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
                :x="target.boundingBox.x + target.boundingBox.width / 2"
                :y="target.boundingBox.y + target.boundingBox.height + CARD_GROUP_ICON_MARGIN"
                :displayWidth="CARD_GROUP_ICON_WIDTH"
                :displayHeight="CARD_GROUP_ICON_HEIGHT"
            />
        </template>

        <!-- Dragged card outline -->
        <template v-if="target.type == TargetType.Drag">
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
import Card from '@/model/Card.ts'

const gameState = useGameStateStore()
const gameBus = useGameBusStore()

enum TargetType {
    Drag = 'drag',
    Hovered = 'hovered',
    Selected = 'selected',
}

type CardGroupTarget = {
    type: TargetType
    card: Card
    cardRectangle: Phaser.Geom.Rectangle
    cardGroup?: CardGroup
    cardGroupRects: Phaser.Geom.Rectangle[]
    boundingBox: Phaser.Geom.Rectangle
}

function cardsToRectangles(cards: CardGroup): Phaser.Geom.Rectangle[] {
    return [...cards].map(coid => getCardRectangle(gameState.cards[coid]))
}

function getBoundingBox(cardGroupRects: Phaser.Geom.Rectangle[]): Phaser.Geom.Rectangle {
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
    // Add somme padding around the cards so the bounding box is clearly visible
    return dilateRectangle(boundingBox, 10)
}

function createCardGroupTarget(type: TargetType, card: Card): CardGroupTarget | null {
    const cardRectangle = getCardRectangle(card)
    const cardGroup = gameBus.cardGroupsByCard[card.oid]
    if (cardGroup) {
        const cardGroupRects = cardsToRectangles(cardGroup)
        const boundingBox = getBoundingBox(cardGroupRects)
        return { type, card, cardRectangle, cardGroup, cardGroupRects, boundingBox }
    }
    return null
}

const targets = computed(() => {
    const targets: CardGroupTarget[] = []
    const addTarget = (target: CardGroupTarget | null) => {
        const alreadyDone = targets.map(tg => tg.cardGroup).includes(target?.cardGroup)
        if (target && !alreadyDone) {
            targets.push(target)
        }
    }

    if (
        gameBus.cardGroupCandidate &&
        gameBus.dragOver &&
        gameBus.dragOver.cardRegion &&
        gameBus.dragAttrs
    ) {
        const card = gameBus.dragOver.card
        const cardRectangle = getCardRectangleAt(
            gameBus.dragOver.cardRegion,
            gameBus.dragAttrs.localX,
            gameBus.dragAttrs.localY,
        )
        const cardGroupRects = cardsToRectangles(gameBus.cardGroupCandidate)
        cardGroupRects.push(cardRectangle)
        const boundingBox = getBoundingBox(cardGroupRects)
        addTarget({ type: TargetType.Drag, card, cardRectangle, cardGroupRects, boundingBox })
    }

    if (gameBus.hoveredCard && gameBus.hoveredCard.isIn.play) {
        addTarget(createCardGroupTarget(TargetType.Hovered, gameBus.hoveredCard))
    }

    for (const card of gameBus.selectedCards) {
        addTarget(createCardGroupTarget(TargetType.Selected, card))
    }

    return targets
})

function onClick(target: CardGroupTarget) {
    if (target.cardGroup) {
        gameBus.removeCardGroup(target.cardGroup)
    }
}
</script>

<style lang="scss"></style>
