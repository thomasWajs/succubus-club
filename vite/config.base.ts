import { defineConfig, ViteDevServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { IncomingMessage, ServerResponse } from 'http'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Cache card images in the browser
const cache_plugin = {
    name: 'manual-cache',
    configureServer(server: ViteDevServer) {
        server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
            if (req.url?.startsWith('/assets/cards/')) {
                // Cache card images for 365 days
                res.setHeader('Cache-Control', `max-age=${60 * 60 * 24 * 365}`)
            }
            next()
        })
    },
}

function hashFile(filePath: string): string {
    const atlasPath = resolve(filePath)
    const content = readFileSync(atlasPath)
    return createHash('md5').update(content).digest('hex').substring(0, 8)
}

// Generate texture hashes for all atlases
const ATLAS_NAMES = ['recent', 'frequent_0', 'frequent_1', 'frequent_2'] as const
const atlasHashes = Object.fromEntries(
    ATLAS_NAMES.map(name => [
        name,
        {
            texture: hashFile(`public/assets/atlas/${name}.webp`),
            json: hashFile(`public/assets/atlas/${name}.json`),
        },
    ]),
)

// https://vitejs.dev/config/
export default defineConfig({
    base: '/',
    plugins: [vue(), cache_plugin],
    define: {
        ATLAS_HASHES: JSON.stringify(atlasHashes),
    },

    resolve: {
        alias: {
            '@': fileURLToPath(new URL('../src', import.meta.url)),
        },
    },
    css: {
        preprocessorOptions: {
            scss: {
                // Import variables and mixins globally
                additionalData: `
                    @use "@/client/styles/variables" as *;
                    @use "@/client/styles/mixins" as *;
                `,
            },
        },
    },

    optimizeDeps: {
        exclude: ['xxhash-wasm'],
    },
})
