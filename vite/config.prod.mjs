import { defineConfig } from 'vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import baseConfig from './config.base'

const phasermsg = () => {
    const line = '----------------------------------------'
    const msg = 'Your production build is ready for deployment!'

    return {
        name: 'phasermsg',
        buildStart() {
            process.stdout.write(`Building for production...\n`)
        },
        buildEnd() {
            process.stdout.write(`${line}\n${msg}\n${line}\n`)
            process.stdout.write(`✨ Done ✨\n`)
        },
    }
}

export default defineConfig({
    ...baseConfig,
    plugins: [
        ...baseConfig.plugins,
        phasermsg(),
        sentryVitePlugin({
            authToken: process.env.SENTRY_AUTH_TOKEN,
            org: 'thomas-wajs',
            project: 'succubus-club',
        }),
    ],
    logLevel: 'warning',
    build: {
        // target: "baseline-widely-available",
        target: 'ES2023',
        sourcemap: true,
        rollupOptions: {
            output: {
                manualChunks: {
                    phaser: ['phaser'],
                    vue: ['vue', 'pinia'],
                    db: ['dexie'],
                },
            },
        },
        minify: 'terser',
        terserOptions: {
            compress: {
                passes: 2,
            },
            mangle: true,
            format: {
                comments: false,
            },
        },
    },
})
