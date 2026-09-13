import {
    CARD_HEIGHT,
    CARD_IN_HAND_SCALE,
    CARD_IN_PLAY_BASE_SCALE,
    CARD_IN_STACK_SCALE,
    CARD_WIDTH,
    DEFAULT_PLAYER_SCALE,
    FREE_TABLE_HEIGHT,
    FREE_TABLE_WIDTH,
    GRID_SIZE,
    HORIZONTAL_SEPARATOR_DEFAULT_Y,
    PLAY_AREA_WIDTH,
    PLAYER_BAR_HEIGHT,
    WIELD_CARD_SCALE,
} from '@/shared/const/game.ts'
import Phaser, { GameObjects } from 'phaser'
import { PhaserDataKey, RegionCategory } from '@/client/game/types.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { Card } from '@/shared/model/Card.ts'
import { cameraTick, getTabletopScene } from '@/client/game/camera.ts'
import { AnyCardRegion } from '@/shared/types/model.ts'
import { Snap } from '@/shared/utils.ts'
import { Player } from '@/shared/model/Player.ts'
import Pointer = Phaser.Input.Pointer
import Rectangle = Phaser.Geom.Rectangle

/**
 * Given x,y on screen, return the corresponding world coordinates.
 * Will take into account camera zoom ( display.scale ) + camera scroll.
 * Useful to convert pointer coordinates to game coordinates.
 *
 * Defaults to the main camera, but accepts an explicit one for content that
 * isn't rendered through it - e.g. Free Table's pinned UI camera, which
 * hosts the Hand and the stack browser at a fixed zoom/scroll independent of
 * the main camera's pan/zoom over the shared table.
 */
export function getWorldPoint(x: number, y: number, camera?: Phaser.Cameras.Scene2D.Camera) {
    return (camera ?? getTabletopScene().cameras.main).getWorldPoint(x, y)
}

/**
 * Given x,y into the world, return the corresponding screen coordinates.
 * Will take into account camera zoom ( display.scale ) + camera scroll.
 * Useful to convert game coordinates into screen position.
 *
 * This is the inverse operation of camera.getWorldPoint(),
 * which surprinsignly does not exist in Phaser,
 * so let's do some math !
 *
 * Defaults to the main camera, but accepts an explicit one : in Free Table the
 * Hand and the stack browser render through the pinned UI camera, so their
 * world <-> screen mapping differs from the main ( pannable/zoomable ) one.
 */
