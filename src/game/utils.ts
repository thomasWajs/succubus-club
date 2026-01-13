import {
    CARD_HEIGHT,
    CARD_IN_HAND_SCALE,
    CARD_IN_PLAY_BASE_SCALE,
    CARD_WIDTH,
    DEFAULT_PLAYER_SCALE,
    GRID_SIZE,
    WIELD_CARD_SCALE,
} from '@/game/const.ts'
import Phaser, { GameObjects } from 'phaser'
import { PhaserDataKey, RegionCategory } from '@/game/types.ts'
import { AnyCardRegion, CardRegionOid } from '@/model/CardRegion.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { Card, CardOid } from '@/model/Card.ts'
import { getTabletopScene } from '@/game/camera.ts'
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

export function dropCoordinates(pointer: Pointer, toContainer: GameObjects.Container) {
    if (!pointer || !toContainer) {
        return { x: 0, y: 0 }
    }
    const worldPoint = getWorldPoint(pointer.x, pointer.y)
    return toContainer.getLocalPoint(worldPoint.x, worldPoint.y)
}

export function dropCoordinatesSnapped(pointer: Pointer, toContainer: GameObjects.Container) {
    const coord = dropCoordinates(pointer, toContainer)

    // Snap the center of the card to the grid
    return {
        x: Phaser.Math.Snap.To(
            coord.x - (CARD_WIDTH / 2) * CARD_IN_PLAY_BASE_SCALE * toContainer.scaleX,
            GRID_SIZE,
        ),
        y: Phaser.Math.Snap.Ceil(
            coord.y - (CARD_HEIGHT / 2) * CARD_IN_PLAY_BASE_SCALE * toContainer.scaleY,
            GRID_SIZE,
        ),
    }
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

    const cardOid = cardImage.getData(PhaserDataKey.CardOid) as CardOid
    if (!cardOid) {
        return undefined
    }
    return gameState.cards[cardOid]
}

export function getCardRegionDraggedOver(dragTarget: GameObjects.GameObject) {
    const gameState = useGameStateStore()

    const cardRegionOid = dragTarget.getData(PhaserDataKey.CardRegionOid) as CardRegionOid
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
    return cardRegion?.owner.scale ?? DEFAULT_PLAYER_SCALE
    // return cardRegion?.is.ready ? cardRegion?.owner.scale : 1
}

export function getCardScale(category: RegionCategory, cardRegion?: AnyCardRegion): number {
    switch (category) {
        case RegionCategory.Table: {
            return (
                CARD_IN_PLAY_BASE_SCALE *
                (cardRegion ? getRegionScale(cardRegion) : DEFAULT_PLAYER_SCALE)
            )
        }
        case RegionCategory.Hand:
            return CARD_IN_HAND_SCALE
        case RegionCategory.Stack:
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
export function getCardRectangleAt(cardRegion: AnyCardRegion, x: number, y: number) {
    const scale = getCardScale(RegionCategory.Table, cardRegion)
    return new Rectangle(x, y, CARD_WIDTH * scale, CARD_HEIGHT * scale)
}

// Transform a card in play into the rectangle that it occupies on the Play Area
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
