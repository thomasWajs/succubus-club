/*
Interesting dimensions to keep in mind :
CARD_HEIGHT * CARD_IN_PLAY_SCALE / GRID_SIZE = 10
CARD_WIDTH * CARD_IN_PLAY_SCALE / GRID_SIZE = 7.16

But we set default player scale to 1.2, so :
CARD_HEIGHT * CARD_IN_PLAY_SCALE * DEFAULT_PLAYER_SCALE / GRID_SIZE = 12
CARD_WIDTH * CARD_IN_PLAY_SCALE DEFAULT_PLAYER_SCALE / GRID_SIZE = 7.16

So a card in play take exactly 12 grid cells in height, and ~8.5 cells in width (9 with some spacing ).
This allows to align nicely the cards side by side on the y axis,
and have a gap between them in the x axis.
 */

/**
 * Base constants
 */

export const BLACK = 'rgb(0,0,0)'
export const WHITE = 'rgb(255,255,255)'

export const OPAQUE_ALPHA = 255
export const TRANSPARENT_ALPHA = 0

export const HIGHLIGHT_YELLOW = 'rgb(255,200,80)'

export const HD_WIDTH = 1920
export const HD_HEIGHT = 1080

/**
 * Card in play
 */

export const CARD_HEIGHT = 500
export const CARD_WIDTH = 358

export const CARD_IN_PLAY_BASE_SCALE = 0.2
export const CARD_IN_STACK_SCALE = 0.15
export const CARD_IN_HAND_SCALE = 0.4
export const DEFAULT_PLAYER_SCALE = 1.2

export const CARD_DRAGGING_ALPHA = 0.7

export const CARD_OUTLINE_THICKNESS = 2
export const CARD_OUTLINE_COLOR_HOVER = HIGHLIGHT_YELLOW
export const CARD_OUTLINE_COLOR_SELECTED = 'rgb(140,70,255)'
export const CARD_OUTLINE_COLOR_INDIRECT_HOVER = 'rgb(255, 228, 169)'

export const CARD_GLOW_COLOR = 'rgb(180,90,40)'
export const CARD_IN_HAND_GLOW_INNER_STRENGTH = 0
export const CARD_IN_HAND_GLOW_OUTER_STRENGTH = 2
export const CARD_IN_PLAY_GLOW_INNER_STRENGTH = 0
export const CARD_IN_PLAY_GLOW_OUTER_STRENGTH = 3

export const CARD_PING_DURATION = 2000 // Total duration of the ping animation in ms
export const CARD_PING_NB_BEATS = 4 // Number of ping beats
export const CARD_PING_COLOR = 'rgb(152,32,56)'

/**
 * Play Area Dimensions
 */

export const GRID_SIZE = 10 // 10 px

export const RIGHT_COLUMN_WIDTH = 342 // column 338px + border 4px = 342px
export const WORLD_WIDTH = HD_WIDTH - RIGHT_COLUMN_WIDTH // 1578 px
export const WORLD_HEIGHT = HD_HEIGHT // 1080 px

export const PLAY_AREA_WIDTH = 64 * GRID_SIZE //640px
export const PLAY_AREA_X = (WORLD_WIDTH - PLAY_AREA_WIDTH) / 2 // 469 px
export const PLAY_AREA_Y = WORLD_HEIGHT * 0.25 + 1 // 271px

export const PLAYER_BAR_HEIGHT = 3 * GRID_SIZE // 30px
export const CONTROLLED_ZONE_HEIGHT = 38 * GRID_SIZE // 380px
export const TORPOR_ZONE_HEIGHT = 12 * GRID_SIZE // 120px
export const TORPOR_ZONE_Y = PLAYER_BAR_HEIGHT + CONTROLLED_ZONE_HEIGHT // 430px
export const CARD_STACKS_Y = TORPOR_ZONE_Y + TORPOR_ZONE_HEIGHT // 530px
export const CARD_STACKS_HEIGHT = CARD_IN_STACK_SCALE * CARD_WIDTH + 10 // 64px
export const PLAY_AREA_HEIGHT = CARD_STACKS_Y + CARD_STACKS_HEIGHT // 594px
export const UNCONTROLLED_WIDTH = GRID_SIZE * 9 * 4 // 360px

export const HORIZONTAL_SEPARATOR_DEFAULT_Y = TORPOR_ZONE_Y
export const HORIZONTAL_SEPARATOR_MIN_Y = PLAYER_BAR_HEIGHT + 20 * GRID_SIZE
export const HORIZONTAL_SEPARATOR_MAX_Y = TORPOR_ZONE_Y

export const VERTICAL_SEPARATOR_DEFAULT_X = PLAY_AREA_WIDTH - UNCONTROLLED_WIDTH
export const VERTICAL_SEPARATOR_MIN_X = 8 * GRID_SIZE
export const VERTICAL_SEPARATOR_MAX_X = PLAY_AREA_WIDTH - VERTICAL_SEPARATOR_MIN_X

export const HAND_HEIGHT = 205
export const HAND_WIDTH = WORLD_WIDTH * 0.99
export const HAND_X = (WORLD_WIDTH - HAND_WIDTH) / 2
export const HAND_Y = WORLD_HEIGHT - HAND_HEIGHT

