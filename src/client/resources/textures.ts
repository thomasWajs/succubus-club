import { reactive } from 'vue'
import Phaser from 'phaser'
import { ASSETS_URL, ATLASES, atlasUrls, CARDS_PATH } from '@/client/resources/cards.ts'
import { fetchWithRetry } from '@/client/resources/index.ts'
import { useCoreStore } from '@/client/store/core.ts'
import * as logging from '@/client/logging.ts'
import { IconName, iconSvg } from '@/client/resources/icons.ts'

export enum Texture {
    BrokenChain = 'brokenChain',
    CardbackCrypt = 'cardbackCrypt',
    CardbackLibrary = 'cardbackLibrary',
    CardGroup = 'cardGroup',
    CardbackCryptLoading = 'cardbackCryptLoading',
    CardbackLibraryLoading = 'cardbackLibraryLoading',
    TheEdgeEmblem = 'theEdgeEmblem',
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

// A card image whose loading failed is asked again, a few times : without it, the card shows
// its loading back for good
const LOAD_RETRIES = 3
const LOAD_RETRY_DELAY = 1000
const loadAttempts = new Map<string, number>()
const retrying = new WeakSet<Phaser.Loader.LoaderPlugin>()

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

// Icons drawn on the canvas, keyed by `iconTextureKey`
export const CANVAS_ICONS: IconName[] = ['active', 'burn', 'decrease', 'disconnected', 'increase']
export const CANVAS_ICON_SIZE = 64
export const preloadedIconTextures: Partial<Record<IconName, HTMLCanvasElement>> = {}

export function iconTextureKey(icon: IconName): string {
    return `icon-${icon}`
}

// A horizontal fade, opaque white in the centre to transparent on both ends : stretched over a game
// object and tinted, it gives a gradient that follows the object ( a post FX gradient spans the
// whole screen instead )
export const FADE_TEXTURE_KEY = 'fade-center'
export const FADE_TEXTURE_WIDTH = 512
export const FADE_TEXTURE_HEIGHT = 32

// Drawn faintly, a fade only spans a dozen colour levels on screen : the steps between them show as
// vertical bars, all the more when the fade moves. A noise on the alpha ( dithering ) breaks them.
// It is sized to about half a colour level once on screen : below, bands come back, above, it
// shows as grain. So it depends on the opacity the fade is drawn at, and on the colour gap between
// its tint and what it covers. Returns the noise amplitude, in alpha levels.
const FADE_DITHER_ON_SCREEN = 0.6
const FADE_DITHER_MAX = 64

export function fadeDither(alpha: number, tint: Phaser.Display.Color, under: Phaser.Display.Color) {
    const gap = Math.max(
        Math.abs(tint.red - under.red),
        Math.abs(tint.green - under.green),
        Math.abs(tint.blue - under.blue),
    )
    if (alpha <= 0 || gap == 0) {
        return 0
    }
    return Math.min(FADE_DITHER_MAX, (FADE_DITHER_ON_SCREEN * 255) / (alpha * gap))
}

export function createFadeTexture(dither: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = FADE_TEXTURE_WIDTH
    canvas.height = FADE_TEXTURE_HEIGHT
    const context = canvas.getContext('2d')
    if (!context) {
        return canvas
    }
    const image = context.createImageData(FADE_TEXTURE_WIDTH, FADE_TEXTURE_HEIGHT)
    for (let x = 0; x < FADE_TEXTURE_WIDTH; x++) {
        // A bell ( raised cosine ), flat at its top and at both ends : a straight fade creases
        // there, and the crease shows as a line
        const distance = Math.abs((x + 0.5) / FADE_TEXTURE_WIDTH - 0.5) * 2
        const alpha = 255 * (0.5 + 0.5 * Math.cos(Math.PI * distance))
        for (let y = 0; y < FADE_TEXTURE_HEIGHT; y++) {
            // Triangular noise : smoother than a uniform one for the same amplitude
            const noise = (Math.random() + Math.random() - 1) * dither
            const index = (y * FADE_TEXTURE_WIDTH + x) * 4
            image.data[index] = 255
            image.data[index + 1] = 255
            image.data[index + 2] = 255
            image.data[index + 3] = Math.min(255, Math.max(0, Math.round(alpha + noise)))
        }
    }
    context.putImageData(image, 0, 0)
    return canvas
}

// Like on the HTML side, only the icon shape counts : it is filled with white, so a tint gives it
// any colour. Rasterized larger than its display size, for zoom and hi-dpi screens.
function preloadIconTexture(icon: IconName): Promise<void> {
    const svg = new DOMParser().parseFromString(iconSvg(icon), 'image/svg+xml')
    // An SVG without a size can't be drawn on a canvas
    svg.documentElement.setAttribute('width', `${CANVAS_ICON_SIZE}`)
    svg.documentElement.setAttribute('height', `${CANVAS_ICON_SIZE}`)
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' })
    const imageUrl = URL.createObjectURL(blob)

    return new Promise<void>(resolve => {
        const img = new Image()
        img.onload = () => {
            const canvas = document.createElement('canvas')
            canvas.width = CANVAS_ICON_SIZE
            canvas.height = CANVAS_ICON_SIZE
            const context = canvas.getContext('2d')
            if (context) {
                context.drawImage(img, 0, 0, CANVAS_ICON_SIZE, CANVAS_ICON_SIZE)
                context.globalCompositeOperation = 'source-in'
                context.fillStyle = 'white'
                context.fillRect(0, 0, CANVAS_ICON_SIZE, CANVAS_ICON_SIZE)
                preloadedIconTextures[icon] = canvas
            }
            URL.revokeObjectURL(imageUrl)
            resolve()
        }
        img.onerror = () => {
            logging.captureException(new Error(`Icon texture failed to load : ${icon}`))
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

    for (const icon of CANVAS_ICONS) {
        promises.push(preloadIconTexture(icon))
    }
    return promises
}

export function setupTextureListener(scene: Phaser.Scene) {
    // A new Phaser game starts with an empty texture manager : the images loaded on demand by an
    // earlier game in this page are gone with it, and must be loaded again
    loadedTextures.clear()
    loadAttempts.clear()
    scene.textures.on('addtexture', (textureName: string) => {
        loadedTextures.add(textureName)
    })
}

export function isTextureLoaded(cardName: string) {
    return loadedTextures.has(cardName) || getFrequentCards().includes(cardName)
}

export function enqueueTextureLoading(scene: Phaser.Scene, cardName: string) {
    scene.load.image(cardName, `${CARDS_PATH}/${cardName}.avif`)
}

function retryFailedLoads(scene: Phaser.Scene) {
    if (retrying.has(scene.load)) {
        return
    }
    retrying.add(scene.load)
    scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
        const attempts = loadAttempts.get(file.key) ?? 0
        if (file.type != 'image' || isTextureLoaded(file.key) || !loadAttempts.has(file.key)) {
            return
        }
        if (attempts >= LOAD_RETRIES) {
            logging.captureMessage(
                `The image of ${file.key} failed to load ( ${file.url} )`,
                'warning',
            )
            return
        }
        loadAttempts.set(file.key, attempts + 1)
        setTimeout(
            () => {
                if (!isTextureLoaded(file.key)) {
                    enqueueTextureLoading(scene, file.key)
                    scene.load.start()
                }
            },
            LOAD_RETRY_DELAY * (attempts + 1),
        )
    })
}

// Load texture dynamically, when a unknown card become known
export function loadTexture(scene: Phaser.Scene, cardName: string) {
    if (!isTextureLoaded(cardName)) {
        retryFailedLoads(scene)
        if (!loadAttempts.has(cardName)) {
            loadAttempts.set(cardName, 0)
        }
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
