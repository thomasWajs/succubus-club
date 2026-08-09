import dotenv from 'dotenv'
// import * as Sentry from '@sentry/node'

dotenv.config({ path: '../../.env.local' })

// const NODE_ENV = process.env.NODE_ENV ?? 'development'
// const SENTRY_ENV = process.env.SENTRY_ENV ?? NODE_ENV

// Temporary disable for ticket #192
/*
Sentry.init({
    dsn: process.env.SCS_SENTRY_DSN,
    enabled: NODE_ENV != 'development',
    environment: SENTRY_ENV,
    sendDefaultPii: true,
    // disable all background traffic that would prevent Railway serverless from sleeping:
    // - tracesSampleRate: 0 disables performance tracing
    // - httpIntegration: disables session tracking (autoSessionTracking was removed in v9+)
    tracesSampleRate: 0,
    integrations: [Sentry.httpIntegration({ trackIncomingRequestsAsSessions: false })],
})
*/
