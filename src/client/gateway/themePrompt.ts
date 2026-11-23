import { ref, watch } from 'vue'
import { db } from '@/client/gateway/db.ts'
import {
    setUiThemeChoice,
    UiThemeChoice,
    uiThemeChoice,
    uiThemeWasPicked,
} from '@/client/gateway/uiTheme.ts'
import { backgroundWasPicked, setUiThemeKeepingBackground } from '@/client/gateway/background.ts'

/**
 * One-time dark theme offer for players from before the dark theme.
 *
 * Back then the UI was light only. Such players keep the light theme ( and their background ), and
 * are offered the dark theme once, when their first game loads : accepting switches both the UI and
 * the background.
 *
 * They are recognized on the first start with this module : they dismissed the welcome modal or
 * picked a background, but never picked a theme. The outcome is persisted right away, so a new
 * player does not turn into a legacy one later.
 */

const SETTINGS_KEY = 'legacyThemePrompt'
// Set by the welcome modal once dismissed
const VISITED_STORAGE_KEY = 'succubus-club-visited'

enum PromptState {
    Pending = 'pending',
    Done = 'done',
}

/** Whether the dark theme offer is still to be made. */
export const themePromptPending = ref(false)

function isLegacyPlayer(): boolean {
    const visited = localStorage.getItem(VISITED_STORAGE_KEY) !== null
    return (visited || backgroundWasPicked()) && !uiThemeWasPicked()
}

async function setState(state: PromptState) {
    themePromptPending.value = state === PromptState.Pending
    await db.settings.put({ key: SETTINGS_KEY, value: state })
}

/** Call once at startup, after the UI theme and the tabletop background. */
export async function initThemePrompt() {
    const stored = (await db.settings.get(SETTINGS_KEY))?.value
    if (stored === PromptState.Pending || stored === PromptState.Done) {
        themePromptPending.value = stored === PromptState.Pending
    } else if (isLegacyPlayer()) {
        await setState(PromptState.Pending)
        // As before the dark theme : light UI over the background they had
        await setUiThemeKeepingBackground(UiThemeChoice.Light)
    } else {
        await setState(PromptState.Done)
    }

    if (themePromptPending.value) {
        // A theme picked in the preferences answers the offer
        const stop = watch(uiThemeChoice, () => {
            stop()
            setState(PromptState.Done)
        })
    }
}

/** Answer the dark theme offer. Switching the theme also switches to its default background. */
export async function answerThemePrompt(dark: boolean) {
    if (dark) {
        await setUiThemeChoice(UiThemeChoice.Dark)
    }
    await setState(PromptState.Done)
}
