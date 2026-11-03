import { computed, ref } from 'vue'
import { db } from '@/client/gateway/db.ts'
import {
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
 *    referenced by name (the default for new users is {@link DEFAULT_BACKGROUND}).
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

export const BUILTIN_BACKGROUNDS = ['grey', 'beige', 'black', 'brown', 'purple', 'wood'] as const
export type BuiltinBackground = (typeof BUILTIN_BACKGROUNDS)[number]

export const DEFAULT_BACKGROUND: BuiltinBackground = 'grey'

const SETTINGS_KEY = 'tabletopBackground'

export function builtinBackgroundUrl(name: BuiltinBackground): string {
    return `/assets/tabletopBackground/${name}.jpg`
}

// The active built-in background name (used when no custom image is set).
const builtinName = ref<BuiltinBackground>(DEFAULT_BACKGROUND)
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
 * Built-in backgrounds are tileable textures (repeated); a custom image is shown
 * cover/centered without tiling.
 */
export const tabletopBackgroundStyle = computed(() => {
    return {
        backgroundImage:
            customBackgroundUrl.value ?
                `url("${customBackgroundUrl.value}")`
            :   `url("${builtinBackgroundUrl(builtinName.value)}")`,
        backgroundRepeat: 'repeat',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
    }
})

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

const regionShift = computed(() => {
    const lum = luminance(backgroundAverage.value)
    return Math.min(REGION_LUMINANCE_MAX, Math.max(REGION_LUMINANCE_MIN, lum)) - lum
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

/** Load the persisted background selection. Call once at startup. */
export async function initTabletopBackground() {
    const value = (await db.settings.get(SETTINGS_KEY))?.value
    if (value instanceof Blob) {
        setCustomBlob(value)
    } else {
        setCustomBlob(null)
        builtinName.value =
            BUILTIN_BACKGROUNDS.includes(value as BuiltinBackground) ?
                (value as BuiltinBackground)
            :   DEFAULT_BACKGROUND
    }
    await refreshBackgroundAverage()
}

/** Store a custom uploaded background and make it active. */
export async function setTabletopBackground(blob: Blob) {
    await db.settings.put({ key: SETTINGS_KEY, value: blob })
    setCustomBlob(blob)
    await refreshBackgroundAverage()
}

/** Select one of the built-in backgrounds. */
export async function setBuiltinBackground(name: BuiltinBackground) {
    await db.settings.put({ key: SETTINGS_KEY, value: name })
    setCustomBlob(null)
    builtinName.value = name
    await refreshBackgroundAverage()
}
