import { defineConfig, ViteDevServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import { IncomingMessage, ServerResponse } from 'http'
import { createHash } from 'crypto'
import { readFileSync, readdirSync } from 'fs'
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

// Discover atlases from disk so a dynamic number of recent_N files is picked up
// automatically (see generate_atlas_files in script/generate_resource_files.py).
const ATLAS_DIR = 'public/assets/atlas'
const ATLAS_NAMES = readdirSync(resolve(ATLAS_DIR))
    .filter(file => file.endsWith('.webp'))
    .map(file => file.replace(/\.webp$/, ''))
    .sort()

// Generate texture hashes for all atlases
const atlasHashes = Object.fromEntries(
    ATLAS_NAMES.map(name => [
        name,
        {
            texture: hashFile(`${ATLAS_DIR}/${name}.webp`),
            json: hashFile(`${ATLAS_DIR}/${name}.json`),
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
