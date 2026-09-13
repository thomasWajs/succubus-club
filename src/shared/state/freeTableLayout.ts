import { Point2D } from '@/shared/types/model.ts'
import { Player } from '@/shared/model/Player.ts'
import {
    CARD_HEIGHT,
    CARD_IN_PLAY_BASE_SCALE,
    CARD_WIDTH,
    FREE_TABLE_CRYPT_CARDS_MARGIN,
    FREE_TABLE_CRYPT_CARDS_SPACING,
    FREE_TABLE_HEIGHT,
    FREE_TABLE_LAYOUT_RADIUS,
    FREE_TABLE_PERIMETER_MARGIN,
    FREE_TABLE_WIDGET_RADIUS,
    FREE_TABLE_WIDTH,
    GRID_SIZE,
} from '@/shared/const/game.ts'

const CENTER_X = FREE_TABLE_WIDTH / 2
const CENTER_Y = FREE_TABLE_HEIGHT / 2
const MARGIN = FREE_TABLE_PERIMETER_MARGIN
// The center of the polygon players' seats are laid out around - exported so
// other layout-aware code ( e.g. the Free Table camera's rotate control ) can
// pivot around the same point rather than re-deriving it.
export const PLAY_AREA_CENTER: Point2D = { x: CENTER_X, y: CENTER_Y }

/**
 * The `sides` points of a regular polygon inscribed in the layout ellipse,
 * used to derive seat anchors for 3+ players ( see polygonEdgeAnchor ).
 * Vertices are offset by half a step from the seats themselves, so that
 * polygon *edges* - not vertices - line up with seats : e.g. for a pentagon,
 * the edge between vertex(4) and vertex(0) is symmetric about angle 0
 * ( south ), matching seat 0.
 *
 * The x sign is mirrored ( -sin instead of +sin ) so that increasing seat
 * index goes clockwise around the table : each player's prey ( seat index +
 * 1, see Player.prey ) then sits to their left and their predator ( seat
 * index - 1 ) to their right, matching the V:TES seating convention.
 */
function getPolygonVertices(sides: number, radius: number): Point2D[] {
    const vertices: Point2D[] = []
    for (let j = 0; j < sides; j++) {
        const angle = (j + 0.5) * ((2 * Math.PI) / sides)
        vertices.push({
            x: CENTER_X - radius * Math.sin(angle),
            y: CENTER_Y + radius * Math.cos(angle),
        })
    }
    return vertices
}

