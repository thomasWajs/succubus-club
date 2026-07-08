import { computed, ref } from 'vue'
import { db } from '@/client/gateway/db.ts'

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

export const BUILTIN_BACKGROUNDS = ['grey', 'beige', 'black', 'brown', 'purple'] as const
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
    builtinName.value = name
}
