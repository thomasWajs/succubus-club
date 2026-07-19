import { fetchWithRetry } from '@/client/resources/index.ts'
import { gameResources, setGameResources } from '@/shared/registries.ts'

/**
 * Resource loading
 */

declare const ATLAS_HASHES: Record<string, { texture: string; json: string }>

const BASE_URL = import.meta.env.BASE_URL
export const ASSETS_URL = `${BASE_URL}assets`
export const CARDS_PATH = `${ASSETS_URL}/cards/en-EN`
export const ATLAS_PATH = `${ASSETS_URL}/atlas`

// Derived from the atlases discovered at build time (see ATLAS_HASHES in the vite
// config), so a dynamic number of recent_N atlases is picked up automatically.
export type AtlasName = string
export const ATLASES: AtlasName[] = Object.keys(ATLAS_HASHES)

// Add hash for Cache-busting
export const atlasUrls = Object.fromEntries(
    ATLASES.map(name => [
        name,
        {
            texture: `${ATLAS_PATH}/${name}.webp?v=${ATLAS_HASHES[name].texture}`,
            json: `${ATLAS_PATH}/${name}.json?v=${ATLAS_HASHES[name].json}`,
        },
    ]),
) as Record<AtlasName, { texture: string; json: string }>

async function loadOneResourceFile(url: string, destination: keyof typeof gameResources) {
    const response = await fetchWithRetry(url)
    setGameResources(destination, await response.json())
}

async function loadAtlasJson(name: AtlasName, url: string) {
    const response = await fetchWithRetry(url)
    gameResources.atlasJsons[name] = await response.json()
}

export function loadAllResourcesFiles() {
    return [
        loadOneResourceFile(`${ASSETS_URL}/cardbase.json`, 'cardbase'),
        loadOneResourceFile(`${ASSETS_URL}/preconDecks.json`, 'preconDecks'),
        loadOneResourceFile(`${ASSETS_URL}/setsAndPrecons.json`, 'setsAndPrecons'),
        ...ATLASES.map(name => loadAtlasJson(name, atlasUrls[name].json)),
    ]
}
