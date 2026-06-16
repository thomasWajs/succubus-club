import { latestChangelog } from '@/client/changelog.ts'
import { useBusStore } from '@/client/store/bus.ts'
import router, { ROUTES } from '@/client/ui/router.ts'
import * as logging from '@/client/logging.ts'

const CHECK_INTERVAL = 5 * 60 * 1000 // 5 minutes

async function checkServerVersion() {
    if (router.currentRoute.value.name === ROUTES.Game || import.meta.env.DEV) {
        return
    }

    const bus = useBusStore()
    if (bus.updateAvailable) {
        return
    }

    try {
        const response = await fetch('/api/version')
        if (!response.ok) {
            return
        }
        const { version } = await response.json()
        if (version && version !== latestChangelog.version) {
            bus.updateAvailable = true
        }
    } catch (e) {
        logging.captureException(e)
    }
}

export function startVersionMonitoring() {
    checkServerVersion()
    setInterval(checkServerVersion, CHECK_INTERVAL)
}
