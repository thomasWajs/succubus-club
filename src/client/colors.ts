import {
    ACTION_DECLARATION_OUTLINE_COLOR,
    ALIGNMENT_GUIDE_COLOR,
    ARROW_COLOR,
    BLACK,
    BLOOD_COUNTER_FILL_COLOR,
    BUTTON_BACKGROUND_COLOR,
    BUTTON_BORDER_COLOR,
    BURN_ICON_COLOR,
    CARD_GLOW_COLOR,
    CARD_GROUP_BACKGROUND_COLOR,
    CARD_GROUP_BOUNDING_BOX_COLOR,
    CARD_GROUP_OUTLINE_COLOR,
    CARD_OUTLINE_COLOR_HOVER,
    CARD_OUTLINE_COLOR_INDIRECT_HOVER,
    CARD_OUTLINE_COLOR_SELECTED,
    CARD_PING_COLOR,
    COUNTER_OUTLINE_COLOR,
    GREEN_COUNTER_FILL_COLOR,
    HIGHLIGHT_YELLOW,
    MARKERS_FILL_COLOR,
    ORANGE_COUNTER_FILL_COLOR,
    PURPLE_COUNTER_FILL_COLOR,
    REGION_ALPHA,
    REGION_NAME_FADE,
    REGION_STACK_SIZE_LIGHTEN,
    SELECTION_AREA_COLOR,
    SEPARATOR_COLOR,
    THE_EDGE_CONTROLLED_DISC_COLOR,
    WHITE,
    WIELD_BACKGROUND_COLOR,
    WIELD_BORDER_COLOR,
    WIELD_SCROLLBAR_COLOR,
    DARK_ACCENT_COLOR,
    DARK_ACCENT_LIGHT_COLOR,
    DARK_BORDER_COLOR,
    DARK_CARD_OUTLINE_COLOR_INDIRECT_HOVER,
    DARK_CARD_OUTLINE_COLOR_SELECTED,
    DARK_HIGHLIGHT_COLOR,
    DARK_PLAY_AREA_EDGE_COLOR,
    DARK_PLAY_AREA_TEXT_COLOR,
    DARK_PLAYER_COLOR_LIGHTEN,
    DARK_PLAYER_COLORS,
    DARK_REGION_NAME_COLOR,
    DARK_REGION_STACK_SIZE_LIGHTEN,
    DARK_SURFACE_COLOR,
    DARK_SURFACE_RAISED_COLOR,
    DISCONNECTED_ICON_COLOR,
    DARK_DISCONNECTED_ICON_COLOR,
} from '@/shared/const/game.ts'
import Phaser from 'phaser'
import { computed } from 'vue'
import {
    regionBlendRgb,
    regionFillRgb,
    regionLuminanceRange,
    theEdgeDiscRgb,
} from '@/client/gateway/background.ts'
import { isLightUi } from '@/client/gateway/uiTheme.ts'
import { getAuthorColorRgba } from '@/shared/colors.ts'
import { Player } from '@/shared/model/Player.ts'

const theEdgeDisc = computed(() => {
    const { r, g, b } = theEdgeDiscRgb.value
    return new Phaser.Display.Color(r, g, b)
})

const toColor = (value: string) => Phaser.Display.Color.RGBStringToColor(value)

const regionBackground = computed(() => {
    const { r, g, b } = regionFillRgb.value
    return new Phaser.Display.Color(r, g, b, REGION_ALPHA)
})

const regionStackSizeBackground = computed(() => {
    const amount = isLightUi.value ? REGION_STACK_SIZE_LIGHTEN : DARK_REGION_STACK_SIZE_LIGHTEN
    const lighten = (channel: number) => Math.round(channel * (1 - amount) + 255 * amount)
    const { r, g, b } = regionBlendRgb.value
    return new Phaser.Display.Color(lighten(r), lighten(g), lighten(b))
})

