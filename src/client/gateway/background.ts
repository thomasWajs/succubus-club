import { computed, ref, watch } from 'vue'
import { db } from '@/client/gateway/db.ts'
import { isLightUi, setUiThemeChoice, UiThemeChoice } from '@/client/gateway/uiTheme.ts'
import {
    DARK_REGION_LUMINANCE_MAX,
    DARK_REGION_LUMINANCE_MIN,
    OPAQUE_ALPHA,
    REGION_ALPHA,
    REGION_LUMINANCE_MAX,
    REGION_LUMINANCE_MIN,
    THE_EDGE_DISC_CONTRAST,
} from '@/shared/const/game.ts'

/**
 * Tabletop background management.
 *
 * The background can be one of:
 *  - a built-in background: a tileable texture shipped as a static asset,
 *    referenced by name (when the user never picked one, the UI theme decides, see
 *    {@link defaultBackground}).
 *  - a custom background: an image uploaded by the user, stored as a Blob in
 *    IndexedDB (well suited for binary data and kept out of the frequently-saved
 *    user profile).
 *
 * The selection is persisted in the `settings` table under a single key, holding
 * either the built-in name (string) or the custom image (Blob).
 *
 * A custom image is exposed to the UI through an object URL, recreated whenever it
 * changes and revoked to avoid leaks.
 */

export const BUILTIN_BACKGROUNDS = [
    'charcoal',
    'grey',
    'beige',
    'black',
    'brown',
    'purple',
    'wood',
] as const
export type BuiltinBackground = (typeof BUILTIN_BACKGROUNDS)[number]

/**
 * Built-ins drawn as seamless tiles at their image size ( one image pixel per CSS pixel ) : not
 * stretched on large screens. The others are stretched over the table ( `cover` ).
 */
const BUILTIN_TILE_SIZES: Partial<Record<BuiltinBackground, number>> = {
    charcoal: 1280,
}

/**
 * Average colour of each built-in, shown as a uniform colour until its image is loaded ( otherwise
 * the table stays black meanwhile ).
 */
const BUILTIN_AVERAGE_COLORS: Record<BuiltinBackground, string> = {
    charcoal: '#373739',
    grey: '#7b7b7b',
    beige: '#9a8470',
    black: '#181815',
    brown: '#333b22',
    purple: '#4f4256',
    wood: '#835527',
}

const LIGHT_DEFAULT_BACKGROUND: BuiltinBackground = 'grey'
const DARK_DEFAULT_BACKGROUND: BuiltinBackground = 'charcoal'

/** The background used until the user picks one : it follows the UI theme. */
const defaultBackground = computed<BuiltinBackground>(() =>
    isLightUi.value ? LIGHT_DEFAULT_BACKGROUND : DARK_DEFAULT_BACKGROUND,
)

const SETTINGS_KEY = 'tabletopBackground'

export function builtinBackgroundUrl(name: BuiltinBackground): string {
    return `/assets/tabletopBackground/${name}.jpg`
}

// The built-in background picked by the user, or null when they never picked one.
const pickedBuiltinName = ref<BuiltinBackground | null>(null)
// The active built-in background name (used when no custom image is set).
const builtinName = computed(() => pickedBuiltinName.value ?? defaultBackground.value)
// Object URL for a custom uploaded background, or null when using a built-in.
const customBackgroundUrl = ref<string | null>(null)

/** Whether a custom (uploaded) background is currently active. */
export const hasCustomBackground = computed(() => customBackgroundUrl.value !== null)

/** The built-in currently in use, or null when a custom image is active. */
export const activeBuiltinBackground = computed<BuiltinBackground | null>(() =>
    customBackgroundUrl.value ? null : builtinName.value,
)

/** The URL of the background currently in use. */
export const tabletopBackgroundUrl = computed(
    () => customBackgroundUrl.value ?? builtinBackgroundUrl(builtinName.value),
)

/**
 * Style to apply on the background elements (`#PhavuerGame`, `#LoadingBackground`).
 * Built-in backgrounds are tileable textures (repeated), see {@link BUILTIN_TILE_SIZES};
 * a custom image is shown cover/centered without tiling.
 */
