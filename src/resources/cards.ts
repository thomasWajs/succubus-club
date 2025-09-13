import { Discipline, DisciplineLevel, LibraryCardType, Sect } from '@/model/const.ts'
import { DeckList } from '@/gateway/deck.ts'
import { BACK_TEXTURE_CRYPT, BACK_TEXTURE_LIB, WIELD_CARD_STACK_ICON } from '@/game/const.ts'

export type setName = string
export type deckName = string
// Some resource json use card id in string format, so we'll use string everywhere instead of the integer
export type KrcgId = string

export type Disciplines = Record<Discipline, DisciplineLevel>

export interface CardResource {
    clan: string
    id: number // Here the card id is an integer, but we'll use in string format instead.
    imageName: string
    name: string
    // text: string
}

export interface CryptCardResource extends CardResource {
    adv: string | [boolean, number]
    capacity: number
    disciplines: Disciplines
    group: string
    sect: Sect
    title: string
}

export interface LibraryCardResource extends CardResource {
    blood: number
    // conviction: number,
    discipline: string
    pool: number
    requirement: string
    type: LibraryCardType
}

type SetAndPrecons = {
    name: string
    precons: {
        [key: string]: {
            name: string
            clan: string
        }
    }
}

// const BASE_URL = import.meta.env.VITE_BASE_URL
export const BASE_URL = ''
export const ASSETS_URL = `${BASE_URL}/assets`
export const CARDS_PATH = `${ASSETS_URL}/cards/en-EN`
export const ATLAS_PATH = `${ASSETS_URL}/atlas`
export const ATLAS_FREQUENT = 'frequent'

// Add hash for Cache-busting
export const atlasTextureUrl = `${ATLAS_PATH}/${ATLAS_FREQUENT}.webp?v=${ATLAS_TEXTURE_HASH}`
export const atlasJsonUrl = `${ATLAS_PATH}/${ATLAS_FREQUENT}.json?v=${ATLAS_JSON_HASH}`

export const gameResources = {
    cardbase: {} as Record<KrcgId, CardResource>,
    preconDecks: {} as Record<setName, Record<deckName, DeckList>>,
    setsAndPrecons: {} as Record<setName, SetAndPrecons>,
    atlasJson: {} as Record<string, never>,
}

export const preloadedTextures = {
    atlasTexture: {} as HTMLImageElement,
    [BACK_TEXTURE_CRYPT]: {} as HTMLImageElement,
    [BACK_TEXTURE_LIB]: {} as HTMLImageElement,
    [WIELD_CARD_STACK_ICON]: {} as HTMLImageElement,
}

async function loadOneResourceFile(url: string, destination: keyof typeof gameResources) {
    const response = await fetch(url)
    gameResources[destination] = await response.json()
}

// Preload texture to speed up game loading
async function preloadTexture(textureUrl: string, destination: keyof typeof preloadedTextures) {
    const textureResponse = await fetch(textureUrl)

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

export function loadAllResources() {
    return Promise.all([
        loadOneResourceFile(`${ASSETS_URL}/cardbase.json`, 'cardbase'),
        loadOneResourceFile(`${ASSETS_URL}/preconDecks.json`, 'preconDecks'),
        loadOneResourceFile(`${ASSETS_URL}/setsAndPrecons.json`, 'setsAndPrecons'),
        loadOneResourceFile(atlasJsonUrl, 'atlasJson'),
        preloadTexture(atlasTextureUrl, 'atlasTexture'),
        preloadTexture(`${ASSETS_URL}/${BACK_TEXTURE_CRYPT}.webp`, BACK_TEXTURE_CRYPT),
        preloadTexture(`${ASSETS_URL}/${BACK_TEXTURE_LIB}.webp`, BACK_TEXTURE_LIB),
        preloadTexture(`${ASSETS_URL}/${WIELD_CARD_STACK_ICON}.png`, WIELD_CARD_STACK_ICON),
    ])
}