export function regionNameColor(color?: Phaser.Display.Color): string {
    if (!color) {
        return isLightUi.value ? BLACK : WHITE
    }

    // Dark play areas are neutral : one discreet grey for every region name
    if (!isLightUi.value) {
        return DARK_REGION_NAME_COLOR
    }

    const { min, max } = regionLuminanceRange.value
    const grey = (min + max) / 2
    const fade = (channel: number) =>
        Math.round(channel * (1 - REGION_NAME_FADE) + grey * REGION_NAME_FADE)

    return `rgb(${fade(color.red)},${fade(color.green)},${fade(color.blue)})`
}

/**
 * Player colors. The game state stores the light theme seat color, used for the play area edges,
 * player bars and name tags. The dark theme keeps the tabletop neutral and only colors the player
 * names, with its own palette ( see DARK_PLAYER_COLORS ). Colors outside of it are lightened.
 * Read them in a reactive context to follow theme changes.
 */

function nameRgba(rgbaColor: string): string {
    if (isLightUi.value) {
        return rgbaColor
    }
    return (
        DARK_PLAYER_COLORS[rgbaColor] ?? toColor(rgbaColor).lighten(DARK_PLAYER_COLOR_LIGHTEN).rgba
    )
}

/** The player color for name texts. */
export function playerNameRgba(player: Player | null | undefined): string | undefined {
    return player ? nameRgba(player.rgbaColor) : undefined
}

export function playerNameColor(player: Player): Phaser.Display.Color {
    return toColor(nameRgba(player.rgbaColor))
}

const darkPlayAreaEdge = toColor(DARK_PLAY_AREA_EDGE_COLOR)

/** Play area edges and region names : the seat color in light, neutral in dark. */
export function playAreaColor(player: Player): Phaser.Display.Color {
    return isLightUi.value ? toColor(player.rgbaColor) : darkPlayAreaEdge
}

/** Texts of the Free Table widgets, on the region fill : black in light, a soft grey in dark. */
export function playAreaTextColor(): string {
    return isLightUi.value ? BLACK : DARK_PLAY_AREA_TEXT_COLOR
}

/**
 * The glow of a region or hand a card is dragged over : the seat color in both themes ( in dark,
 * the neutral play area edge would be invisible, so it uses the seat's name color ).
 */
export function dropHighlightColor(player: Player): Phaser.Display.Color {
    return isLightUi.value ? playAreaColor(player) : playerNameColor(player)
}

/**
 * Style of an inline player name tag ( .inline-player-name ) : filled with the seat color in
 * light, the name itself colored in dark.
 */
export function playerTagStyle(player: Player | null | undefined): Record<string, string> {
    if (!player) {
        return {}
    }
    return isLightUi.value ?
            { backgroundColor: player.rgbaColor }
        :   { color: nameRgba(player.rgbaColor) }
}

// Log entries store the light author tag color ( a pastel of the seat color ) : map it back
const darkAuthorColors = new Map(
    Object.entries(DARK_PLAYER_COLORS).map(([light, dark]) => [getAuthorColorRgba(light), dark]),
)

/** The dark name color of a log author, or null when it doesn't come from a seat color. */
export function darkAuthorRgba(authorColorRgba: string): string | null {
    return darkAuthorColors.get(authorColorRgba) ?? null
}

/** A color depending on the UI theme. Read it in a reactive context to follow theme changes. */
function themed(light: string, dark: string) {
    const lightColor = toColor(light)
    const darkColor = toColor(dark)
    return () => (isLightUi.value ? lightColor : darkColor)
}

