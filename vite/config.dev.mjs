import { defineConfig } from 'vite'
import baseConfig from './config.base'

export default defineConfig({
    ...baseConfig,
    server: {
        port: 666,
        fs: {
            // zvtes-wasm is linked from a sibling checkout during development
            allow: ['.', '../zero-vtes/crates/wasm/pkg'],
        },
        proxy: {
            '/api/': {
                target: 'https://o4509598913855488.ingest.de.sentry.io',
                changeOrigin: true,
                secure: false,
            },
        },
    },
})