export const tabletopBackgroundStyle = computed(() => {
    const tileSize = customBackgroundUrl.value ? undefined : BUILTIN_TILE_SIZES[builtinName.value]
    return {
        backgroundImage:
            customBackgroundUrl.value ?
                `url("${customBackgroundUrl.value}")`
            :   `url("${builtinBackgroundUrl(builtinName.value)}")`,
        backgroundRepeat: 'repeat',
        backgroundSize: tileSize ? `${tileSize}px` : 'cover',
        backgroundPosition: 'center',
    }
})

/**
 * {@link tabletopBackgroundStyle} plus a uniform colour close to the background, visible until the
 * image is loaded. Not for `#LoadingBackground`, whose own background colour darkens the image.
 */
export const tabletopBackgroundWithFallbackStyle = computed(() => ({
    ...tabletopBackgroundStyle.value,
    backgroundColor:
        customBackgroundUrl.value ?
            `rgb(${backgroundAverage.value.r}, ${backgroundAverage.value.g}, ${backgroundAverage.value.b})`
        :   BUILTIN_AVERAGE_COLORS[builtinName.value],
}))

/**
 * Play area fill.
 *
 * The play areas are drawn translucent over the background. Their fill colour is derived
 * from the average colour of the active background so that the blend ( fill over background )
 * keeps the background hue but has its luminance clamped to a range where cards stay readable.
 */

interface Rgb {
    r: number
    g: number
    b: number
}

const NEUTRAL_GREY: Rgb = { r: 128, g: 128, b: 128 }
const SAMPLE_SIZE = 16

const backgroundAverage = ref<Rgb>(NEUTRAL_GREY)

function luminance({ r, g, b }: Rgb): number {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function clampByte(value: number): number {
    return Math.min(255, Math.max(0, Math.round(value)))
}

/** The luminance range the play areas are clamped to : light or dark, after the UI theme. */
export const regionLuminanceRange = computed(() =>
    isLightUi.value ?
        { min: REGION_LUMINANCE_MIN, max: REGION_LUMINANCE_MAX }
    :   { min: DARK_REGION_LUMINANCE_MIN, max: DARK_REGION_LUMINANCE_MAX },
)

const regionShift = computed(() => {
    const lum = luminance(backgroundAverage.value)
    const { min, max } = regionLuminanceRange.value
    return Math.min(max, Math.max(min, lum)) - lum
})

/** The colour the play areas appear as : the background with its luminance clamped. */
export const regionBlendRgb = computed<Rgb>(() => {
    const bg = backgroundAverage.value
    const shift = regionShift.value
    return { r: clampByte(bg.r + shift), g: clampByte(bg.g + shift), b: clampByte(bg.b + shift) }
})

/** The background colour, moved lighter ( dark background ) or darker ( light one ) by a fixed luminance. */
export const theEdgeDiscRgb = computed<Rgb>(() => {
    const bg = backgroundAverage.value
    const shift = luminance(bg) < 128 ? THE_EDGE_DISC_CONTRAST : -THE_EDGE_DISC_CONTRAST
    return { r: clampByte(bg.r + shift), g: clampByte(bg.g + shift), b: clampByte(bg.b + shift) }
})

/** The fill colour of the play areas ( its alpha is REGION_ALPHA ). */
export const regionFillRgb = computed<Rgb>(() => {
    const bg = backgroundAverage.value
    const shift = regionShift.value
    const alpha = REGION_ALPHA / OPAQUE_ALPHA
    // Solve (alpha * fill + (1 - alpha) * bg) = bg + shift
    const solve = (channel: number) => clampByte((channel + shift - (1 - alpha) * channel) / alpha)
    return { r: solve(bg.r), g: solve(bg.g), b: solve(bg.b) }
})

async function computeAverageColor(url: string): Promise<Rgb> {
    const image = new Image()
    image.src = url
    await image.decode()

    const canvas = document.createElement('canvas')
    canvas.width = SAMPLE_SIZE
    canvas.height = SAMPLE_SIZE
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) {
        return NEUTRAL_GREY
    }
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
    const { data } = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE)

    let r = 0
    let g = 0
    let b = 0
    const pixels = SAMPLE_SIZE * SAMPLE_SIZE
    for (let i = 0; i < data.length; i += 4) {
        r += data[i]
        g += data[i + 1]
        b += data[i + 2]
    }
    return { r: r / pixels, g: g / pixels, b: b / pixels }
}

