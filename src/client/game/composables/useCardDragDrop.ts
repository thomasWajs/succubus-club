import { Card, LibraryCard, Minion } from '@/shared/model/Card.ts'
import { ComputedRef, reactive, Ref } from 'vue'
import Phaser from 'phaser'
import { CardMovement, gameMutations } from '@/shared/state/gameMutations.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import {
    dilateRectangle,
    dropCoordinates,
    getCardRectangle,
    getCardRectangleAt,
    getCardScale,
} from '@/client/game/utils.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { CardAttrs, CardGroup, DragAttrs, RegionCategory } from '@/client/game/types.ts'
import { AlignmentGuide, GUIDE_HORIZONTAL, GUIDE_VERTICAL } from '@/shared/types/state.ts'
import { ALIGNMENT_GUIDE_THRESHOLD, GRID_SIZE } from '@/shared/const/game.ts'
import { AnyCardRegion } from '@/shared/types/model.ts'
import { Snap } from '@/shared/utils.ts'
import { useUIFeatures } from '@/client/game/composables/useUIFeatures.ts'
import { declareActionCardFromHand, playCard } from '@/client/game/declaration.ts'
import { ACTION_TYPES } from '@/shared/const/model.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import Pointer = Phaser.Input.Pointer
import Rectangle = Phaser.Geom.Rectangle

