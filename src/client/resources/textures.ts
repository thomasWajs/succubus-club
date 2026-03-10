import { reactive } from 'vue'
import Phaser from 'phaser'
import {
    ASSETS_URL,
    ATLAS_FREQUENT,
    atlasTextureUrl,
    CARDS_PATH,
} from '@/client/resources/cards.ts'
import { fetchWithRetry } from '@/client/resources/index.ts'
import { useCoreStore } from '@/client/store/core.ts'

export enum Texture {
    BrokenChain = 'brokenChain',
    CardbackCrypt = 'cardbackCrypt',
    CardbackLibrary = 'cardbackLibrary',
    CardGroup = 'cardGroup',
    CardbackCryptLoading = 'cardbackCryptLoading',
    CardbackLibraryLoading = 'cardbackLibraryLoading',
    WieldCardStack = 'wieldCardStack',
    TheEdge = 'theEdge',
    TheEdgeTeal = 'theEdgeTeal',
}

// Textures loaded before the game starts
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

// All loaded textures, either preloaded or dynamically loaded
export const loadedTextures = reactive(new Set<string>())

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

export function setupTextureListener(scene: Phaser.Scene) {
    scene.textures.on('addtexture', (textureName: string) => {
        loadedTextures.add(textureName)
    })
}

export function isTextureLoaded(cardName: string) {
    return loadedTextures.has(cardName) || getFrequentCards().includes(cardName)
}

export function enqueueTextureLoading(scene: Phaser.Scene, cardName: string) {
    scene.load.image(cardName, `${CARDS_PATH}/${cardName}.webp`)
}

// Load texture dynamically, when a unknown card become known
export function loadTexture(scene: Phaser.Scene, cardName: string) {
    if (!isTextureLoaded(cardName)) {
        enqueueTextureLoading(scene, cardName)
        scene.load.start()
    }
}

export function getFrequentCards() {
    return useCoreStore().phaserGame.textures.get(ATLAS_FREQUENT).getFrameNames()
}
