import { Discipline, DisciplineLevel, LibraryCardType, Sect } from '@/model/const.ts'
import { DeckList } from '@/gateway/deck.ts'
import { fetchWithRetry } from '@/resources'

/**
 * Resource types
 */

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

export function isCryptId(krcgId: KrcgId) {
    // Krcg id of crypt card begins by 2, library begins by 1
    return krcgId[0] == '2'
}

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

export const gameResources = {
    cardbase: {} as Record<KrcgId, CardResource>,
    preconDecks: {} as Record<setName, Record<deckName, DeckList>>,
    setsAndPrecons: {} as Record<setName, SetAndPrecons>,
    atlasJson: {} as Record<string, never>,
}

async function loadOneResourceFile(url: string, destination: keyof typeof gameResources) {
    const response = await fetchWithRetry(url)
    gameResources[destination] = await response.json()
}

export function loadAllResourcesFiles() {
    return [
        loadOneResourceFile(`${ASSETS_URL}/cardbase.json`, 'cardbase'),
        loadOneResourceFile(`${ASSETS_URL}/preconDecks.json`, 'preconDecks'),
        loadOneResourceFile(`${ASSETS_URL}/setsAndPrecons.json`, 'setsAndPrecons'),
        loadOneResourceFile(atlasJsonUrl, 'atlasJson'),
    ]
}
