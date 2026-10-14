import { defineConfig } from 'vite'
import baseConfig from './config.base'

export default defineConfig({
    ...baseConfig,
    server: {
        port: 666,
        proxy: {
            '/api/': {
                target: 'https://o4509598913855488.ingest.de.sentry.io',
                changeOrigin: true,
                secure: false,
            },
        },
    },
})
