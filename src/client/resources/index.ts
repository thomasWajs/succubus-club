import { preloadAllTextures } from '@/client/resources/textures.ts'
import { loadAllResourcesFiles } from '@/client/resources/cards.ts'

export async function fetchWithRetry(url: string): Promise<Response> {
    const maxAttempts = 3
    let lastError: Error | undefined

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            const response = await fetch(url)
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`)
            }
            return response
        } catch (error) {
            lastError = error as Error

            // Wait for 1 second before the next attempt
            if (attempt < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 500))
            }
        }
    }

    throw new Error(`Failed to fetch ${url} after 3 attempts: ${lastError?.message}`)
}

export function loadAllResources() {
    return Promise.all([...loadAllResourcesFiles(), ...preloadAllTextures()])
}