export function getScreenPoint(x: number, y: number, camera?: Phaser.Cameras.Scene2D.Camera) {
    // Read-only dependency : Free Table's main camera pans/zooms outside of
    // Vue's reactivity, so this registers the Vue computed calling in here as
    // a dependent of cameraTick, which camera.ts bumps on every pan/zoom.
    void cameraTick.value

    camera ??= getTabletopScene().cameras.main

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
 * The current world-to-screen scale factor : how many screen pixels a single
 * world unit maps to, i.e. the camera's own zoom. In standard mode this is
 * always `display.scale`, since resetCamera() sets the ( fixed ) main
 * camera's zoom to exactly that. Free Table's camera zooms independently of
 * `display.scale` though ( see camera.ts's wheel handler ), so anything
 * converting a card's world-space size/gap into on-screen pixels ( floating
 * actions, the referendum vote boxes, the action drop tooltip... ) must read
 * this instead of `display.scale` directly, or it drifts out of sync with the
 * card's actual on-screen size as soon as the user zooms.
 */
export function getScreenScale(camera?: Phaser.Cameras.Scene2D.Camera) {
    void cameraTick.value
    return (camera ?? getTabletopScene().cameras.main).zoom
}

/**
 * A Game Object's on-screen bounding box : its world bounds ( getBounds() ),
 * with each corner mapped through getScreenPoint(). Free Table's camera can
 * be rotated per player ( see camera.ts ), so an object's screen-space
 * footprint isn't just its world bounds scaled by zoom - this accounts for
 * that rotation too. Still an axis-aligned box on screen : same AABB
 * approximation getBounds() itself already makes for a rotated Game Object
 * in world space.
 */
export function getScreenBounds(
    image: GameObjects.Image,
    camera?: Phaser.Cameras.Scene2D.Camera,
): Rectangle {
    const worldBounds = image.getBounds()
    const corners = [
        getScreenPoint(worldBounds.x, worldBounds.y, camera),
        getScreenPoint(worldBounds.right, worldBounds.y, camera),
        getScreenPoint(worldBounds.x, worldBounds.bottom, camera),
        getScreenPoint(worldBounds.right, worldBounds.bottom, camera),
    ]
    const xs = corners.map(c => c.x)
    const ys = corners.map(c => c.y)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)

    return new Rectangle(minX, minY, Math.max(...xs) - minX, Math.max(...ys) - minY)
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
    snapToGrid = false,
    camera?: Phaser.Cameras.Scene2D.Camera,
) {
    if (!pointer || !toContainer) {
        return { x: 0, y: 0 }
    }

    const worldPoint = getWorldPoint(pointer.x, pointer.y, camera)
    let { x, y } = toContainer.getLocalPoint(worldPoint.x, worldPoint.y)

    // Keep the card centered on the pointer.
    if (centerWithScale) {
        const halfWidth = ((isLocked ? CARD_HEIGHT : CARD_WIDTH) / 2) * centerWithScale
        const halfHeight = ((isLocked ? CARD_WIDTH : CARD_HEIGHT) / 2) * centerWithScale
        x = x - halfWidth
        y = y - halfHeight
    }

    if (snapToGrid) {
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

// A tapped ( locked ) card is rendered rotated 90°, so its true visual
// footprint is CARD_HEIGHT wide / CARD_WIDTH tall instead of the other way
// around - the half-extents to use as the rotation pivot / centering offset
// swap accordingly.
export function cardHalfExtents(
    card: Card,
    scale: number,
): { halfWidth: number; halfHeight: number } {
    const halfWidth = (CARD_WIDTH * scale) / 2
    const halfHeight = (CARD_HEIGHT * scale) / 2
    return card.isLocked ?
            { halfWidth: halfHeight, halfHeight: halfWidth }
        :   { halfWidth, halfHeight }
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

// Overlap above this fraction of a card's own area is too much : the played card
// would sit too hidden behind the one already in place.
const MAX_PLAY_OVERLAP_RATIO = 0.1

// Step and reach of the outward search, in pixels / rings. Kept small so a
// played card stays visibly close to where it was aimed.
const PLAY_SEARCH_STEP = 2 * GRID_SIZE
const PLAY_SEARCH_MAX_RING = 15

/**
 * Where to drop `card` into `cardRegion` when playing it near a target.
 *
 * Starts from ( x0, y0 ) and, when that overlaps existing cards too much,
 * searches outward on the grid for the closest spot with an acceptable overlap,
 * without straying too far from the start nor leaving the play area. Falls back
 * to the clamped start position when nothing better is found.
 */
export function findFreePlayPosition(
    cardRegion: AnyCardRegion,
    card: Card,
    x0: number,
    y0: number,
): { x: number; y: number } {
    const scale = getCardScale(RegionCategory.Table, cardRegion)
    const cardWidth = CARD_WIDTH * scale
    const cardHeight = CARD_HEIGHT * scale
    const cardArea = cardWidth * cardHeight

    // Play area bounds in the region referential : the ready region spans the
    // controlled zone, from its top down to the player's horizontal separator ;
    // the shared Free Table region spans the whole table instead.
    const separatorY = cardRegion.owner?.separators.horizontalY ?? HORIZONTAL_SEPARATOR_DEFAULT_Y
    const maxX =
        cardRegion.is.table ?
            Math.max(0, FREE_TABLE_WIDTH - cardWidth)
        :   Math.max(0, PLAY_AREA_WIDTH - cardWidth)
    const maxY =
        cardRegion.is.table ?
            Math.max(0, FREE_TABLE_HEIGHT - cardHeight)
        :   Math.max(0, separatorY - PLAYER_BAR_HEIGHT - cardHeight)
    const clampX = (x: number) => Math.min(Math.max(x, 0), maxX)
    const clampY = (y: number) => Math.min(Math.max(y, 0), maxY)

    const otherCards = cardRegion.cards.filter(c => c.oid != card.oid)

    // Largest overlap of a card placed at ( x, y ) with any card already in the
    // region, as a fraction of the card's own area.
    function maxOverlapRatio(x: number, y: number): number {
        const rect = new Rectangle(x, y, cardWidth, cardHeight)
        let worst = 0
        for (const other of otherCards) {
            const area = Rectangle.Area(Rectangle.Intersection(rect, getCardRectangle(other)))
            worst = Math.max(worst, area / cardArea)
        }
        return worst
    }

    const startX = clampX(Snap.to(x0, GRID_SIZE))
    const startY = clampY(Snap.to(y0, GRID_SIZE))

    // Expand ring by ring, keeping the closest acceptable spot of the first ring
    // that has one. Ties are broken towards the right, then towards the start
    // row, so played cards spread out rightwards rather than up and to the left.
    let best: { x: number; y: number; distance: number } | null = null
    for (let ring = 0; ring <= PLAY_SEARCH_MAX_RING && !best; ring++) {
        for (let dx = -ring; dx <= ring; dx++) {
            for (let dy = -ring; dy <= ring; dy++) {
                // Only the perimeter of the current ring
                if (ring != 0 && Math.max(Math.abs(dx), Math.abs(dy)) != ring) {
                    continue
                }
                const x = clampX(startX + dx * PLAY_SEARCH_STEP)
                const y = clampY(startY + dy * PLAY_SEARCH_STEP)
                if (maxOverlapRatio(x, y) > MAX_PLAY_OVERLAP_RATIO) {
                    continue
                }
                const distance = (x - startX) ** 2 + (y - startY) ** 2
                if (
                    !best ||
                    distance < best.distance ||
                    (distance === best.distance &&
                        (x > best.x ||
                            (x === best.x && Math.abs(y - startY) < Math.abs(best.y - startY))))
                ) {
                    best = { x, y, distance }
                }
            }
        }
    }

    return best ? { x: best.x, y: best.y } : { x: startX, y: startY }
}

export function getPlayerColor(player: Player) {
    return Phaser.Display.Color.RGBStringToColor(player.rgbaColor)
}
