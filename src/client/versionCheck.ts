import { CURRENT_VERSION } from '@/shared/version.mjs'
import { compareVersions } from '@/shared/multiplayer/version.ts'
import { useBusStore } from '@/client/store/bus.ts'
import router, { ROUTES } from '@/client/ui/router.ts'
import * as logging from '@/client/logging.ts'

const FETCH_ATTEMPTS = 2
const RETRY_DELAY = 1000 // milliseconds

// Entering a room right after the lobby shouldn't ask the API twice in a row
const RECENT_CHECK_DELAY = 30 * 1000 // milliseconds
let lastSuccessfulCheck = 0

async function fetchServerVersion(): Promise<string | null> {
    for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
        try {
            // no-store : a stale cached answer would defeat the whole point
            const response = await fetch('/api/version', { cache: 'no-store' })
            if (response.ok) {
                const { version } = await response.json()
                return typeof version == 'string' ? version : null
            }
        } catch (e) {
            if (attempt == FETCH_ATTEMPTS) {
                logging.captureException(e)
            }
        }
        if (attempt < FETCH_ATTEMPTS) {
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY))
        }
    }
    return null
}

/**
 * Ask Vercel for the current version, and flag this client as outdated if it is older.
 * Meant to be fired and forgotten : nobody waits for it.
 *
 * This is one signal among others : the room peers and the SCS also tell when this client
 * is outdated. So when the version can't be fetched, we carry on rather than lock out
 * someone who may just be offline.
 */
export async function checkServerVersion() {
    const bus = useBusStore()

    // Reloading in the middle of a game would be harsh : the lobby is the place for it.
    if (
        router.currentRoute.value.name === ROUTES.Game ||
        import.meta.env.DEV ||
        bus.updateRequired ||
        Date.now() - lastSuccessfulCheck < RECENT_CHECK_DELAY
    ) {
        return
    }

    const serverVersion = await fetchServerVersion()
    if (!serverVersion) {
        return
    }

    lastSuccessfulCheck = Date.now()
    if (compareVersions(CURRENT_VERSION, serverVersion) < 0) {
        bus.updateRequired = true
    }
}

/**
 * A peer that runs a newer version proves that this client is outdated,
 * whatever Vercel says.
 */
export function checkPeerVersion(peerVersion: string | undefined) {
    if (compareVersions(CURRENT_VERSION, peerVersion) < 0) {
        useBusStore().updateRequired = true
    }
}
