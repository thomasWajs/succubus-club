/*
Interesting dimensions to keep in mind :
CARD_HEIGHT * CARD_IN_PLAY_SCALE / GRID_SIZE = 5
CARD_WIDTH * CARD_IN_PLAY_SCALE = 3.58

So a card in play take exactly 5 grid cells in height, and ~3.5 cells in width.
This allows to align nicely the cards side by side on the y axis,
and have a gap between them in the x axis.
 */

import Phaser from 'phaser'
import Color = Phaser.Display.Color

/**
 * Base constants
 */

export const BLACK = new Color(0, 0, 0)
export const WHITE = new Color(255, 255, 255)

export const OPAQUE_ALPHA = 255
export const TRANSPARENT_ALPHA = 0

export const HIGHLIGHT_YELLOW = new Color(255, 200, 80)

export const HD_WIDTH = 1920
export const HD_HEIGHT = 1080

/**
 * Card in play
 */

export const CARD_HEIGHT = 500
export const CARD_WIDTH = 358

export const CARD_IN_PLAY_SCALE = 0.2
export const CARD_IN_STACK_SCALE = 0.2
export const CARD_IN_HAND_SCALE = 0.4
export const CARD_DRAGGING_ALPHA = 0.7

export const CARD_OUTLINE_THICKNESS = 2
export const CARD_OUTLINE_COLOR_HOVER = HIGHLIGHT_YELLOW
export const CARD_OUTLINE_COLOR_SELECTED = new Color(140, 70, 255)

export const CARD_GLOW_COLOR = new Color(220, 150, 220)
export const CARD_GLOW_INNER_STRENGTH = 0
export const CARD_GLOW_OUTER_STRENGTH = 2
export const CARD_GLOW_TWEEN_OUTER_STRENGTH = 5

/**
 * Play Area Dimensions
 */

export const RIGHT_COLUMN_WIDTH = 342
export const WORLD_WIDTH = HD_WIDTH - RIGHT_COLUMN_WIDTH // 1578 px
export const WORLD_HEIGHT = 1000

export const GRID_SIZE = 20

export const PLAY_AREA_X = GRID_SIZE * 23
export const PLAY_AREA_Y = GRID_SIZE * 10
export const PLAY_AREA_WIDTH = GRID_SIZE * 32
export const CONTROLLED_ZONE_HEIGHT = GRID_SIZE * 18
export const TORPOR_ZONE_HEIGHT = GRID_SIZE * 6
export const CARD_STACKS_Y = CONTROLLED_ZONE_HEIGHT + TORPOR_ZONE_HEIGHT
export const CARD_STACKS_HEIGHT = CARD_IN_STACK_SCALE * CARD_WIDTH + 10

export const HAND_X = PLAY_AREA_X
export const HAND_Y = GRID_SIZE * 40
export const HAND_ARC_ORIGIN_X = PLAY_AREA_WIDTH / 2
export const HAND_ARC_ORIGIN_Y = 450
export const HAND_ARC_RADIUS = HAND_ARC_ORIGIN_Y + 25

export const OTHER_PLAYERS_GUTTER = GRID_SIZE * 1.5
export const OTHER_PLAYERS_SCALE = 0.75

/**
 * Play Area Colors
 */

export const REGION_ALPHA = OPAQUE_ALPHA * 0.75
export const REGION_BACKGROUND_COLOR = new Color(128, 128, 128, REGION_ALPHA)
export const REGION_BACKGROUND_COLOR_DRAG_OVER = new Color(104, 104, 104, REGION_ALPHA)

export const PLAYER_COLORS = {
    purple: new Color(60, 20, 95, 255), // dark purple
    green: new Color(15, 70, 35, 255), // dark emerald green
    crimson: new Color(105, 20, 20, 255), // dark crimson
    azure: new Color(2, 75, 115, 255), // dark azure blue
    amber: new Color(125, 58, 6, 255), // dark amber
}

export const ORDERED_PLAYER_COLORS = [
    PLAYER_COLORS.purple,
    PLAYER_COLORS.azure,
    PLAYER_COLORS.crimson,
    PLAYER_COLORS.green,
    PLAYER_COLORS.amber,
]

/**
 * Selection Area
 */

export const SELECTION_AREA_LINE_THICKNESS = 1
export const SELECTION_AREA_COLOR = HIGHLIGHT_YELLOW

/**
 * Counter
 */

export const COUNTER_RADIUS = 14
export const COUNTER_OUTLINE_THICKNESS = 1
export const COUNTER_OUTLINE_COLOR = BLACK
export const COUNTER_TEXT_STYLE = {
    color: 'black',
    fontStyle: 'bold',
    fontSize: '18px',
}
export const BLOOD_COUNTER_FILL_COLOR = new Color(150, 0, 0)
export const GREEN_COUNTER_FILL_COLOR = new Color(0, 150, 0)

/**
 * Markers
 */

export const MARKER_MARGIN_TOP = 15
export const MARKER_HEIGHT = 20
export const MARKER_WIDTH_PER_CHAR = 8
export const MARKER_PADDING = 10

export const MARKERS_FILL_COLOR = new Color(118, 74, 43, OPAQUE_ALPHA * 0.9)
export const MARKERS_TEXT_STYLE = {
    color: 'black',
    fontStyle: 'bold',
    fontSize: '13px',
}

/**
 * Wield Card Stack
 */

export const WIELD_CARD_STACK_ICON = 'wieldCardStack'

export const WIELD_X = 5
export const WIELD_Y = 0
export const WIELD_INITIAL_HEIGHT = 260
export const WIELD_ACTIONS_WIDTH = 190
export const WIELD_BORDER_COLOR = BLACK
export const WIELD_BACKGROUND_COLOR = REGION_BACKGROUND_COLOR

export const WIELD_CARD_SCALE = 0.45

export const WIELD_SCROLLBAR_HEIGHT = 15
export const WIELD_SCROLLBAR_COLOR = new Color(60, 60, 60)
export const WIELD_SCROLLBAR_ALPHA = 0.6

/**
 * Misc
 */

export const BACK_TEXTURE_CRYPT = 'cardbackCrypt'
export const BACK_TEXTURE_LIB = 'cardbackLibrary'

export const DRAG_DISTANCE_THRESHOLD = 5
