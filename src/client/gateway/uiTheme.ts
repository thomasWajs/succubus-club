import { computed, readonly, ref, watchEffect } from 'vue'
import { db } from '@/client/gateway/db.ts'

/**
 * In-game UI theme : light or dark.
 *
 * Both themes share the same layout, fonts and controls; they only differ by their colors and
 * tabletop background. The dark theme is the default.
 *
 * The player picks dark, light or system ( follows the OS setting, live ). The choice is persisted
 * in the `settings` table ( like the tabletop background ). The resolved theme is exposed:
 *  - to scripts ( Phaser colours, HTML components ) through {@link isLightUi};
 *  - to stylesheets through the `data-ui-theme` attribute on the root element, which sets
 *    `color-scheme` ( see `_theme.scss` : `light-dark()` tokens, and the `dark-ui` mixin in
 *    `_mixins.scss` for what colors alone can't express ).
 */

export enum UiThemeChoice {
    Dark = 'dark',
    Light = 'light',
    System = 'system',
}

/** The theme choices, as offered to the player. */
export const UI_THEME_CHOICES = [
    { value: UiThemeChoice.Dark, label: 'Dark' },
    { value: UiThemeChoice.Light, label: 'Light' },
    { value: UiThemeChoice.System, label: 'System' },
]

const SETTINGS_KEY = 'uiTheme'

const choice = ref<UiThemeChoice>(UiThemeChoice.Dark)

const systemDarkQuery = window.matchMedia('(prefers-color-scheme: dark)')
const systemIsDark = ref(systemDarkQuery.matches)
systemDarkQuery.addEventListener('change', event => {
    systemIsDark.value = event.matches
})

/** Resolved theme */
export const isLightUi = computed(() =>
    choice.value === UiThemeChoice.System ?
        !systemIsDark.value
    :   choice.value === UiThemeChoice.Light,
)
/** Player's choice, which may be {@link UiThemeChoice.System} */
export const uiThemeChoice = readonly(choice)

watchEffect(() => {
    document.documentElement.dataset.uiTheme = isLightUi.value ? 'light' : 'dark'
})

function parseChoice(value: unknown): UiThemeChoice {
    return Object.values(UiThemeChoice).find(candidate => candidate === value) ?? UiThemeChoice.Dark
}

/** Load the persisted theme. Call once at startup. */
export async function initUiTheme() {
    choice.value = parseChoice((await db.settings.get(SETTINGS_KEY))?.value)
}

export async function setUiThemeChoice(value: UiThemeChoice) {
    choice.value = value
    await db.settings.put({ key: SETTINGS_KEY, value })
}
