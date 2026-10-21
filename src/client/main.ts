import '@/client/styles/main.scss'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from '@/client/SuccubusApp.vue'
import { loadAllResources } from '@/client/resources'
import { useCoreStore } from '@/client/store/core.ts'
import * as logging from '@/client/logging.ts'
import router from '@/client/ui/router.ts'
import { useBusStore } from '@/client/store/bus.ts'
import { screenBigEnough } from '@/client/game/display.ts'
import { initClient } from '@/client/initClient.ts'
import { injectDisciplineSprite } from '@/client/game/disciplineSprite.ts'

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)

initClient()

// Assemble the discipline icon sprite once, so icons render with no per-icon
// network request on first display.
injectDisciplineSprite()

app.mount('#mountMe')

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
