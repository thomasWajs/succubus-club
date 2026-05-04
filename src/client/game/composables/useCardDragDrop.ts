import { Card } from '@/shared/model/Card.ts'
import { ComputedRef, reactive, Ref } from 'vue'
import Phaser from 'phaser'
import { CardMovement, gameMutations } from '@/shared/state/gameMutations.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import {
    dilateRectangle,
    dropCoordinates,
    dropCoordinatesSnapped,
    getCardRectangle,
    getCardRectangleAt,
    getCardScale,
} from '@/client/game/utils.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { CardAttrs, CardGroup, DragAttrs, RegionCategory } from '@/client/game/types.ts'
import { AlignmentGuide, GUIDE_HORIZONTAL, GUIDE_VERTICAL } from '@/shared/types/state.ts'
import { ALIGNMENT_GUIDE_THRESHOLD, GRID_SIZE } from '@/shared/const/game.ts'
import { AnyCardRegion } from '@/shared/types/model.ts'
import { Snap } from '@/shared/utils.ts'
import { useUIFeatures } from '@/client/game/composables/useUIFeatures.ts'
import { playCardFromHand } from '@/client/game/declaration.ts'
import Pointer = Phaser.Input.Pointer
import Rectangle = Phaser.Geom.Rectangle

export function useCardDragDrop(
    cardRef: Ref<Card>,
    cardAttrsRef: ComputedRef<CardAttrs>,
    bringToTop: VoidFunction,
) {
    const gameState = useGameStateStore()
    const gameBus = useGameBusStore()

    /**
     * Alignment guides
     */

    const { alignmentGuidesEnabled } = useUIFeatures()

    function findAlignmentGuides(
        cardRegion: AnyCardRegion,
        posX: number,
        posY: number,
    ): AlignmentGuide[] {
        const guides: AlignmentGuide[] = []
        const otherCards = cardRegion.cards.filter(
            c =>
                !gameBus.selectedCards.includes(c) &&
                !gameBus.indirectSelectedCards.includes(c.oid),
        )

        if (otherCards.length === 0) return guides

        // Group cards by their positions
        const verticalCards: Card[] = []
        const horizontalCards: Card[] = []

        for (const otherCard of otherCards) {
            // Check vertical alignment (same x coordinate)
            if (Math.abs(otherCard.x - posX) < ALIGNMENT_GUIDE_THRESHOLD) {
                verticalCards.push(otherCard)
            }

            // Check horizontal alignment (same y coordinate)
            if (Math.abs(otherCard.y - posY) < ALIGNMENT_GUIDE_THRESHOLD) {
                horizontalCards.push(otherCard)
            }
        }

        if (verticalCards.length > 0) {
            guides.push({
                type: GUIDE_VERTICAL,
                dragX: verticalCards[0].x,
                dragY: posY,
                scale: cardAttrsRef.value.scale,
                withCards: verticalCards,
            })
        }

        if (horizontalCards.length > 0) {
            guides.push({
                type: GUIDE_HORIZONTAL,
                dragX: posX,
                dragY: horizontalCards[0].y,
                scale: cardAttrsRef.value.scale,
                withCards: horizontalCards,
            })
        }

        return guides
    }

    /**
     * Card Groups
     */

    const { cardGroupingEnabled } = useUIFeatures()

    function findCardGroupCandidate(
        cardRegion: AnyCardRegion,
        posX: number,
        posY: number,
    ): CardGroup | null {
        const card = cardRef.value
        const otherCards = cardRegion.cards.filter(c => c.oid != card.oid)

        // No card grouping possible outside of self ready area
        // No card grouping possible for multi-drag.
        // No card grouping possible if the card is already in a group
        if (
            !cardGroupingEnabled.value ||
            !cardRegion.owner ||
            cardRegion.owner.oid != gameState.selfPlayer?.oid ||
            !cardRegion.is.ready ||
            gameBus.selectedCards.length > 1 ||
            card.oid in gameBus.cardGroupsByCard ||
            otherCards.length === 0
        ) {
            return null
        }

        let cardRectangle = getCardRectangleAt(cardRegion, posX, posY)
        // Dilate by 1px to also detect cards that are exactly on the border.
        cardRectangle = dilateRectangle(cardRectangle, 1)
        let maxAreaIntersection = 0
        let cardCandidate = null
        for (const otherCard of otherCards) {
            let otherCardRectangle = getCardRectangle(otherCard)
            otherCardRectangle = dilateRectangle(otherCardRectangle, 1)
            const intersectionArea = Rectangle.Area(
                Rectangle.Intersection(cardRectangle, otherCardRectangle),
            )
            if (intersectionArea > maxAreaIntersection) {
                maxAreaIntersection = intersectionArea
                cardCandidate = otherCard
            }
        }

        if (cardCandidate) {
            const existing = gameBus.cardGroupsByCard[cardCandidate.oid]
            return existing ?? new Set([cardCandidate.oid])
        }

        return null
    }

    /**
     * Dragging
     */

    // Track if we're currently dragging this card
    const dragAttrs: DragAttrs = reactive({
        isDragging: false,
        x: 0,
        y: 0,
        localX: 0,
        localY: 0,
        deltaX: 0,
        deltaY: 0,
        cardScale: cardAttrsRef.value.scale,
        scaleRatio: 1,
    })

    function onDragStart(originCard?: Card) {
        // Spectators can't interact with the game
        if (gameState.isSpectator) {
            return
        }

        const card = cardRef.value

        dragAttrs.isDragging = true
        dragAttrs.x = card.x
        dragAttrs.y = card.y
        dragAttrs.localX = card.x
        dragAttrs.localY = card.y
        // Delta is used only for multi-card drag. Else default to 0 and have no effect
        dragAttrs.deltaX = originCard ? card.x - originCard.x : 0
        dragAttrs.deltaY = originCard ? card.y - originCard.y : 0
        dragAttrs.cardScale = cardAttrsRef.value.scale
        dragAttrs.scaleRatio = 1

        gameBus.cardGroupCandidate = null
        gameBus.cardPendingIntoGroup = null
        if (!originCard || card == originCard) {
            gameBus.dragAttrs = dragAttrs
        }

        bringToTop()
    }

    function onDrag(pointer: Pointer, dragX: number, dragY: number, originDragAttrs?: DragAttrs) {
        const cardAttrs = cardAttrsRef.value

        // Spectators can't interact with the game
        if (!dragAttrs.isDragging || gameState.isSpectator || !gameBus.dragOver) {
            return
        }

        // Special case for multi-card drag :
        // we need to update the drag position based on the delta of the origin card
        if (originDragAttrs && (dragAttrs.deltaX != 0 || dragAttrs.deltaY != 0)) {
            dragAttrs.x = originDragAttrs.x + dragAttrs.deltaX * originDragAttrs.scaleRatio
            dragAttrs.y = originDragAttrs.y + dragAttrs.deltaY * originDragAttrs.scaleRatio
            dragAttrs.localX = originDragAttrs.localX + dragAttrs.deltaX
            dragAttrs.localY = originDragAttrs.localY + dragAttrs.deltaY
            dragAttrs.cardScale = originDragAttrs.cardScale
            dragAttrs.scaleRatio = originDragAttrs.scaleRatio
            return
        }

        // Default case : not above a region.
        // We use the dragged position and card scale as is.
        let posX = dragX - (cardAttrs.offsetX ?? 0)
        let posY = dragY - (cardAttrs.offsetY ?? 0)
        dragAttrs.cardScale = cardAttrs.scale
        dragAttrs.scaleRatio = 1

        // Above a region :
        // - override with the scale of the region
        // - snap the position to the grid
        // - display alignment guides
        // - search for a card group candidate
        if (
            gameBus.dragOver.gameObjects.target &&
            gameBus.dragOver.cardRegion &&
            gameBus.dragOver.regionCategory &&
            gameBus.dragOver.regionCategory != RegionCategory.Stack
        ) {
            const cardRegion = gameBus.dragOver.cardRegion
            const isOverPlayArea = gameBus.dragOver.regionCategory == RegionCategory.Table
            const fromContainer = gameBus.dragOver.gameObjects.cardImage.parentContainer
            const toContainer = gameBus.dragOver.gameObjects.target.parentContainer
            const scaleRatio = toContainer.scale / fromContainer.scale

            dragAttrs.cardScale =
                getCardScale(gameBus.dragOver.regionCategory, cardRegion) * scaleRatio
            dragAttrs.scaleRatio = scaleRatio

            // Position in the container referential
            let localX = posX
            let localY = posY

            // The card is being dragged from another region.
            if (fromContainer != toContainer) {
                let dropCoord
                // Over playArea from outside ( hand, stack, another playArea ).
                if (isOverPlayArea) {
                    // Find closest x/y coords centered around the pointer
                    dropCoord = dropCoordinatesSnapped(pointer, toContainer)
                }
                // Over a non-playArea
                else {
                    dropCoord = dropCoordinates(pointer, toContainer)
                }

                localX = dropCoord.x
                localY = dropCoord.y
            }

            // If we're dragging over a ready region, trigger the alignment guides
            if (alignmentGuidesEnabled.value && cardRegion && cardRegion.is.ready) {
                // Find alignment guides and apply snapping
                gameBus.alignmentGuides = findAlignmentGuides(cardRegion, localX, localY)

                for (const guide of gameBus.alignmentGuides) {
                    if (guide.type === GUIDE_VERTICAL) {
                        localX = guide.dragX
                    } else {
                        localY = guide.dragY
                    }
                }
            }

            // Always snap over the playArea.
            // If the card comes from another region or has been attracted by alignment,
            // it will already be snapped.
            if (isOverPlayArea) {
                localX = Snap.to(localX, GRID_SIZE)
                localY = Snap.ceil(localY, GRID_SIZE)
            }

            // Card group outline
            gameBus.cardGroupCandidate = findCardGroupCandidate(cardRegion, localX, localY)

            dragAttrs.localX = localX
            dragAttrs.localY = localY

            const worldPoint = toContainer.getWorldTransformMatrix().transformPoint(localX, localY)
            const dragPoint = fromContainer.getLocalPoint(worldPoint.x, worldPoint.y)
            posX = dragPoint.x
            posY = dragPoint.y
        }

        dragAttrs.x = posX
        dragAttrs.y = posY
    }

    function onDragEnd() {
        dragAttrs.isDragging = false
        dragAttrs.deltaX = 0
        dragAttrs.deltaY = 0
        dragAttrs.cardScale = cardAttrsRef.value.scale
        gameBus.dragAttrs = null
    }

    /**
     * Drop on new position
     */

    function onDrop() {
        const card = cardRef.value

        // Not dropped on any region, abort
        if (
            !dragAttrs.isDragging ||
            !gameBus.dragOver ||
            !gameBus.dragOver.gameObjects.target ||
            !gameBus.dragOver.cardRegion
        ) {
            return
        }

        const targetCardRegion = gameBus.dragOver.cardRegion

        // If we're changing container, we need to use the local referential
        const [x, y] =
            targetCardRegion.oid == card.region.oid ?
                [dragAttrs.x, dragAttrs.y]
            :   [dragAttrs.localX, dragAttrs.localY]

        if (gameBus.cardGroupCandidate) {
            gameBus.cardPendingIntoGroup = card
        }

        const isHand = targetCardRegion.is.hand
        const isWieldStack = gameBus.wieldCardStack.cardRegion?.oid == targetCardRegion.oid
        const position =
            isHand ? (gameBus.handDropGapPosition ?? 0)
            : isWieldStack ? (gameBus.stackDropGapPosition ?? 0)
            : 0

        let movement: CardMovement
        if (isHand || isWieldStack) {
            // position did not change, do nothing
            if (position == card.position) {
                return
            }
            movement = { card, position }
        } else {
            // coords did not change, do nothing
            if (x == card.x && y == card.y) {
                return
            }
            movement = { card, x, y }
        }

        if (targetCardRegion.oid == card.region.oid) {
            // We're not changing region, just move the card inside the same region
            gameMutations.moveCard.actSelf(movement)
        }
        // We change region
        else {
            // Special case for cards played from hand
            if (card.region == card.controller.hand && targetCardRegion == card.controller.ready) {
                playCardFromHand({ card, movement })
            }
            // standard case, for other movements
            else {
                gameMutations.moveCardToRegion.actSelf({
                    fromCardRegion: card.region,
                    toCardRegion: targetCardRegion,
                    ...movement,
                })
            }
        }
    }

    return { dragAttrs, onDragStart, onDrag, onDragEnd, onDrop }
}
