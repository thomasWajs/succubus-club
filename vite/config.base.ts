import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { ViteDevServer } from 'vite'
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

// Generate texture hashes
const atlasTextureHash = hashFile('public/assets/atlas/frequent.webp')
const atlasJsonHash = hashFile('public/assets/atlas/frequent.json')

// https://vitejs.dev/config/
export default defineConfig({
    base: '/',
    plugins: [vue(), cache_plugin],
    define: {
        ATLAS_TEXTURE_HASH: JSON.stringify(atlasTextureHash),
        ATLAS_JSON_HASH: JSON.stringify(atlasJsonHash),
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
                    @use "@/styles/variables" as *;
                    @use "@/styles/mixins" as *;
                `,
            },
        },
    },

    optimizeDeps: {
        exclude: ['xxhash-wasm'],
    },
})