let analysisToken = 0

async function refreshBackgroundAverage() {
    const token = ++analysisToken
    let average = NEUTRAL_GREY
    try {
        average = await computeAverageColor(tabletopBackgroundUrl.value)
    } catch {
        // Undecodable image: fall back to the neutral grey
    }
    // A newer background was selected meanwhile
    if (token === analysisToken) {
        backgroundAverage.value = average
    }
}

function setCustomBlob(blob: Blob | null) {
    if (customBackgroundUrl.value) {
        URL.revokeObjectURL(customBackgroundUrl.value)
    }
    customBackgroundUrl.value = blob ? URL.createObjectURL(blob) : null
}

/** Load the persisted background selection. Call once at startup, after the UI theme. */
export async function initTabletopBackground() {
    const value = (await db.settings.get(SETTINGS_KEY))?.value
    if (value instanceof Blob) {
        setCustomBlob(value)
    } else {
        setCustomBlob(null)
        pickedBuiltinName.value =
            BUILTIN_BACKGROUNDS.includes(value as BuiltinBackground) ?
                (value as BuiltinBackground)
            :   null
    }
    await refreshBackgroundAverage()
    preloadThemeDefaults()

    // Follow later changes : user selection, or the theme changing the default background
    watch(tabletopBackgroundUrl, refreshBackgroundAverage)
    // A background picked for one theme is usually illegible with the other : switching the
    // theme goes back to its default background. Synchronous, so that
    // {@link setUiThemeKeepingBackground} can skip it.
    watch(
        isLightUi,
        () => {
            if (!keepBackgroundOnThemeChange) {
                resetTabletopBackground()
            }
        },
        { flush: 'sync' },
    )
}

let keepBackgroundOnThemeChange = false

/** Change the UI theme, but keep the current background instead of the theme default. */
export async function setUiThemeKeepingBackground(value: UiThemeChoice) {
    keepBackgroundOnThemeChange = true
    // The theme changes synchronously, before the first await of the call
    const saved = setUiThemeChoice(value)
    keepBackgroundOnThemeChange = false
    await saved
}

/** Whether the user ever picked a background ( built-in or custom ). */
export function backgroundWasPicked(): boolean {
    return hasCustomBackground.value || pickedBuiltinName.value !== null
}

// Kept referenced, so that the browser keeps the decoded images in its memory cache
const preloadedImages: HTMLImageElement[] = []

/**
 * Load the default background of both themes in advance : switching the theme then shows the
 * new background at once instead of waiting for its download.
 */
function preloadThemeDefaults() {
    for (const name of [LIGHT_DEFAULT_BACKGROUND, DARK_DEFAULT_BACKGROUND]) {
        const image = new Image()
        image.src = builtinBackgroundUrl(name)
        image.decode().catch(() => {
            // Not critical : the background will be loaded when displayed
        })
        preloadedImages.push(image)
    }
}

/** Forget the user selection : the default background of the UI theme applies again. */
async function resetTabletopBackground() {
    setCustomBlob(null)
    pickedBuiltinName.value = null
    await db.settings.delete(SETTINGS_KEY)
}

/** Store a custom uploaded background and make it active. */
export async function setTabletopBackground(blob: Blob) {
    await db.settings.put({ key: SETTINGS_KEY, value: blob })
    setCustomBlob(blob)
}

/** Select one of the built-in backgrounds. */
export async function setBuiltinBackground(name: BuiltinBackground) {
    await db.settings.put({ key: SETTINGS_KEY, value: name })
    setCustomBlob(null)
    pickedBuiltinName.value = name
}
