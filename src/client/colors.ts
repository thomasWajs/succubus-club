import {
    ACTION_DECLARATION_OUTLINE_COLOR,
    ALIGNMENT_GUIDE_COLOR,
    ARROW_COLOR,
    BLACK,
    BLOOD_COUNTER_FILL_COLOR,
    BUTTON_BACKGROUND_COLOR,
    BUTTON_BORDER_COLOR,
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
    REGION_ALPHA,
    REGION_LUMINANCE_MAX,
    REGION_LUMINANCE_MIN,
    REGION_NAME_FADE,
    REGION_STACK_SIZE_LIGHTEN,
    SELECTION_AREA_COLOR,
    SEPARATOR_COLOR,
    WHITE,
    WIELD_BACKGROUND_COLOR,
    WIELD_BORDER_COLOR,
    WIELD_SCROLLBAR_COLOR,
} from '@/shared/const/game.ts'
import Phaser from 'phaser'
import { computed } from 'vue'
import { regionBlendRgb, regionFillRgb } from '@/client/gateway/background.ts'

const toColor = (value: string) => Phaser.Display.Color.RGBStringToColor(value)

const regionBackground = computed(() => {
    const { r, g, b } = regionFillRgb.value
    return new Phaser.Display.Color(r, g, b, REGION_ALPHA)
})

const regionStackSizeBackground = computed(() => {
    const lighten = (channel: number) =>
        Math.round(channel * (1 - REGION_STACK_SIZE_LIGHTEN) + 255 * REGION_STACK_SIZE_LIGHTEN)
    const { r, g, b } = regionBlendRgb.value
    return new Phaser.Display.Color(lighten(r), lighten(g), lighten(b))
})

export function regionNameColor(color?: Phaser.Display.Color): string {
    if (!color) {
        return BLACK
    }

    const grey = (REGION_LUMINANCE_MIN + REGION_LUMINANCE_MAX) / 2
    const fade = (channel: number) =>
        Math.round(channel * (1 - REGION_NAME_FADE) + grey * REGION_NAME_FADE)

    return `rgb(${fade(color.red)},${fade(color.green)},${fade(color.blue)})`
}

export const Colors = {
    // Reactive: follows the tabletop background
    get REGION_BACKGROUND() {
        return regionBackground.value
    },
    get REGION_STACK_SIZE_BACKGROUND() {
        return regionStackSizeBackground.value
    },
    ACTION_DECLARATION_OUTLINE: toColor(ACTION_DECLARATION_OUTLINE_COLOR),
    ALIGNMENT_GUIDE: toColor(ALIGNMENT_GUIDE_COLOR),
    ARROW: toColor(ARROW_COLOR),
    BLACK: toColor(BLACK),
    BLOOD_COUNTER_FILL: toColor(BLOOD_COUNTER_FILL_COLOR),
    BUTTON_BACKGROUND: toColor(BUTTON_BACKGROUND_COLOR),
    BUTTON_BORDER: toColor(BUTTON_BORDER_COLOR),
    CARD_GLOW: toColor(CARD_GLOW_COLOR),
    CARD_GROUP_BACKGROUND: toColor(CARD_GROUP_BACKGROUND_COLOR),
    CARD_GROUP_BOUNDING_BOX: toColor(CARD_GROUP_BOUNDING_BOX_COLOR),
    CARD_GROUP_OUTLINE: toColor(CARD_GROUP_OUTLINE_COLOR),
    CARD_OUTLINE_HOVER: toColor(CARD_OUTLINE_COLOR_HOVER),
    CARD_OUTLINE_INDIRECT_HOVER: toColor(CARD_OUTLINE_COLOR_INDIRECT_HOVER),
    CARD_OUTLINE_SELECTED: toColor(CARD_OUTLINE_COLOR_SELECTED),
    CARD_PING: toColor(CARD_PING_COLOR),
    COUNTER_OUTLINE: toColor(COUNTER_OUTLINE_COLOR),
    GREEN_COUNTER_FILL: toColor(GREEN_COUNTER_FILL_COLOR),
    HIGHLIGHT_YELLOW: toColor(HIGHLIGHT_YELLOW),
    MARKERS_FILL: toColor(MARKERS_FILL_COLOR),
    ORANGE_COUNTER_FILL: toColor(ORANGE_COUNTER_FILL_COLOR),
    SELECTION_AREA: toColor(SELECTION_AREA_COLOR),
    SEPARATOR: toColor(SEPARATOR_COLOR),
    WHITE: toColor(WHITE),
    WIELD_BACKGROUND: toColor(WIELD_BACKGROUND_COLOR),
    WIELD_BORDER: toColor(WIELD_BORDER_COLOR),
    WIELD_SCROLLBAR: toColor(WIELD_SCROLLBAR_COLOR),
}
