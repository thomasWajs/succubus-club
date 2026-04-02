import dotenv from 'dotenv'
import * as Sentry from '@sentry/node'

dotenv.config({ path: '../../.env.local' })

const NODE_ENV = process.env.NODE_ENV ?? 'development'
const SENTRY_ENV = process.env.SENTRY_ENV ?? NODE_ENV

Sentry.init({
    dsn: process.env.SCS_SENTRY_DSN,
    enabled: NODE_ENV != 'development',
    environment: SENTRY_ENV,
    sendDefaultPii: true,
    // disable the session/performance tracking that causes background traffic
    tracesSampleRate: 0,
})
