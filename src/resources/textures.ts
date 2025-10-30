import { ASSETS_URL, atlasTextureUrl } from '@/resources/cards.ts'
import { fetchWithRetry } from '@/resources'

export enum Texture {
    CardbackCrypt = 'cardbackCrypt',
    CardbackLibrary = 'cardbackLibrary',
    WieldCardStack = 'wieldCardStack',
    TheEdge = 'theEdge',
    TheEdgeTeal = 'theEdgeTeal',
}

export const preloadedTextures = {
    atlasTexture: {} as HTMLImageElement,
    ...Object.values(Texture).reduce(
        (acc, textureName) => {
            acc[textureName] = {} as HTMLImageElement
            return acc
        },
        {} as Record<Texture, HTMLImageElement>,
    ),
}

async function preloadTexture(textureUrl: string, destination: keyof typeof preloadedTextures) {
    const textureResponse = await fetchWithRetry(textureUrl)

    // Create and store the image
    const imageBlob = await textureResponse.blob()
    const imageUrl = URL.createObjectURL(imageBlob)

    return new Promise<void>(resolve => {
        const img = new Image()
        img.onload = () => {
            preloadedTextures[destination] = img
            URL.revokeObjectURL(imageUrl) // Clean up the blob URL
            resolve()
        }
        img.src = imageUrl
    })
}

// Preload texture to speed up game loading
export function preloadAllTextures() {
    const promises = [preloadTexture(atlasTextureUrl, 'atlasTexture')]

    for (const textureName of Object.values(Texture)) {
        promises.push(preloadTexture(`${ASSETS_URL}/${textureName}.webp`, textureName))
    }
    return promises
}
