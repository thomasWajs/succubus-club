import { Card, Minion } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { AnyCardRegion } from '@/shared/types/model.ts'
import { Snap } from '@/shared/utils.ts'
import {
    CARD_HEIGHT,
    CARD_IN_PLAY_BASE_SCALE,
    CARD_WIDTH,
    DEFAULT_PLAYER_SCALE,
    FREE_TABLE_HEIGHT,
    FREE_TABLE_WIDTH,
    GRID_SIZE,
    HORIZONTAL_SEPARATOR_DEFAULT_Y,
    PLAY_AREA_WIDTH,
    PLAYER_BAR_HEIGHT,
} from '@/shared/const/game.ts'
import { rotatePoint } from '@/shared/state/freeTableLayout.ts'

/**
 * Where cards in play sit on the table. Pure geometry, shared by the client UI
 * and by the bot referee.
 */

type Rect = { x: number; y: number; width: number; height: number }

export function getRegionScale(cardRegion: AnyCardRegion): number {
    return cardRegion?.is.ready ? (cardRegion?.owner?.scale ?? DEFAULT_PLAYER_SCALE) : 1
}

// Scale of a card in play ( Table category ) in the given region
export function getTableCardScale(cardRegion?: AnyCardRegion): number {
    return (
        CARD_IN_PLAY_BASE_SCALE * (cardRegion ? getRegionScale(cardRegion) : DEFAULT_PLAYER_SCALE)
    )
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

// Overlap above this fraction of a card's own area is too much : the played card
// would sit too hidden behind the one already in place.
const MAX_PLAY_OVERLAP_RATIO = 0.1

// Step and reach of the outward search, in pixels / rings. Kept small so a
// played card stays visibly close to where it was aimed.
const PLAY_SEARCH_STEP = 2 * GRID_SIZE
const PLAY_SEARCH_MAX_RING = 15

function getCardRect(card: Card): Rect {
    const scale = getTableCardScale(card.region)
    return { x: card.x, y: card.y, width: CARD_WIDTH * scale, height: CARD_HEIGHT * scale }
}

function overlapArea(a: Rect, b: Rect): number {
    const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
    const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
    return width > 0 && height > 0 ? width * height : 0
}

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
    const scale = getTableCardScale(cardRegion)
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

    const otherRects = cardRegion.cards.filter(c => c.oid != card.oid).map(getCardRect)

    // Largest overlap of a card placed at ( x, y ) with any card already in the
    // region, as a fraction of the card's own area.
    function maxOverlapRatio(x: number, y: number): number {
        const rect = { x, y, width: cardWidth, height: cardHeight }
        let worst = 0
        for (const other of otherRects) {
            worst = Math.max(worst, overlapArea(rect, other) / cardArea)
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

// Free Table : there's no per-player Ready region on the shared table. Played
// cards land on gameState.table instead.
export function getPlayRegion(player: Player): AnyCardRegion {
    const gameState = player.gameState
    return gameState.isFreeTable && gameState.table ? gameState.table : player.ready
}

/**
 * Automatic placement of a card being played into `toCardRegion`: near the
 * acting minion ( or a default spot ), nudged by findFreePlayPosition() to avoid
 * sitting on top of cards already in play. The default spot is the center of the
 * player's own mat in standard mode, or their widget on the shared Free Table.
 */
export function getAutoPlayPosition(
    player: Player,
    card: Card,
    toCardRegion: AnyCardRegion,
    byMinion?: Minion,
): { x: number; y: number } {
    const scale = getTableCardScale(toCardRegion)
    const cardHalfWidth = (CARD_WIDTH * scale) / 2
    const cardHalfHeight = (CARD_HEIGHT * scale) / 2

    let x0: number
    let y0: number
    if (byMinion) {
        // True rendered center of the acting minion ( see cardHalfExtents ).
        const { halfWidth: minionHalfWidth, halfHeight: minionHalfHeight } = cardHalfExtents(
            byMinion,
            scale,
        )
        const minionCenterX = byMinion.x + minionHalfWidth
        const minionCenterY = byMinion.y + minionHalfHeight

        // On Free Table, "directly above the minion" is relative to its
        // owner-facing rotation ( ownerFacingRotation ), not the world
        // y-axis - rotate the offset the same way before landing on it in
        // world coordinates. Standard mode has no such rotation.
        const rotation = byMinion.facingRotation()
        const worldOffset = rotatePoint({ x: 0, y: -(minionHalfHeight + cardHalfHeight) }, rotation)

        x0 = minionCenterX + worldOffset.x - cardHalfWidth
        y0 = minionCenterY + worldOffset.y - cardHalfHeight
    } else if (player.gameState.isFreeTable) {
        x0 = player.widgetPosition.x
        y0 = player.widgetPosition.y
    } else {
        x0 = PLAY_AREA_WIDTH / 2 - 4 * GRID_SIZE
        y0 = 8 * GRID_SIZE
    }

    return findFreePlayPosition(toCardRegion, card, x0, y0)
}
