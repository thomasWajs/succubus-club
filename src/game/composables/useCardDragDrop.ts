import { Card } from '@/model/Card.ts'
import { ComputedRef, reactive, Ref, computed } from 'vue'
import Phaser, { GameObjects } from 'phaser'
import Pointer = Phaser.Input.Pointer
import { CardMovement, gameMutations } from '@/state/gameMutations.ts'
import { useGameBusStore } from '@/store/bus.ts'
import { dropCoordinatesSnapped, getCardScale } from '@/game/utils.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { CardAttrs, RegionCategory, DragAttrs } from '@/game/types.ts'
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
        const otherCards = cardRegion.cards.filter(c => c.oid !== cardRef.value.oid)

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
     * Dragging
     */

    // Track if we're currently dragging this card
    const dragAttrs: DragAttrs = reactive({
        isDragging: false,
        x: 0,
        y: 0,
        deltaX: 0,
        deltaY: 0,
        scale: cardAttrsRef.value.scale,
    })

    function onDragStart(originCard?: Card) {
        // Spectators can't interact with the game
        if (gameState.isSpectator) {
            return
        }

        dragAttrs.isDragging = true
        dragAttrs.x = cardAttrsRef.value.x
        dragAttrs.y = cardAttrsRef.value.y
        // Delta is used only for multi-card drag. Else default to 0 and have no effect
        dragAttrs.deltaX = dragAttrs.x - (originCard?.x ?? dragAttrs.x)
        dragAttrs.deltaY = dragAttrs.y - (originCard?.y ?? dragAttrs.y)
        dragAttrs.scale = cardAttrsRef.value.scale

        bringToTop()
    }

    function onDrag(pointer: Pointer, dragX: number, dragY: number) {
        const cardAttrs = cardAttrsRef.value

        // Spectators can't interact with the game
        if (gameState.isSpectator || !gameBus.dragOver || !cardAttrs.container) {
            return
        }

        // Default case : not above a region.
        // We use the dragged position and card scale as is.
        let posX = dragX + dragAttrs.deltaX - (cardAttrs.offsetX ?? 0)
        let posY = dragY + dragAttrs.deltaY - (cardAttrs.offsetY ?? 0)
        dragAttrs.scale = cardAttrs.scale

        // Above a region :
        // - override with the scale of the region
        // - snap the position to the grid
        // - display alignment guides
        if (
            gameBus.dragOver.target &&
            gameBus.dragOver.cardRegion &&
            gameBus.dragOver.regionCategory
        ) {
            const cardRegion = gameBus.dragOver.cardRegion

            dragAttrs.scale = getCardScale(gameBus.dragOver.regionCategory, cardRegion)

            const isOverPlayArea = gameBus.dragOver.regionCategory == RegionCategory.Table
            const fromContainer = gameBus.dragOver.cardImage.parentContainer
            const toContainer = gameBus.dragOver.target.parentContainer

            // Difference between the origin and target container
            const offsetX = toContainer.x - cardAttrs.container.x
            const offsetY = toContainer.y - cardAttrs.container.y

            // Position in the container referential
            let localX = posX - offsetX
            let localY = posY - offsetY

            // Over playArea from outside ( hand, stack, another playArea ).
            if (isOverPlayArea && fromContainer != toContainer) {
                // Find closest x/y coords centered around the pointer
                const dropCoord = dropCoordinatesSnapped(
                    pointer,
                    toContainer as GameObjects.Container,
                )
                localX = dropCoord.x + dragAttrs.deltaX
                localY = dropCoord.y + dragAttrs.deltaY
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

            posX = localX + offsetX
            posY = localY + offsetY
        }

        dragAttrs.x = posX
        dragAttrs.y = posY
    }

    function onDragEnd() {
        dragAttrs.isDragging = false
        dragAttrs.deltaX = 0
        dragAttrs.deltaY = 0
        dragAttrs.scale = cardAttrsRef.value.scale
    }

    /**
     * Drop on new position
     */

    function onDrop() {
        const card = cardRef.value
        const cardAttrs = cardAttrsRef.value
        // Not dropped on any region, abort
        if (
            !cardAttrs.container ||
            !gameBus.dragOver ||
            !gameBus.dragOver.target ||
            !gameBus.dragOver.cardRegion
        ) {
            return
        }

        const targetCardRegion = gameBus.dragOver.cardRegion
        const fromContainer = gameBus.dragOver.cardImage.parentContainer
        const toContainer = gameBus.dragOver.target.parentContainer

        let [x, y] = [dragAttrs.x, dragAttrs.y]
        // If we're changing container, we need to switch referential
        if (fromContainer != toContainer) {
            const worldPoint = fromContainer.getWorldTransformMatrix().transformPoint(x, y)
            const localPoint = toContainer.getLocalPoint(worldPoint.x, worldPoint.y)
            x = localPoint.x
            y = localPoint.y
        }

        // const toContainer = droppedOn.parentContainer
        // Compute new card position in the target container referential
        // const coord = dropCoordinatesSnapped(pointer, toContainer)

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
