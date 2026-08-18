import type { SeverityLevel } from '@sentry/node'
import * as Sentry from '@sentry/node'
import logger from './logger.ts'

export function captureException(exception: unknown) {
    if (process.env.NODE_ENV === 'production') {
        Sentry.captureException(exception)
    } else {
        console.error(exception)
    }
}

export function captureMessage(message: string, captureContext?: SeverityLevel) {
    if (process.env.NODE_ENV === 'production') {
        Sentry.captureMessage(message, captureContext)
    } else {
        if (captureContext == 'fatal' || captureContext == 'error') {
            logger.error(`[Sentry]${message}`)
        } else if (captureContext == 'warning') {
            logger.warn(`[Sentry]${message}`)
        } else {
            logger.info(`[Sentry]${message}`)
        }
    }
}
