import type { SeverityLevel } from '@sentry/vue'
import * as Sentry from '@sentry/vue'
import { App } from 'vue'
import { Pinia } from 'pinia'
import { useCoreStore } from '@/client/store/core.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { useHistoryStore } from '@/client/store/history.ts'

const isProd = import.meta.env.PROD
const sentryEnv = import.meta.env.VITE_SENTRY_ENV ?? (isProd ? 'production' : 'development')

export function initSentry(app: App) {
    Sentry.init({
        app,
        dsn: import.meta.env.VITE_SENTRY_DSN,
        enabled: isProd,
        environment: sentryEnv,
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
                const history = transformedState.history as ReturnType<typeof useHistoryStore>

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

                transformedState.history = {
                    ...history,
                    archive: '[stripped]',
                }

                return transformedState
            },
        }),
    )
}

export function captureException(exception: unknown) {
    if (isProd) {
        Sentry.captureException(exception)
    } else {
        throw exception
    }
}

export function captureMessage(message: string, captureContext?: SeverityLevel) {
    if (isProd) {
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
