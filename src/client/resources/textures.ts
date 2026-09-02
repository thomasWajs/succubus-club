import { reactive } from 'vue'
import Phaser from 'phaser'
import { ASSETS_URL, ATLASES, atlasUrls, CARDS_PATH } from '@/client/resources/cards.ts'
import { fetchWithRetry } from '@/client/resources/index.ts'
import { useCoreStore } from '@/client/store/core.ts'

export enum Texture {
    BrokenChain = 'brokenChain',
    CardbackCrypt = 'cardbackCrypt',
    CardbackLibrary = 'cardbackLibrary',
    CardGroup = 'cardGroup',
    CardbackCryptLoading = 'cardbackCryptLoading',
    CardbackLibraryLoading = 'cardbackLibraryLoading',
    TheEdge = 'theEdge',
    TheEdgeTeal = 'theEdgeTeal',
}

// Atlas textures loaded before the game starts, keyed by atlas name
export const preloadedAtlasTextures: Record<string, HTMLImageElement> = {}

// Textures loaded before the game starts
export const preloadedTextures = {
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

async function preloadTexture(url: string, store: (img: HTMLImageElement) => void): Promise<void> {
    const textureResponse = await fetchWithRetry(url)
    const imageBlob = await textureResponse.blob()
    const imageUrl = URL.createObjectURL(imageBlob)
    return new Promise<void>(resolve => {
        const img = new Image()
        img.onload = () => {
            store(img)
            URL.revokeObjectURL(imageUrl)
            resolve()
        }
        img.src = imageUrl
    })
}

// Preload texture to speed up game loading
export function preloadAllTextures() {
    const promises: Promise<void>[] = ATLASES.map(name =>
        preloadTexture(atlasUrls[name].texture, img => (preloadedAtlasTextures[name] = img)),
    )

    for (const textureName of Object.values(Texture)) {
        promises.push(
            preloadTexture(
                `${ASSETS_URL}/${textureName}.webp`,
                img => (preloadedTextures[textureName] = img),
            ),
        )
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

export function getFrequentCards(): string[] {
    const textures = useCoreStore().phaserGame.textures
    return ATLASES.flatMap(name => textures.get(name)?.getFrameNames() ?? [])
}

export function getAtlasForCard(cardName: string): string | undefined {
    const textures = useCoreStore().phaserGame.textures
    for (const name of ATLASES) {
        if (textures.exists(name) && textures.get(name)?.has(cardName)) {
            return name
        }
    }
    return undefined
}
