<template>
    <template
        v-for="target of targets"
        :key="target.card.oid"
    >
        <!-- Card group bounding box -->
        <Rectangle
            :origin="0.5"
            :x="getBoundingBoxCenter(target).x"
            :y="getBoundingBoxCenter(target).y"
            :width="target.boundingBox.width"
            :height="target.boundingBox.height"
            :rotation="getControllerFacingRotation(target)"
            :lineWidth="CARD_GROUP_BOUNDING_BOX_THICKNESS"
            :strokeColor="Colors.CARD_GROUP_BOUNDING_BOX.color"
        />

        <template v-if="target.type == TargetType.Selected || target.type == TargetType.Pending">
            <ButtonGO
                name="cardGroupIcon"
                :originX="0.5"
                :originY="0.5"
                :x="getIconCenter(target).x"
                :y="getIconCenter(target).y"
                :width="CARD_GROUP_ICON_WIDTH"
                :height="CARD_GROUP_ICON_HEIGHT"
                :rotation="getControllerFacingRotation(target)"
                :backgroundColor="Colors.CARD_GROUP_BACKGROUND"
                @click="onIconClick(target)"
            >
                <Image
                    ref="cardGroupIcon"
                    :texture="
                        target.type == TargetType.Pending ? Texture.CardGroup : Texture.BrokenChain
                    "
                    :origin="0.5"
                    :x="getIconCenter(target).x"
                    :y="getIconCenter(target).y + CARD_GROUP_ICON_HEIGHT * 0.1"
                    :rotation="getControllerFacingRotation(target)"
                    :displayWidth="CARD_GROUP_ICON_WIDTH * 0.8"
                    :displayHeight="CARD_GROUP_ICON_HEIGHT * 0.8"
                />
            </ButtonGO>
        </template>
        <template v-else>
            <Image
                :texture="Texture.CardGroup"
                :origin="0.5"
                :x="getIconCenter(target).x"
                :y="getIconCenter(target).y"
                :rotation="getControllerFacingRotation(target)"
                :displayWidth="CARD_GROUP_ICON_WIDTH"
                :displayHeight="CARD_GROUP_ICON_HEIGHT"
            />
        </template>

        <!-- Dragged card outline -->
        <template v-if="target.type == TargetType.Drag || target.type == TargetType.Pending">
            <Rectangle
                :origin="0.5"
                :x="getCardRectangleCenter(target).x"
                :y="getCardRectangleCenter(target).y"
                :width="target.cardRectangle.width"
                :height="target.cardRectangle.height"
                :rotation="
                    getControllerFacingRotation(target) + (target.card.isLocked ? Math.PI / 2 : 0)
                "
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
import {
    cardHalfExtents,
    dilateRectangle,
    getCardRectangle,
    getCardRectangleAt,
} from '@/client/game/utils.ts'
import { Texture } from '@/client/resources/textures.ts'
import { Colors } from '@/client/colors.ts'
import {
    CARD_GROUP_BOUNDING_BOX_THICKNESS,
    CARD_GROUP_ICON_HEIGHT,
    CARD_GROUP_ICON_MARGIN,
    CARD_GROUP_ICON_WIDTH,
    CARD_OUTLINE_THICKNESS,
    CARD_WIDTH,
} from '@/shared/const/game.ts'
import ButtonGO from '@/client/game/objects/ButtonGO.vue'
import { CardGroup } from '@/client/game/types.ts'
import { Card } from '@/shared/model/Card.ts'
import { AnyCardRegion, Point2D } from '@/shared/types/model.ts'
import { rotateAroundPivot } from '@/shared/state/freeTableLayout.ts'

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
    cardRegion: AnyCardRegion
    cardRectangle: Phaser.Geom.Rectangle
    cardGroup?: CardGroup
    cardGroupRects: Phaser.Geom.Rectangle[]
    boundingBox: Phaser.Geom.Rectangle
}

// Outline/bounding box/icon are drawn in the same unrotated frame as the
// cards' stored positions, so they need the same owner-facing rotation to
// stay aligned instead of appearing tilted. Uses the *destination* region
// rather than target.card.region : while dragging from Hand onto the table,
// the card still belongs to Hand until the drop completes even though it's
// previewed there.
function getControllerFacingRotation(target: CardGroupTarget): number {
    return target.card.facingRotation(target.cardRegion)
}

function getBoundingBoxCenter(target: CardGroupTarget): Point2D {
    return {
        x: target.boundingBox.x + target.boundingBox.width / 2,
        y: target.boundingBox.y + target.boundingBox.height / 2,
    }
}

// The group icon sits below the bounding box, in its unrotated local frame -
// rotate that anchor around the box's own center to keep it glued below the
// box once the box itself is rotated to face the owner.
function getIconCenter(target: CardGroupTarget): Point2D {
    const boxCenter = getBoundingBoxCenter(target)
    const anchor = {
        x: boxCenter.x,
        y:
            target.boundingBox.y +
            target.boundingBox.height +
            CARD_GROUP_ICON_MARGIN +
            CARD_GROUP_ICON_HEIGHT / 2,
    }
    return rotateAroundPivot(anchor, boxCenter, getControllerFacingRotation(target))
}

// cardRectangle is always built unswapped ( see getCardRectangleAt ), so its
// width still gives back the card's scale for cardHalfExtents.
function getCardRectangleCenter(target: CardGroupTarget): Point2D {
    const rectangle = target.cardRectangle
    const { halfWidth: offsetX, halfHeight: offsetY } = cardHalfExtents(
        target.card,
        rectangle.width / CARD_WIDTH,
    )
    return { x: rectangle.x + offsetX, y: rectangle.y + offsetY }
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
    return { type, card, cardRegion, cardRectangle, cardGroupRects, boundingBox }
}

function createExistingCardGroupTarget(type: TargetType, card: Card): CardGroupTarget | null {
    const cardRectangle = getCardRectangle(card)
    const cardGroup = gameBus.cardGroupsByCard[card.oid]
    if (cardGroup) {
        const cardGroupRects = cardsToRectangles(cardGroup)
        const boundingBox = getBoundingBox(cardGroupRects)
        return {
            type,
            card,
            cardRegion: card.region,
            cardRectangle,
            cardGroup,
            cardGroupRects,
            boundingBox,
        }
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
