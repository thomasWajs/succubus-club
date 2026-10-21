import { defineConfig } from 'vite'
import baseConfig from './config.base'

export default defineConfig({
    ...baseConfig,
    server: {
        port: 666,
    },
})
