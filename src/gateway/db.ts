import Dexie, { Entity, type EntityTable } from 'dexie'
import { toRaw } from 'vue'
import { SerializedGame } from '@/gateway/serialization.ts'
import { GameType } from '@/state/types.ts'
import { setUser } from '@sentry/vue'
import { Deck, DeckList } from '@/gateway/deck.ts'
import { PermanentId } from '@/multiplayer/common.ts'

// If you know, you know ;-)
const DEFAULT_PLAYER_NAME = 'The Unnamed'

export enum DeckSource {
    Precon = 'Precon',
    Vdb = 'VDB',
    Text = 'Text',
}

export class DbUserProfile extends Entity<SuccubusDb> {
    id: number
    permanentId: string
    playerName: string
    avatar: string | null
    preferences: Record<string, never>
    lastDeckId: number | null
    lastMultiGameName: string
    lastMultiGameDate: Date | null

    static async get() {
        let userProfile = await db.userProfile.limit(1).first()
        if (!userProfile) {
            db.userProfile.add({
                permanentId: crypto.randomUUID(),
                playerName: DEFAULT_PLAYER_NAME,
                avatar: null,
                preferences: {},
                lastDeckId: null,
                lastMultiGameName: '',
                lastMultiGameDate: new Date(),
            })
            userProfile = await db.userProfile.limit(1).first()

            // If still undefined after adding, something went wrong
            if (!userProfile) {
                throw new Error('Failed to create or retrieve user profile')
            }
        }

        // Set the Sentry User
        setUser({
            id: userProfile.permanentId,
            username: userProfile.playerName,
        })

        return userProfile
    }

    async save() {
        // toRaw is needed to save as a plain object, without reactivity wrappers
        db.userProfile.put(toRaw(this))

        // Update the Sentry User
        setUser({
            id: this.permanentId,
            username: this.playerName,
        })
    }

    async setLastMultiGame(name: string) {
        this.lastMultiGameName = name
        this.lastMultiGameDate = new Date()
        await this.save()
    }
}

export class DbDeck extends Entity<SuccubusDb> implements Deck {
    id: number
    name: string
    source: DeckSource
    sourceValue: string
    cards: DeckList
    lastUsed: Date

    static async create(name: string, cards: DeckList, source: DeckSource, sourceValue: string) {
        const deckId = await db.decks.add({
            name,
            source,
            sourceValue,
            cards,
            lastUsed: new Date(),
        })
        const deck = await DbDeck.get(deckId)
        if (!deck) {
            throw new Error('Error while creating the deck')
        }
        return deck as DbDeck
    }

    static async get(deckId: number) {
        return (await db.decks.get(deckId)) ?? null
    }

    async delete() {
        await db.decks.delete(this.id)
    }
}

export class DbSavedGame extends Entity<SuccubusDb> {
    id: number
    date: Date
    name: string
    isAutoSave: number // We cannot index boolean with Dexie, so fallback on 0=false / 1=true
    gameType: GameType
    roomName: string
    seating: PermanentId[]
    game: SerializedGame
}

export class SuccubusDb extends Dexie {
    userProfile: EntityTable<DbUserProfile, 'id'>
    decks: EntityTable<DbDeck, 'id'>
    savedGames: EntityTable<DbSavedGame, 'id'>

    constructor() {
        super('SuccubusDb')
        this.version(1).stores({
            userProfile: '++id',
            decks: '++id, lastUsed',
            savedGames: '++id, isAutoSave, date',
        })
        this.userProfile.mapToClass(DbUserProfile)
        this.decks.mapToClass(DbDeck)
        this.savedGames.mapToClass(DbSavedGame)
    }
}

export const db = new SuccubusDb()