const themedButtonBackground = themed(BUTTON_BACKGROUND_COLOR, DARK_SURFACE_RAISED_COLOR)
const themedButtonBorder = themed(BUTTON_BORDER_COLOR, DARK_BORDER_COLOR)
const themedCardOutlineSelected = themed(
    CARD_OUTLINE_COLOR_SELECTED,
    DARK_CARD_OUTLINE_COLOR_SELECTED,
)
const themedCardOutlineHover = themed(CARD_OUTLINE_COLOR_HOVER, DARK_HIGHLIGHT_COLOR)
const themedCardOutlineIndirectHover = themed(
    CARD_OUTLINE_COLOR_INDIRECT_HOVER,
    DARK_CARD_OUTLINE_COLOR_INDIRECT_HOVER,
)
const themedSelectionArea = themed(SELECTION_AREA_COLOR, DARK_HIGHLIGHT_COLOR)
const themedDisconnectedIcon = themed(DISCONNECTED_ICON_COLOR, DARK_DISCONNECTED_ICON_COLOR)
const themedSeparator = themed(SEPARATOR_COLOR, DARK_ACCENT_LIGHT_COLOR)
const themedTheEdgeControlledDisc = themed(THE_EDGE_CONTROLLED_DISC_COLOR, DARK_ACCENT_COLOR)
const themedWieldBackground = themed(WIELD_BACKGROUND_COLOR, DARK_SURFACE_COLOR)
const themedWieldBorder = themed(WIELD_BORDER_COLOR, DARK_BORDER_COLOR)
const themedWieldScrollbar = themed(WIELD_SCROLLBAR_COLOR, DARK_ACCENT_LIGHT_COLOR)

export const Colors = {
    // Reactive: follows the tabletop background
    get REGION_BACKGROUND() {
        return regionBackground.value
    },
    get THE_EDGE_DISC() {
        return theEdgeDisc.value
    },
    get REGION_STACK_SIZE_BACKGROUND() {
        return regionStackSizeBackground.value
    },
    // Reactive: follows the UI theme
    get BUTTON_BACKGROUND() {
        return themedButtonBackground()
    },
    get BUTTON_BORDER() {
        return themedButtonBorder()
    },
    get CARD_OUTLINE_SELECTED() {
        return themedCardOutlineSelected()
    },
    get CARD_OUTLINE_HOVER() {
        return themedCardOutlineHover()
    },
    get CARD_OUTLINE_INDIRECT_HOVER() {
        return themedCardOutlineIndirectHover()
    },
    get DISCONNECTED_ICON() {
        return themedDisconnectedIcon()
    },
    get SELECTION_AREA() {
        return themedSelectionArea()
    },
    get SEPARATOR() {
        return themedSeparator()
    },
    get THE_EDGE_CONTROLLED_DISC() {
        return themedTheEdgeControlledDisc()
    },
    get WIELD_BACKGROUND() {
        return themedWieldBackground()
    },
    get WIELD_BORDER() {
        return themedWieldBorder()
    },
    get WIELD_SCROLLBAR() {
        return themedWieldScrollbar()
    },
    // Dark only : the light theme derives them from the seat color
    DARK_PLAYER_BAR: toColor(DARK_SURFACE_RAISED_COLOR),
    ACTION_DECLARATION_OUTLINE: toColor(ACTION_DECLARATION_OUTLINE_COLOR),
    ALIGNMENT_GUIDE: toColor(ALIGNMENT_GUIDE_COLOR),
    ARROW: toColor(ARROW_COLOR),
    BLACK: toColor(BLACK),
    BLOOD_COUNTER_FILL: toColor(BLOOD_COUNTER_FILL_COLOR),
    BURN_ICON: toColor(BURN_ICON_COLOR),
    CARD_GLOW: toColor(CARD_GLOW_COLOR),
    CARD_GROUP_BACKGROUND: toColor(CARD_GROUP_BACKGROUND_COLOR),
    CARD_GROUP_BOUNDING_BOX: toColor(CARD_GROUP_BOUNDING_BOX_COLOR),
    CARD_GROUP_OUTLINE: toColor(CARD_GROUP_OUTLINE_COLOR),
    CARD_PING: toColor(CARD_PING_COLOR),
    COUNTER_OUTLINE: toColor(COUNTER_OUTLINE_COLOR),
    GREEN_COUNTER_FILL: toColor(GREEN_COUNTER_FILL_COLOR),
    HIGHLIGHT_YELLOW: toColor(HIGHLIGHT_YELLOW),
    MARKERS_FILL: toColor(MARKERS_FILL_COLOR),
    ORANGE_COUNTER_FILL: toColor(ORANGE_COUNTER_FILL_COLOR),
    PURPLE_COUNTER_FILL: toColor(PURPLE_COUNTER_FILL_COLOR),
    WHITE: toColor(WHITE),
}
