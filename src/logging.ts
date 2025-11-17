import type { SeverityLevel } from '@sentry/vue'
import * as Sentry from '@sentry/vue'
import { App } from 'vue'
import { Pinia } from 'pinia'
import { useCoreStore } from '@/store/core.ts'
import { useMultiplayerStore } from '@/store/multiplayer.ts'
import { serializeHistory } from '@/gateway/serialization.ts'

export function initSentry(app: App) {
    Sentry.init({
        app,
        dsn: import.meta.env.VITE_SENTRY_DSN,
        enabled: true, // import.meta.env.PROD,
        environment: import.meta.env.PROD ? 'production' : 'development',
        tunnel: '/api/sentryTunnel',
        normalizeDepth: 4,

        integrations: [
            Sentry.feedbackIntegration({
                autoInject: true,
                showBranding: false,
                colorScheme: 'dark',
            }),
        ],
    })
}

export function initSentryPiniaPlugin(pinia: Pinia) {
    pinia.use(
        Sentry.createSentryPiniaPlugin({
            stateTransformer: state => {
                const transformedState = {
                    ...state,
                }

                const core = transformedState.core as ReturnType<typeof useCoreStore>
                const multiplayer = transformedState.multiplayer as ReturnType<
                    typeof useMultiplayerStore
                >

                if (core.userProfile?.avatar) {
                    transformedState.core = {
                        ...core,
                        userProfile: {
                            ...core.userProfile,
                            avatar: '[stripped]',
                        },
                    }
                }

                if (multiplayer.avatars) {
                    transformedState.multiplayer = {
                        ...multiplayer,
                        avatars: '[stripped]',
                    }
                }

                // Serialized history is a much more compact representation
                transformedState.history = serializeHistory()

                return transformedState
            },
        }),
    )
}

export function captureException(exception: unknown) {
    if (import.meta.env.PROD) {
        Sentry.captureException(exception)
    } else {
        throw exception
    }
}

export function captureMessage(message: string, captureContext?: SeverityLevel) {
    if (import.meta.env.PROD) {
        Sentry.captureMessage(message, captureContext)
    } else {
        /* eslint-disable no-console */
        if (captureContext == 'fatal' || captureContext == 'error') {
            console.error(`[Sentry]${message}`)
        } else if (captureContext == 'warning') {
            console.warn(`[Sentry]${message}`)
        } else {
            console.log(`[Sentry]${message}`)
        }
        /* eslint-enable no-console */
    }
}