function midpoint(a: Point2D, b: Point2D): Point2D {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/**
 * Rotation ( Phaser convention : positive = clockwise on screen ) that makes
 * a widget/card sitting at `point` face the table center : e.g. a point due
 * south of center gets rotation 0 ( already "facing up" ), due north gets PI
 * ( upside down ), due east gets -PI/2, etc.
 */
export function computeFacingRotation(point: Point2D, center: Point2D): number {
    return Math.atan2(center.x - point.x, point.y - center.y)
}

/**
 * Rotate a point ( typically an offset relative to some local origin, e.g. a
 * PlayerWidget's center ) by `rotation`, using the same convention as
 * computeFacingRotation / Phaser's own GameObject.rotation. Used to turn a
 * "local to the widget" layout offset into a world-space one, once the
 * widget itself has a nonzero rotation.
 */
export function rotatePoint(point: Point2D, rotation: number): Point2D {
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    return {
        x: point.x * cos - point.y * sin,
        y: point.x * sin + point.y * cos,
    }
}

/**
 * Rotate `point` by `rotation` around `pivot` ( rather than the origin, see
 * rotatePoint ) - used to keep some anchor ( an overlay, a group icon, an
 * alignment guide endpoint ) glued to a card/group/region that's itself been
 * rotated in place around that same pivot. Leaves `point` untouched when
 * `rotation` is 0 ( the common case outside Free Table ).
 */
export function rotateAroundPivot(point: Point2D, pivot: Point2D, rotation: number): Point2D {
    if (!rotation) {
        return point
    }
    const offset = rotatePoint({ x: point.x - pivot.x, y: point.y - pivot.y }, rotation)
    return { x: pivot.x + offset.x, y: pivot.y + offset.y }
}

/**
 * Half-width/half-height of the axis-aligned bounding box of a `halfWidth` x
 * `halfHeight` rectangle once rotated by `rotation` - i.e. how much screen-
 * space extent a rotated rectangle ( a camera viewport, a seats bounding box )
 * actually occupies on each axis, so it can be fit/clamped against an
 * unrotated boundary.
 */
export function rotatedAabbHalfExtents(
    halfWidth: number,
    halfHeight: number,
    rotation: number,
): { halfWidth: number; halfHeight: number } {
    const cos = Math.abs(Math.cos(rotation))
    const sin = Math.abs(Math.sin(rotation))
    return {
        halfWidth: halfWidth * cos + halfHeight * sin,
        halfHeight: halfWidth * sin + halfHeight * cos,
    }
}

/**
 * Position of the `slot`-th face-down crypt card in a player's widget-local
 * row on the shared Free Table : a horizontal row running out from the right
 * of the widget's disc, centered on the disc's vertical middle so the first
 * card hugs the circle's edge, laid out in the widget's own local ( unrotated )
 * frame then rotated into world space by the widget's facing rotation - so the
 * row stays "to the right" of the widget from its own point of view. Shared by
 * initial setup ( which fills slots 0.. INITIAL_UNCONTROLLED_SIZE - 1 ) and
 * crypt draws ( which pick the first free slot ), so the two always agree on
 * the same grid.
 *
 * The returned point is already shifted back by half the ( unrotated ) card
 * size, matching CardGO.vue's re-centering of card.x/y - see setup.ts.
 */
export function freeTableCryptSlotPosition(player: Player, slot: number): Point2D {
    const cardHeight = CARD_HEIGHT * CARD_IN_PLAY_BASE_SCALE
    const cardWidth = CARD_WIDTH * CARD_IN_PLAY_BASE_SCALE
    const firstCardLocalX = FREE_TABLE_WIDGET_RADIUS + FREE_TABLE_CRYPT_CARDS_MARGIN + cardWidth / 2
    const cardsSpacing = FREE_TABLE_CRYPT_CARDS_SPACING * GRID_SIZE
    const localX = firstCardLocalX + cardsSpacing * slot

    const offset = rotatePoint({ x: localX, y: 0 }, player.widgetRotation)
    return {
        x: player.widgetPosition.x + offset.x - cardWidth / 2,
        y: player.widgetPosition.y + offset.y - cardHeight / 2,
    }
}

/**
 * Seat anchor for 3+ players, one per edge of a regular `sides`-gon ( a
 * triangle for 3, a square for 4, a pentagon for 5, ... ) inscribed in the
 * layout ellipse - `sides` always equals the player count, so every seat is
 * used and edges spread the players evenly.
 */
function polygonEdgeAnchor(
    sides: number,
    seatIndex: number,
): { point: Point2D; outwardNormal: Point2D } {
    const radius = FREE_TABLE_LAYOUT_RADIUS[sides]
    const vertices = getPolygonVertices(sides, radius)
    const v1 = vertices[(seatIndex + sides - 1) % sides]
    const v2 = vertices[seatIndex]
    const point = midpoint(v1, v2)

    // Use the edge's own outward normal - rather than the line from the edge
    // midpoint to the center - so the widget's back stays parallel to its edge.
    const edge = { x: v2.x - v1.x, y: v2.y - v1.y }
    let outwardNormal = { x: -edge.y, y: edge.x }
    const towardPoint = { x: point.x - CENTER_X, y: point.y - CENTER_Y }
    if (outwardNormal.x * towardPoint.x + outwardNormal.y * towardPoint.y < 0) {
        outwardNormal = { x: -outwardNormal.x, y: -outwardNormal.y }
    }
    return { point, outwardNormal }
}

/**
 * Seat anchor for 1-2 players, placed directly on the layout ellipse's
 * north/south axis rather than a polygon edge ( a polygon isn't meaningful
 * below 3 sides ) : 1 player sits south of center ; 2 players sit
 * face-to-face, south and north.
 */
function axisAnchor(
    playerCount: number,
    seatIndex: number,
): { point: Point2D; outwardNormal: Point2D } {
    const radius = FREE_TABLE_LAYOUT_RADIUS[playerCount]
    const angle = playerCount === 2 ? seatIndex * Math.PI : 0
    const outwardNormal = { x: Math.sin(angle), y: Math.cos(angle) }
    const point = {
        x: CENTER_X + radius * outwardNormal.x,
        y: CENTER_Y + radius * outwardNormal.y,
    }
    return { point, outwardNormal }
}

/**
 * Deterministic anchor position and facing rotation for a seat's
 * PlayerWidget, given the total player count and that seat's index. Seats
 * are spread across a shape suited to the player count - face-to-face for 2,
 * a triangle for 3, a square for 4, a pentagon for 5 - with the widget's
 * center at the shape's edge midpoint ( inset by MARGIN ), facing the
 * table center.
 *
 * Computed once, in shared setup ( setupMultiplayerGameState ), and stored on
 * Player.widgetPosition / Player.widgetRotation rather than re-derived
 * client-side : the initial crypt cards are placed relative to this anchor,
 * so every client must agree on it from the start.
 */
export function computePerimeterLayout(
    playerCount: number,
    seatIndex: number,
): { position: Point2D; rotation: number } {
    const { point, outwardNormal } =
        playerCount <= 2 ?
            axisAnchor(playerCount, seatIndex)
        :   polygonEdgeAnchor(playerCount, seatIndex)

    const rotation = computeFacingRotation(
        { x: CENTER_X + outwardNormal.x, y: CENTER_Y + outwardNormal.y },
        PLAY_AREA_CENTER,
    )
    // Widget center = edge midpoint, inset by MARGIN towards the table center.
    const toWidgetCenter = rotatePoint({ x: 0, y: -MARGIN }, rotation)
    const position = { x: point.x + toWidgetCenter.x, y: point.y + toWidgetCenter.y }

    return { position, rotation }
}
