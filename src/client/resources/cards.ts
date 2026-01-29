import { fetchWithRetry } from '@/client/resources/index.ts'
import { gameResources, setGameResources } from '@/shared/registries.ts'

/**
 * Resource loading
 */

const BASE_URL = import.meta.env.BASE_URL
export const ASSETS_URL = `${BASE_URL}assets`
export const CARDS_PATH = `${ASSETS_URL}/cards/en-EN`
export const ATLAS_PATH = `${ASSETS_URL}/atlas`
export const ATLAS_FREQUENT = 'frequent'

// Add hash for Cache-busting
export const atlasTextureUrl = `${ATLAS_PATH}/${ATLAS_FREQUENT}.webp?v=${ATLAS_TEXTURE_HASH}`
export const atlasJsonUrl = `${ATLAS_PATH}/${ATLAS_FREQUENT}.json?v=${ATLAS_JSON_HASH}`

async function loadOneResourceFile(url: string, destination: keyof typeof gameResources) {
    const response = await fetchWithRetry(url)
    setGameResources(destination, await response.json())
}

export function loadAllResourcesFiles() {
    return [
        loadOneResourceFile(`${ASSETS_URL}/cardbase.json`, 'cardbase'),
        loadOneResourceFile(`${ASSETS_URL}/preconDecks.json`, 'preconDecks'),
        loadOneResourceFile(`${ASSETS_URL}/setsAndPrecons.json`, 'setsAndPrecons'),
        loadOneResourceFile(atlasJsonUrl, 'atlasJson'),
    ]
}
