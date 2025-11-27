import { Card } from '@/model/Card.ts'
import { ComputedRef, reactive, Ref, computed } from 'vue'
import Phaser, { GameObjects } from 'phaser'
import Pointer = Phaser.Input.Pointer
import Rectangle = Phaser.Geom.Rectangle
import { CardMovement, gameMutations } from '@/state/gameMutations.ts'
import { useGameBusStore } from '@/store/bus.ts'
import {
    dilateRectangle,
    dropCoordinatesSnapped,
    getCardRectangle,
    getCardRectangleAt,
    getCardScale,
} from '@/game/utils.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { CardAttrs, RegionCategory, DragAttrs, CardGroup } from '@/game/types.ts'
import { RegionName } from '@/model/const.ts'
import { AlignmentGuide, GUIDE_HORIZONTAL, GUIDE_VERTICAL } from '@/state/types.ts'
import { ALIGNMENT_GUIDE_THRESHOLD, GRID_SIZE } from '@/game/const.ts'
import { AnyCardRegion } from '@/model/CardRegion.ts'
import { useCoreStore } from '@/store/core.ts'

export function useCardDragDrop(
    cardRef: Ref<Card>,
    cardAttrsRef: ComputedRef<CardAttrs>,
    bringToTop: () => void,
) {
    const core = useCoreStore()
    const gameState = useGameStateStore()
    const gameBus = useGameBusStore()

    /**
     * Alignment guides
     */

    const alignmentEnabled = computed(() => core.userProfile.preferences.alignmentGuides ?? true)

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

    const groupingEnabled = computed(() => core.userProfile.preferences.cardGrouping ?? true)

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
            !groupingEnabled.value ||
            cardRegion.owner.oid != gameState.selfPlayer?.oid ||
            cardRegion.name != RegionName.Ready ||
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
        scale: cardAttrsRef.value.scale,
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
        dragAttrs.deltaX = card.x - (originCard?.x ?? card.x)
        dragAttrs.deltaY = card.y - (originCard?.y ?? card.y)
        dragAttrs.scale = cardAttrsRef.value.scale

        gameBus.cardGroupCandidate = null
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
            dragAttrs.x = originDragAttrs.x + dragAttrs.deltaX
            dragAttrs.y = originDragAttrs.y + dragAttrs.deltaY
            dragAttrs.localX = originDragAttrs.localX + dragAttrs.deltaX
            dragAttrs.localY = originDragAttrs.localY + dragAttrs.deltaY
            return
        }

        // Default case : not above a region.
        // We use the dragged position and card scale as is.
        let posX = dragX - (cardAttrs.offsetX ?? 0)
        let posY = dragY - (cardAttrs.offsetY ?? 0)
        dragAttrs.scale = cardAttrs.scale

        // Above a region :
        // - override with the scale of the region
        // - snap the position to the grid
        // - display alignment guides
        if (
            gameBus.dragOver.gameObjects.target &&
            gameBus.dragOver.cardRegion &&
            gameBus.dragOver.regionCategory
        ) {
            const cardRegion = gameBus.dragOver.cardRegion

            dragAttrs.scale = getCardScale(gameBus.dragOver.regionCategory, cardRegion)

            const isOverPlayArea = gameBus.dragOver.regionCategory == RegionCategory.Table
            const fromContainer = gameBus.dragOver.gameObjects.cardImage.parentContainer
            const toContainer = gameBus.dragOver.gameObjects.target.parentContainer

            // Difference between the origin and target container
            const containerOffsetX = toContainer.x - fromContainer.x
            const containerOffsetY = toContainer.y - fromContainer.y

            // Position in the container referential
            let localX = posX - containerOffsetX
            let localY = posY - containerOffsetY

            // Over playArea from outside ( hand, stack, another playArea ).
            if (isOverPlayArea && fromContainer != toContainer) {
                // Find closest x/y coords centered around the pointer
                const dropCoord = dropCoordinatesSnapped(
                    pointer,
                    toContainer as GameObjects.Container,
                )
                localX = dropCoord.x
                localY = dropCoord.y
            }

            // If we're dragging over a ready region, trigger the alignment guides
            if (alignmentEnabled.value && cardRegion && cardRegion.name == RegionName.Ready) {
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
                localX = Phaser.Math.Snap.To(localX, GRID_SIZE)
                localY = Phaser.Math.Snap.Ceil(localY, GRID_SIZE) - GRID_SIZE / 2
            }

            // Card group outline
            gameBus.cardGroupCandidate = findCardGroupCandidate(cardRegion, localX, localY)

            posX = localX + containerOffsetX
            posY = localY + containerOffsetY

            dragAttrs.localX = localX
            dragAttrs.localY = localY
        }

        dragAttrs.x = posX
        dragAttrs.y = posY
    }

    function onDragEnd() {
        dragAttrs.isDragging = false
        dragAttrs.deltaX = 0
        dragAttrs.deltaY = 0
        dragAttrs.scale = cardAttrsRef.value.scale
        gameBus.cardGroupCandidate = null
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

        const cardGroup = findCardGroupCandidate(targetCardRegion, x, y)
        if (cardGroup) {
            cardGroup.add(card.oid)
            if (!gameBus.cardGroups.includes(cardGroup)) {
                gameBus.cardGroups.push(cardGroup)
            }
        }

        const movement: CardMovement = {
            card,
            x,
            y,
            position: gameBus.handDropGapPosition ?? 0,
        }

        // We're not changing region, just move the card inside the same region
        if (targetCardRegion.oid == card.region.oid) {
            gameMutations.moveCard.actSelf(movement)
        }
        // We change region
        else {
            gameMutations.moveCardToRegion.actSelf({
                fromCardRegion: card.region,
                toCardRegion: targetCardRegion,
                ...movement,
            })
        }
    }

    return { dragAttrs, onDragStart, onDrag, onDragEnd, onDrop }
}