export function useCardDragDrop(
    cardRef: Ref<Card>,
    cardAttrsRef: ComputedRef<CardAttrs>,
    bringToTop: VoidFunction,
) {
    const gameState = useGameStateStore()
    const players = usePlayersStore()
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
     * Proximity detection
     */

    // Among `candidates`, the card whose rectangle overlaps the most with the
    // dragged card at (posX, posY) expressed in the region referential. Shared
    // by card grouping and action-declaration drop detection.
    function findCardByProximity<T extends Card>(
        cardRegion: AnyCardRegion,
        posX: number,
        posY: number,
        candidates: T[],
    ): T | null {
        let cardRectangle = getCardRectangleAt(cardRegion, posX, posY)
        // Dilate by 1px to also detect cards that are exactly on the border.
        cardRectangle = dilateRectangle(cardRectangle, 1)
        let maxAreaIntersection = 0
        let cardCandidate: T | null = null
        for (const otherCard of candidates) {
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

        return cardCandidate
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
            cardRegion.owner.oid != players.selfPlayer?.oid ||
            !cardRegion.is.ready ||
            gameBus.selectedCards.length > 1 ||
            card.oid in gameBus.cardGroupsByCard ||
            otherCards.length === 0
        ) {
            return null
        }

        const cardCandidate = findCardByProximity(cardRegion, posX, posY, otherCards)
        if (cardCandidate) {
            const existing = gameBus.cardGroupsByCard[cardCandidate.oid]
            return existing ?? new Set([cardCandidate.oid])
        }

        return null
    }

    /**
     * Action declaration by drag
     *
     * Dragging one of our action cards out of hand and dropping it onto one of
     * our minions declares an action with that minion & card, instead of just
     * moving the card. While such a drag is in progress, card grouping is
     * suppressed in favour of the acting-minion hint.
     */

    const { actionDeclarationEnabled } = useUIFeatures()

    // The dragged card when it is one of our action cards being dragged from
    // hand, or null otherwise.
    function draggedActionCard(): LibraryCard | null {
        const card = cardRef.value
        if (
            actionDeclarationEnabled.value &&
            !gameState.action &&
            !gameState.combat &&
            card instanceof LibraryCard &&
            !!card.type &&
            ACTION_TYPES.includes(card.type) &&
            card.region == card.controller.hand &&
            card.controller.oid == players.selfPlayer?.oid
        ) {
            return card
        }
        return null
    }

    function findActingMinionCandidate(
        cardRegion: AnyCardRegion,
        posX: number,
        posY: number,
    ): Minion | null {
        // Acting minions can only be our own ready, unlocked minions.
        if (
            !cardRegion.owner ||
            cardRegion.owner.oid != players.selfPlayer?.oid ||
            !cardRegion.is.ready
        ) {
            return null
        }

        const minions = cardRegion.cards.filter((c): c is Minion => c.isMinion() && !c.isLocked)
        return findCardByProximity(cardRegion, posX, posY, minions)
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
        if (players.isSpectator) {
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
        gameBus.actingMinionCandidate = null
        if (!originCard || card == originCard) {
            gameBus.dragAttrs = dragAttrs
        }

        bringToTop()
    }

    function onDrag(pointer: Pointer, dragX: number, dragY: number, originDragAttrs?: DragAttrs) {
        const card = cardRef.value
        const cardAttrs = cardAttrsRef.value

        // Spectators can't interact with the game
        if (!dragAttrs.isDragging || players.isSpectator || !gameBus.dragOver) {
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

        const regionCategory = gameBus.dragOver.regionCategory

        // Above a region :
        // - override with the scale of the region
        // - snap the position to the grid
        // - display alignment guides
        // - search for a card group candidate
        if (
            gameBus.dragOver.gameObjects.target &&
            gameBus.dragOver.cardRegion &&
            regionCategory &&
            regionCategory != RegionCategory.WieldCardStack
        ) {
            const ui = useUIFeatures()
            const cardRegion = gameBus.dragOver.cardRegion
            const fromContainer = gameBus.dragOver.gameObjects.cardImage.parentContainer
            const toContainer = gameBus.dragOver.gameObjects.target.parentContainer

            const rawCardScale = getCardScale(regionCategory, cardRegion)
            const scaleRatio = toContainer.scale / fromContainer.scale

            dragAttrs.cardScale = rawCardScale * scaleRatio

            // The preview image (CardGO) lives in the source container but must render at
            // the destination size. It is drawn centered at
            //   dragAttrs.x + cardAttrs.offsetX * scaleRatio
            // where cardAttrs.offsetX is the SOURCE half-card. To land the DESTINATION
            // half-card there ( keeping the card centered on the pointer ), the multiplier
            // must be dest/source card scale, whatever the target region ( play area, hand,
            // stack... ). cardScale already folds in the container ratio, so this is simply
            // cardScale / source scale.
            dragAttrs.scaleRatio = dragAttrs.cardScale / cardAttrs.scale

            // Position in the target container referential.
            // Moving a table card within its own region : keep the grab offset so the
            // card follows the pointer from where it was picked up (no jump). In every
            // other case ( changing region, stacks, hand... ) center it on the pointer.
            // Table and Stack regions additionally snap to the grid.
            const isSameRegion = cardRegion.oid == card.region.oid
            const snapToGrid =
                ui.snapToGrid.value &&
                (regionCategory == RegionCategory.Table || regionCategory == RegionCategory.Stack)

            let localX, localY
            if (regionCategory == RegionCategory.Table && isSameRegion) {
                localX = posX
                localY = posY
            } else {
                const dropCoord = dropCoordinates(
                    pointer,
                    toContainer,
                    rawCardScale,
                    card.isLocked,
                    snapToGrid,
                )
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
            if (snapToGrid && regionCategory == RegionCategory.Table) {
                localX = Snap.to(localX, GRID_SIZE)
                localY = Snap.ceil(localY, GRID_SIZE)
            }

            // Dragging an action card from hand onto a minion declares an
            // action : highlight the acting-minion candidate and suppress the
            // card group outline. Otherwise, look for a card group candidate.
            if (draggedActionCard()) {
                gameBus.actingMinionCandidate = findActingMinionCandidate(
                    cardRegion,
                    localX,
                    localY,
                )
                gameBus.cardGroupCandidate = null
            } else {
                gameBus.cardGroupCandidate = findCardGroupCandidate(cardRegion, localX, localY)
                gameBus.actingMinionCandidate = null
            }

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
        gameBus.actingMinionCandidate = null
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

        // Declaring an action : an action card dropped onto one of our minions
        // declares the action ( which plays the card ) rather than moving it.
        const actionCard = draggedActionCard()
        if (actionCard && gameBus.actingMinionCandidate) {
            declareActionCardFromHand(gameBus.actingMinionCandidate, actionCard)
            gameBus.actingMinionCandidate = null
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
            if (position == card.position && targetCardRegion.oid == card.region.oid) {
                return
            }
            movement = { card, position }
        } else {
            // coords did not change, do nothing
            if (x == card.x && y == card.y && targetCardRegion.oid == card.region.oid) {
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
                playCard({ card, movement })
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
