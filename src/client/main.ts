import '@/client/styles/main.scss'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from '@/client/SuccubusApp.vue'
import { loadAllResources } from '@/client/resources'
import { useCoreStore } from '@/client/store/core.ts'
import * as logging from '@/client/logging.ts'
import { initSentryPiniaPlugin } from '@/client/logging.ts'
import router from '@/client/ui/router.ts'
import { useBusStore } from '@/client/store/bus.ts'
import { screenBigEnough } from '@/client/game/display.ts'
import { startIdleMonitoring } from '@/client/multiplayer/idle.ts'
import { initClient } from '@/client/initClient.ts'

const app = createApp(App)
logging.initSentry(app)

/**
 * User Feedback Widget customization
 *
 * There's not part attribute to do it in pure-CSS,
 * so we must access the shadow DOM here in js
 */
const widgetActor = document
    .querySelector('#sentry-feedback')
    ?.shadowRoot?.querySelector('.widget__actor') as HTMLElement
if (widgetActor) {
    widgetActor.style.margin = '4px'
    widgetActor.style.padding = '5px'
    widgetActor.style.fontSize = '14px'
    widgetActor.style.color = '#cccccc'
    widgetActor.style.borderRadius = '3px'
    widgetActor.style.border = 'none'
    widgetActor.style.backgroundColor = '#4a4250'
}
// Disable keystrokes that happens in the widget shadow DOM
for (const eventType of ['keydown', 'keyup']) {
    document
        .querySelector('#sentry-feedback')
        ?.addEventListener(eventType, e => e.stopPropagation())
}

const pinia = createPinia()
initSentryPiniaPlugin(pinia)
app.use(pinia)
app.use(router)

initClient()

app.mount('#mountMe')

startIdleMonitoring()

// Load resources in the background
// Don't bother to pull in 5Mb of resources if the user is on mobile.
if (screenBigEnough) {
    loadAllResources()
        .then(() => {
            useCoreStore().resourcesAreReady = true
        })
        .catch(e => {
            useBusStore().alertError(
                'Failed to load game resources. The game might not function properly.',
            )

            logging.captureException(e)
        })
}
