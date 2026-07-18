import {
    CARD_HEIGHT,
    CARD_IN_HAND_SCALE,
    CARD_IN_PLAY_BASE_SCALE,
    CARD_IN_STACK_SCALE,
    CARD_WIDTH,
    DEFAULT_PLAYER_SCALE,
    GRID_SIZE,
    WIELD_CARD_SCALE,
} from '@/shared/const/game.ts'
import Phaser, { GameObjects } from 'phaser'
import { PhaserDataKey, RegionCategory } from '@/client/game/types.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { Card } from '@/shared/model/Card.ts'
import { getTabletopScene } from '@/client/game/camera.ts'
import { AnyCardRegion } from '@/shared/types/model.ts'
import { Snap } from '@/shared/utils.ts'
import { Player } from '@/shared/model/Player.ts'
import Pointer = Phaser.Input.Pointer
import Rectangle = Phaser.Geom.Rectangle

/**
 * Given x,y on screen, return the corresponding world coordinates.
 * Will take into account camera zoom ( display.scale ) + camera scroll.
 * Useful to convert pointer coordinates to game coordinates.
 */
export function getWorldPoint(x: number, y: number) {
    return getTabletopScene().cameras.main.getWorldPoint(x, y)
}

/**
 * Given x,y into the world, return the corresponding screen coordinates.
 * Will take into account camera zoom ( display.scale ) + camera scroll.
 * Useful to convert game coordinates into screen position.
 *
 * This is the inverse operation of camera.getWorldPoint(),
 * which surprinsignly does not exist in Phaser,
 * so let's do some math !
 */
export function getScreenPoint(x: number, y: number) {
    const camera = getTabletopScene().cameras.main

    // @ts-expect-error - rotation is private but needed for coordinate transformation
    const { rotation, zoom, scrollX, scrollY } = camera
    // @ts-expect-error - matrix is private but needed for coordinate transformation
    const matrix = camera.matrix.matrix

    const mva = matrix[0]
    const mvb = matrix[1]
    const mvc = matrix[2]
    const mvd = matrix[3]
    const mve = matrix[4]
    const mvf = matrix[5]

    const determinant = mva * mvd - mvb * mvc

    if (!determinant) {
        return { x, y }
    }

    const sx = mva * x + mvc * y + mve
    const sy = mvb * x + mvd * y + mvf

    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)

    return {
        x: sx - (scrollX * cos - scrollY * sin) * zoom,
        y: sy - (scrollX * sin + scrollY * cos) * zoom,
    }
}

/**
 * Compute the adjusted card index and virtual list length for gap-based reordering.
 * Used for both hand and wield card stack to produce the visual gap effect while dragging.
 */
export function reorderCardIndex(
    cardIndex: number,
    targetListLength: number,
    dropGapPosition: number | null,
    draggedCardPosition: number | null,
): { index: number; length: number } {
    let offset = 0
    let length = targetListLength
    // When dragging any card into the target list,
    // display the card at its position after drop
    if (dropGapPosition !== null) {
        length++
        if (cardIndex >= dropGapPosition) offset++
    }
    // When the dragged card comes from the target list, remove it from calculations
    if (draggedCardPosition !== null) {
        length--
        if (cardIndex > draggedCardPosition) offset--
    }
    return { index: cardIndex + offset, length }
}

export function dropCoordinates(
    pointer: Pointer,
    toContainer: GameObjects.Container,
    centerWithScale?: number,
    isLocked = false,
    snap = false,
) {
    if (!pointer || !toContainer) {
        return { x: 0, y: 0 }
    }

    const worldPoint = getWorldPoint(pointer.x, pointer.y)
    let { x, y } = toContainer.getLocalPoint(worldPoint.x, worldPoint.y)

    // Keep the card centered on the pointer.
    if (centerWithScale) {
        const halfWidth = ((isLocked ? CARD_HEIGHT : CARD_WIDTH) / 2) * centerWithScale
        const halfHeight = ((isLocked ? CARD_WIDTH : CARD_HEIGHT) / 2) * centerWithScale
        x = x - halfWidth
        y = y - halfHeight
    }

    if (snap) {
        x = Snap.to(x, GRID_SIZE)
        y = Snap.to(y, GRID_SIZE)
    }

    return { x, y }
}

