import { Card, LibraryCard, Minion } from '@/shared/model/Card.ts'
import { ComputedRef, reactive, Ref } from 'vue'
import Phaser from 'phaser'
import { CardMovement, gameMutations } from '@/shared/state/gameMutations.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import {
    cardHalfExtents,
    dilateRectangle,
    dropCoordinates,
    getCardRectangle,
    getCardRectangleAt,
    getCardScale,
    getScreenPoint,
    getWorldPoint,
} from '@/client/game/utils.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { CardAttrs, CardGroup, DragAttrs, RegionCategory } from '@/client/game/types.ts'
import { AlignmentGuide, GUIDE_HORIZONTAL, GUIDE_VERTICAL } from '@/shared/types/state.ts'
import { ALIGNMENT_GUIDE_THRESHOLD, GRID_SIZE } from '@/shared/const/game.ts'
import { AnyCardRegion } from '@/shared/types/model.ts'
import { Snap } from '@/shared/utils.ts'
import { useUIFeatures } from '@/client/game/composables/useUIFeatures.ts'
import { declareActionCardFromHand, playCard } from '@/client/game/declaration.ts'
import { ACTION_TYPES, LibraryCardType } from '@/shared/const/model.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { getFreeTableUICamera, getTabletopScene } from '@/client/game/camera.ts'
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

    // Hand/WieldCardStack render through the pinned UI camera, the table
    // through the main one ( see getFreeTableUICamera ) : conversions/scaling
    // must use whichever camera actually renders the region in question.
    function getRegionCamera(category?: RegionCategory): Phaser.Cameras.Scene2D.Camera {
        if (
            gameState.isFreeTable &&
            (category == RegionCategory.Hand || category == RegionCategory.WieldCardStack)
        ) {
            return getFreeTableUICamera()
        }
        return getTabletopScene().cameras.main
    }

    /**
     * On the shared Free Table, a region has no single owner : restrict
     * comparisons against `card` to cards controlled by the same player. Standard
     * per-player regions are unaffected ( always true there ).
     */
    function isSameTableController(cardRegion: AnyCardRegion, other: Card, card: Card): boolean {
        return !cardRegion.is.table || other.controllerOid == card.controllerOid
    }

    /**
     * Can the self player group with / act through a card sitting in
     * `cardRegion` : their own ready area, or ( Free Table ) anywhere on the
     * shared table since it has no single owner - restricted there to `card`'s
     * own controller.
     */
    function isSelfActionableRegion(cardRegion: AnyCardRegion, card: Card): boolean {
        return (
            (cardRegion.is.ready && cardRegion.owner?.oid == players.selfPlayer?.oid) ||
            (cardRegion.is.table && card.controllerOid == players.selfPlayer?.oid)
        )
    }

    /**
     * Alignment guides
     */

    const { alignmentGuidesEnabled } = useUIFeatures()

    function findAlignmentGuides(
        cardRegion: AnyCardRegion,
        posX: number,
        posY: number,
    ): AlignmentGuide[] {
        const card = cardRef.value
        const guides: AlignmentGuide[] = []
        const otherCards = cardRegion.cards.filter(
            c =>
                !gameBus.selectedCards.includes(c) &&
                !gameBus.indirectSelectedCards.includes(c.oid) &&
                isSameTableController(cardRegion, c, card),
        )

        if (otherCards.length === 0) return guides

        // The rotation shared by `card` and every card in `otherCards`
        // ( guaranteed same controller by the isSameTableController filter above ), same
        // convention as CardGO's ownerFacingRotation. The guide's own line
        // geometry is built below in unrotated table space, matching `card.x`/
        // `card.y` - RegionGO.vue rotates it back for display, to match the
        // rotation actually applied to the cards it aligns with.
        const rotation = card.facingRotation(cardRegion)

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
                rotation,
            })
        }

        if (horizontalCards.length > 0) {
            guides.push({
                type: GUIDE_HORIZONTAL,
                dragX: posX,
                dragY: horizontalCards[0].y,
                scale: cardAttrsRef.value.scale,
                withCards: horizontalCards,
                rotation,
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

        const canGroupHere = isSelfActionableRegion(cardRegion, card)

        const otherCards = cardRegion.cards.filter(
            c => c.oid != card.oid && isSameTableController(cardRegion, c, card),
        )

        // No card grouping possible for multi-drag.
        // No card grouping possible if the card is already in a group
        if (
            !cardGroupingEnabled.value ||
            !canGroupHere ||
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
     * Playing a card onto a minion by drag
     *
     * Dragging one of our cards out of hand and dropping it onto one of our
     * minions plays it with that minion, instead of just moving the card :
     * - an action card ( on our turn, no action in progress ) declares an
     *   action ;
     * - an action modifier ( on our turn ), a reaction ( on someone else's
     *   turn ) or a combat card ( anyone's turn ) is simply played next to the
     *   minion, whether or not an action is in progress.
     * While such a drag is in progress, card grouping is suppressed in favour of
     * the acting-minion hint.
     *
     * Works the same way on the shared Free Table : minions are just cards on
     * `gameState.table`, restricted to our own ( see findDropMinionCandidate ).
     */

    const { actionDeclarationEnabled } = useUIFeatures()

    // The dragged card when it is one of our cards that can be played onto a
    // minion, or null otherwise.
    function draggedMinionCard(): LibraryCard | null {
        const card = cardRef.value
        if (
            !actionDeclarationEnabled.value ||
            !(card instanceof LibraryCard) ||
            !card.type ||
            card.region != card.controller.hand ||
            card.controller.oid != players.selfPlayer?.oid
        ) {
            return null
        }

        const selfActive = gameState.activePlayer == players.selfPlayer

        // Action card : declared as a new action, on our turn, only when no
        // action is already in progress.
        if (
            selfActive &&
            !gameState.action &&
            !gameState.combat &&
            ACTION_TYPES.includes(card.type)
        ) {
            return card
        }
        // Action modifier : played on our turn, with or without an ongoing action.
        if (selfActive && card.type == LibraryCardType.ActionModifier) {
            return card
        }
        // Reaction : played on someone else's turn, with or without an ongoing action.
        if (!selfActive && card.type == LibraryCardType.Reaction) {
            return card
        }
        // Combat card : played on anyone's turn, with or without an ongoing action.
        if (card.type == LibraryCardType.Combat) {
            return card
        }
        return null
    }

    function findDropMinionCandidate(
        cardRegion: AnyCardRegion,
        posX: number,
        posY: number,
    ): Minion | null {
        const card = cardRef.value

        if (!isSelfActionableRegion(cardRegion, card)) {
            return null
        }

        // Declaring an action needs an unlocked minion ; playing an action
        // modifier, a reaction or a combat card can be done with a locked one.
        const requiresUnlocked =
            card instanceof LibraryCard && !!card.type && ACTION_TYPES.includes(card.type)
        // On the shared table, a flipped minion is in torpor ( there is no
        // separate Torpor region there ) and can't be acted through.
        const minions = cardRegion.cards.filter(
            (c): c is Minion =>
                c.isMinion() &&
                (!requiresUnlocked || !c.isLocked) &&
                isSameTableController(cardRegion, c, card) &&
                (!cardRegion.is.table || !c.isFlipped),
        )
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
        gameBus.dropMinionCandidate = null
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
            // Container scale alone ( toContainer.scale / fromContainer.scale below )
            // can't capture the zoom difference between the two Free Table cameras,
            // since neither container is ever scaled - only the camera zoom changes.
            // Without this, a card dragged out of hand keeps its hand size while
            // hovering the table instead of matching the zoomed size it will have
            // once dropped.
            const zoomRatio =
                getRegionCamera(regionCategory).zoom / getRegionCamera(cardAttrs.category).zoom
            const scaleRatio = (toContainer.scale / fromContainer.scale) * zoomRatio

            dragAttrs.cardScale = rawCardScale * scaleRatio

            // The preview ( CardGO ) lives in the source container but renders at
            // the destination size, drawn centered at
            // dragAttrs.x + cardAttrs.offsetX * scaleRatio, where cardAttrs.offsetX
            // is the SOURCE half-card - so scaleRatio must be dest/source scale.
            // cardScale already folds in the container ratio, so this is simply
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
                    getRegionCamera(regionCategory),
                )
                localX = dropCoord.x
                localY = dropCoord.y
            }

            // Trigger the alignment guides in a player's own ready region, or
            // ( Free Table ) on the shared table.
            if (
                alignmentGuidesEnabled.value &&
                cardRegion &&
                (cardRegion.is.ready || cardRegion.is.table)
            ) {
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

            // Dragging a card from hand onto a minion plays it with that minion :
            // highlight the acting-minion candidate and suppress the card group
            // outline. Otherwise, look for a card group candidate.
            if (draggedMinionCard()) {
                gameBus.dropMinionCandidate = findDropMinionCandidate(cardRegion, localX, localY)
                gameBus.cardGroupCandidate = null
            } else {
                gameBus.cardGroupCandidate = findCardGroupCandidate(cardRegion, localX, localY)
                gameBus.dropMinionCandidate = null
            }

            dragAttrs.localX = localX
            dragAttrs.localY = localY

            // Reproject the drop position back into the source container
            // ( where the preview image lives ) via screen space, since source
            // and target may render through different Free Table cameras with
            // different world<->screen mappings ( identity when they match ).
            //
            // Round-trip the card's CENTER, not its corner : re-deriving the
            // center from a rotated corner via a fixed offset only works when
            // source/target camera rotations match, which breaks per-seat
            // rotation on Free Table. The destination-side half-card vector
            // ( destOffsetX/Y ) is applied before crossing into screen space.
            const { halfWidth: destOffsetX, halfHeight: destOffsetY } = cardHalfExtents(
                card,
                rawCardScale,
            )
            const toCamera = getRegionCamera(regionCategory)
            const fromCamera = getRegionCamera(cardAttrs.category)
            const worldPoint = toContainer
                .getWorldTransformMatrix()
                .transformPoint(localX + destOffsetX, localY + destOffsetY)
            const screenPoint = getScreenPoint(worldPoint.x, worldPoint.y, toCamera)
            const fromWorldPoint = getWorldPoint(screenPoint.x, screenPoint.y, fromCamera)
            const dragCenter = fromContainer.getLocalPoint(fromWorldPoint.x, fromWorldPoint.y)

            // Back to a corner in the SOURCE container's local units. Not
            // cardAttrs.offsetX/offsetY - that only exists on table attrs and
            // silently reads 0 for hand/stack. dragAttrs.cardScale is already
            // the preview's destination-scaled size in source-local units.
            const { halfWidth: sourceOffsetX, halfHeight: sourceOffsetY } = cardHalfExtents(
                card,
                dragAttrs.cardScale,
            )
            posX = dragCenter.x - sourceOffsetX
            posY = dragCenter.y - sourceOffsetY
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
        gameBus.dropMinionCandidate = null
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

        // Playing onto a minion : a card dropped onto one of our minions is
        // played with it rather than moved. Action cards declare an action ;
        // action modifiers and reactions are simply played next to the minion.
        const minionCard = draggedMinionCard()
        if (minionCard && minionCard.type && gameBus.dropMinionCandidate) {
            const byMinion = gameBus.dropMinionCandidate
            gameBus.dropMinionCandidate = null
            if (ACTION_TYPES.includes(minionCard.type)) {
                declareActionCardFromHand(byMinion, minionCard)
            } else {
                playCard({ card: minionCard, byMinion })
            }
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
            // Special case for cards played from hand : the standard target is
            // the controller's Ready region ; on the shared Free Table there's
            // no such region, so the target is gameState.table instead.
            const isPlayTarget =
                targetCardRegion == card.controller.ready ||
                (gameState.isFreeTable && targetCardRegion == gameState.table)

            if (card.region == card.controller.hand && isPlayTarget) {
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
