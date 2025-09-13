import '@/styles/main.scss'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './SuccubusApp.vue'
import { loadAllResources } from '@/resources/cards.ts'
import { useCoreStore } from '@/store/core.ts'
import * as Sentry from '@sentry/vue'
import * as logging from '@/logging.ts'
import router from './ui/router.ts'
import { useBusStore } from '@/store/bus.ts'

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

const pinia = createPinia()
pinia.use(Sentry.createSentryPiniaPlugin())
app.use(pinia)
app.use(router)

app.mount('#mountMe')

// Load resources in the background
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
