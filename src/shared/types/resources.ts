/**
 * Resource types
 */
import { Discipline, DisciplineLevel, LibraryCardType, Sect } from '@/shared/const/model.ts'

export type setName = string
export type deckName = string
export type Disciplines = Record<Discipline, DisciplineLevel>
export type Ruling = {
    text: string
    refs: Record<string, string>
}

export interface CardResource {
    clan: string
    id: number // Here the card id is an integer, but we'll use in string format instead.
    imageName: string
    name: string
    text: string
    rulings: Ruling[]
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

export type SetAndPrecons = {
    name: string
    precons: {
        [key: string]: {
            name: string
            clan: string
        }
    }
}

export type KrcgDeck = {
    name: string
    cards: Array<{ id: number; count: number }>
}