export function positionContextMenu(
    x: number,
    top: number,
    bottom: number,
    selector: string,
    set: (x: number, y: number) => void,
) {
    // Get window dimensions
    const windowHeight = window.innerHeight

    let y = top
    const tempX = x
    const tempY = y

    // Temporarily show submenu off-screen to measure its height
    set(-9999, -9999)

    // Wait for next tick to measure
    setTimeout(() => {
        const submenuElement = document.querySelector<HTMLElement>(selector)
        const submenuHeight = submenuElement?.offsetHeight || 200

        // Reset temporary values
        x = tempX
        y = tempY

        // Check if submenu would overflow bottom of window
        if (y + submenuHeight > windowHeight) {
            // Position submenu to align its bottom with the button's bottom
            y = bottom - submenuHeight
        }

        // If submenu overflows the top, clamp it to the top of the window
        if (y < 0) {
            y = 0
        }

        set(x, y)
    }, 0)
}

export function getCardDragged(cardImage: GameObjects.Image): Card | undefined {
    const gameState = useGameStateStore()

    const cardOid = cardImage.getData(PhaserDataKey.CardOid)
    if (!cardOid) {
        return undefined
    }
    return gameState.cards[cardOid]
}

export function getCardRegionDraggedOver(dragTarget: GameObjects.GameObject) {
    const gameState = useGameStateStore()

    const cardRegionOid = dragTarget.getData(PhaserDataKey.CardRegionOid)
    if (!cardRegionOid) {
        return null
    }

    const cardRegion = gameState.cardRegions[cardRegionOid]
    // Dropped on a region that doesn't exist in the game state, that should never happen
    if (!cardRegion) {
        throw new Error(`onDrag: card region not found for oid ${cardRegion}`)
    }

    return cardRegion
}

export function getRegionScale(cardRegion: AnyCardRegion) {
    /*return cardRegion?.owner?.scale ?? DEFAULT_PLAYER_SCALE*/
    return cardRegion?.is.ready ? (cardRegion?.owner?.scale ?? DEFAULT_PLAYER_SCALE) : 1
}

export function getCardScale(category: RegionCategory, cardRegion?: AnyCardRegion): number {
    switch (category) {
        case RegionCategory.Table:
            return (
                CARD_IN_PLAY_BASE_SCALE *
                (cardRegion ? getRegionScale(cardRegion) : DEFAULT_PLAYER_SCALE)
            )
        case RegionCategory.Stack:
            return CARD_IN_STACK_SCALE
        case RegionCategory.Hand:
            return CARD_IN_HAND_SCALE
        case RegionCategory.WieldCardStack:
            return WIELD_CARD_SCALE
    }
}

export function dilateRectangle(rect: Rectangle, dilatation: number) {
    return new Rectangle(
        rect.x - dilatation,
        rect.y - dilatation,
        rect.width + dilatation * 2,
        rect.height + dilatation * 2,
    )
}

// Returns the rectangle occupied by a card on the play Area
// In local coordinates
export function getCardRectangleAt(cardRegion: AnyCardRegion, x: number, y: number) {
    const scale = getCardScale(RegionCategory.Table, cardRegion)
    return new Rectangle(x, y, CARD_WIDTH * scale, CARD_HEIGHT * scale)
}

// Transform a card in play into the rectangle that it occupies on the Play Area
// In local coordinates
export function getCardRectangle(card: Card) {
    return getCardRectangleAt(card.region, card.x, card.y)
}

export function getOverlappingCards(card: Card) {
    const overlappingCards: Card[] = []
    const rectangle = getCardRectangle(card)
    const otherCards = card.region.cards.filter(c => c.oid != card.oid)
    for (const otherCard of otherCards) {
        if (Rectangle.Overlaps(rectangle, getCardRectangle(otherCard))) {
            overlappingCards.push(otherCard)
        }
    }
    return overlappingCards
}

export function getPlayerColor(player: Player) {
    return Phaser.Display.Color.RGBStringToColor(player.rgbaColor)
}