export const TOP_AREA_WIDTH = PLAY_AREA_WIDTH
export const TOP_AREA_HEIGHT = WORLD_HEIGHT - PLAY_AREA_HEIGHT - HAND_HEIGHT - 10
export const TOP_AREA_X = PLAY_AREA_X

export const OTHER_PLAYERS_HORIZONTAL_GUTTER = 12
export const OTHER_PLAYERS_VERTICAL_GUTTER = 5
export const OTHER_PLAYERS_SCALE = 0.72
export const RIGHT_PLAYERS_X = WORLD_WIDTH * 0.7 + OTHER_PLAYERS_HORIZONTAL_GUTTER
export const BOTTOM_PLAYERS_Y = WORLD_HEIGHT * 0.4 + OTHER_PLAYERS_VERTICAL_GUTTER

export const TWO_PLAYERS_HORIZONTAL_GUTTER = (WORLD_WIDTH - PLAY_AREA_WIDTH * 2) / 4

/**
 * Play Area Colors
 */

export const REGION_ALPHA = OPAQUE_ALPHA * 0.75
export const REGION_BACKGROUND_COLOR = `rgba(128,128,128,${REGION_ALPHA / 255})`
export const REGION_BACKGROUND_COLOR_DRAG_OVER = `rgba(115,115,115,${REGION_ALPHA / 255})`

export const PLAYER_COLORS = {
    purple: 'rgb(60,20,95)', // dark purple
    green: 'rgb(15,70,35)', // dark emerald green
    crimson: 'rgb(105,20,20)', // dark crimson
    azure: 'rgb(2,75,115)', // dark azure blue
    amber: 'rgb(125,58,6)', // dark amber
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
 * Card Group
 */

export const CARD_GROUP_OUTLINE_COLOR = 'rgb(10,165,140)'
export const CARD_GROUP_BOUNDING_BOX_THICKNESS = 1
export const CARD_GROUP_BOUNDING_BOX_COLOR = 'rgb(75,75,75)'
export const CARD_GROUP_ICON_WIDTH = 40
export const CARD_GROUP_ICON_HEIGHT = 50
export const CARD_GROUP_ICON_MARGIN = 5
export const CARD_GROUP_BACKGROUND_COLOR = 'rgba(255,255,255,0.5)'

/**
 * Counter
 */

export const COUNTER_RADIUS = 12
export const COUNTER_OUTLINE_THICKNESS = 1
export const COUNTER_HOVER_OFFSET_MULTIPLIER = 1.6
export const COUNTER_OUTLINE_COLOR = BLACK
export const COUNTER_TEXT_STYLE = {
    color: 'black',
    fontStyle: 'bold',
    fontSize: '18px',
}
export const BLOOD_COUNTER_FILL_COLOR = 'rgb(150,0,0)'
export const GREEN_COUNTER_FILL_COLOR = 'rgb(0,150,0)'

/**
 * Button
 */

export const BUTTON_BORDER_WIDTH = 1
export const BUTTON_BORDER_COLOR = 'rgb(26,26,26)'
export const BUTTON_BACKGROUND_COLOR = 'rgb(21,47,47)'
export const BUTTON_TEXT_STYLE = {
    color: 'white',
    fontStyle: 'bold',
    fontSize: '14px',
}

export const OVERLAY_BUTTON_SIZE = COUNTER_RADIUS * COUNTER_HOVER_OFFSET_MULTIPLIER

/**
 * Markers
 */

export const MARKER_MARGIN_TOP = 15
export const MARKER_HEIGHT = 20
export const MARKER_WIDTH_PER_CHAR = 8
export const MARKER_PADDING = 10

export const MARKERS_FILL_COLOR = 'rgba(118,74,43,0.9)'
export const MARKERS_TEXT_STYLE = {
    color: 'black',
    fontStyle: 'bold',
    fontSize: '13px',
}

/**
 * Wield Card Stack
 */

export const WIELD_X = 0
export const WIELD_Y = 0
export const WIELD_CARD_STACK_HEIGHT = 270
export const WIELD_ACTIONS_WIDTH = 190
export const WIELD_BORDER_COLOR = BLACK
export const WIELD_BACKGROUND_COLOR = REGION_BACKGROUND_COLOR

export const WIELD_CARD_SCALE = 0.45
export const WIELD_CARD_DISPLAY_WIDTH = WIELD_CARD_SCALE * CARD_WIDTH + 8
export const WIELD_CARDS_OFFSET = 15
export const WIELD_INDICATOR_WIDTH = 25

export const WIELD_SCROLLBAR_HEIGHT = 15
export const WIELD_SCROLLBAR_COLOR = 'rgb(60,60,60)'
export const WIELD_SCROLLBAR_ALPHA = 0.6

/**
 * Arrows
 */

export const ARROW_HEAD_WIDTH = 20
export const ARROW_HEAD_HEIGHT = 20
export const ARROW_COLOR = 'rgb(135,45,60)'

/**
 * Alignment guides
 */

export const ALIGNMENT_GUIDE_THRESHOLD = 1.5 * GRID_SIZE // Distance threshold for showing alignment guide
export const ALIGNMENT_GUIDE_COLOR = 'rgb(50,200,50)'
export const ALIGNMENT_GUIDE_WIDTH = 1
export const ALIGNMENT_GUIDE_OVERSHOOT = 20

/**
 * Misc
 */

export const DRAG_DISTANCE_THRESHOLD = 5
export const CARD_LOG_PLACEHOLDER = '[CARD]'
