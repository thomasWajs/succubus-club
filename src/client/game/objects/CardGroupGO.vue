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
            :strokeColor="Colors.CARD_GROUP_BOUNDING_BOX.color"
        />

        <template v-if="target.type == TargetType.Selected || target.type == TargetType.Pending">
            <ButtonGo
                name="cardGroupIcon"
                :originX="0.5"
                :originY="0"
                :x="target.boundingBox.x + target.boundingBox.width / 2"
                :y="target.boundingBox.y + target.boundingBox.height + CARD_GROUP_ICON_MARGIN"
                :width="CARD_GROUP_ICON_WIDTH"
                :height="CARD_GROUP_ICON_HEIGHT"
                :backgroundColor="Colors.CARD_GROUP_BACKGROUND"
                @click="onIconClick(target)"
            >
                <Image
                    ref="cardGroupIcon"
                    :texture="
                        target.type == TargetType.Pending ? Texture.CardGroup : Texture.BrokenChain
                    "
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
        <template v-if="target.type == TargetType.Drag || target.type == TargetType.Pending">
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
                :strokeColor="Colors.CARD_GROUP_OUTLINE.color"
            />
        </template>
    </template>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Phaser from 'phaser'
import { Image, Rectangle } from 'phavuer'
import { useGameBusStore } from '@/client/store/bus.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { dilateRectangle, getCardRectangle, getCardRectangleAt } from '@/client/game/utils.ts'
import { Texture } from '@/client/resources/textures.ts'
import { Colors } from '@/client/colors.ts'
import {
    CARD_GROUP_BOUNDING_BOX_THICKNESS,
    CARD_GROUP_ICON_HEIGHT,
    CARD_GROUP_ICON_MARGIN,
    CARD_GROUP_ICON_WIDTH,
    CARD_OUTLINE_THICKNESS,
} from '@/shared/const/game.ts'
import ButtonGo from '@/client/game/objects/ButtonGo.vue'
import { CardGroup } from '@/client/game/types.ts'
import { Card } from '@/shared/model/Card.ts'
import { AnyCardRegion } from '@/shared/types/model.ts'

const gameState = useGameStateStore()
const gameBus = useGameBusStore()

enum TargetType {
    Drag = 'drag',
    Pending = 'pending',
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

function createFutureCardGroupTarget(
    type: TargetType,
    cardGroup: CardGroup,
    card: Card,
    cardRegion: AnyCardRegion,
    x: number,
    y: number,
): CardGroupTarget | null {
    const cardRectangle = getCardRectangleAt(cardRegion, x, y)
    const cardGroupRects = cardsToRectangles(cardGroup)
    cardGroupRects.push(cardRectangle)
    const boundingBox = getBoundingBox(cardGroupRects)
    return { type, card, cardRectangle, cardGroupRects, boundingBox }
}

function createExistingCardGroupTarget(type: TargetType, card: Card): CardGroupTarget | null {
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

    // Dragging a card around other cards
    if (
        gameBus.cardGroupCandidate &&
        gameBus.dragOver &&
        gameBus.dragOver.cardRegion &&
        gameBus.dragAttrs
    ) {
        addTarget(
            createFutureCardGroupTarget(
                TargetType.Drag,
                gameBus.cardGroupCandidate,
                gameBus.dragOver.card,
                gameBus.dragOver.cardRegion,
                gameBus.dragAttrs.localX,
                gameBus.dragAttrs.localY,
            ),
        )
    }

    // Card group pending creation/addition
    if (gameBus.cardGroupCandidate && gameBus.cardPendingIntoGroup) {
        addTarget(
            createFutureCardGroupTarget(
                TargetType.Pending,
                gameBus.cardGroupCandidate,
                gameBus.cardPendingIntoGroup,
                gameBus.cardPendingIntoGroup.region,
                gameBus.cardPendingIntoGroup.x,
                gameBus.cardPendingIntoGroup.y,
            ),
        )
    }

    // Hovering the mouse over an existing card group
    if (gameBus.hoveredCard && gameBus.hoveredCard.isIn.play) {
        addTarget(createExistingCardGroupTarget(TargetType.Hovered, gameBus.hoveredCard))
    }

    // A card belonging to a card group is selected
    for (const card of gameBus.selectedCards) {
        addTarget(createExistingCardGroupTarget(TargetType.Selected, card))
    }

    return targets
})

function onIconClick(target: CardGroupTarget) {
    // Break the card group
    if (target.type == TargetType.Selected && target.cardGroup) {
        gameBus.removeCardGroup(target.cardGroup)
    }
    // Create the group, or add card to the existing group
    else if (
        target.type == TargetType.Pending &&
        gameBus.cardPendingIntoGroup &&
        gameBus.cardGroupCandidate
    ) {
        const cardGroupCandidate = gameBus.cardGroupCandidate
        cardGroupCandidate.add(gameBus.cardPendingIntoGroup.oid)
        if (!gameBus.cardGroups.includes(cardGroupCandidate)) {
            gameBus.cardGroups.push(cardGroupCandidate)
        }
        gameBus.selectedCards = [gameBus.cardPendingIntoGroup]
        gameBus.cardPendingIntoGroup = null
        gameBus.cardGroupCandidate = null
    }
}
</script>

<style lang="scss"></style>
