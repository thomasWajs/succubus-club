import type { SeverityLevel } from '@sentry/vue'
import * as Sentry from '@sentry/vue'
import { App } from 'vue'
import { Pinia } from 'pinia'
import { useCoreStore } from '@/client/store/core.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { useHistoryStore } from '@/client/store/history.ts'
import { useBusStore } from '@/client/store/bus.ts'

import { NotInAGameRoom } from '@/client/types.ts'

const isProd = import.meta.env.PROD
const sentryEnv = import.meta.env.VITE_SENTRY_ENV ?? (isProd ? 'production' : 'development')

export function initGlobalErrorHandling() {
    window.addEventListener('unhandledrejection', event => {
        // Special handling for NotInAGameRoom errors
        if (event.reason instanceof NotInAGameRoom) {
            useBusStore().alertError(
                "Oops, looks like you've been disconnected. Refresh the page to reconnect.",
            )
            event.preventDefault() // prevents default browser error logging
        }
    })
}

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

        beforeSend(event) {
            // Filter out internal Vue errors, they flood Sentry with useless reports
            const frames = event.exception?.values?.[0]?.stacktrace?.frames
            if (frames?.length) {
                const lastFrame = frames[frames.length - 1]
                if (
                    lastFrame.filename?.includes('node_modules/@vue/runtime-core') ||
                    lastFrame.filename?.includes('node_modules/@vue/runtime-dom')
                ) {
                    return null
                }
            }
            return event
        },
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
