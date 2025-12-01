import { DeckList } from '@/gateway/deck.ts'
import { SerializedGameMutation } from '@/gateway/serialization.ts'
import { GameMutationId } from '@/state/gameMutations.ts'
import { AvatarId } from '@/gateway/user.ts'

/**
 * Types for user matching
 */

export type PermanentId = string
export type RoomId = string

export type User = {
    permId: PermanentId // The permanentId of the User
    name: string
    avatarId: AvatarId | null
    isReady: boolean
    deckList: DeckList | null
}

export type GameRoom = {
    id: RoomId
    name: string
    hostId: PermanentId
    isStarted: boolean
    hasPassword: boolean
    passwordHash: string
    allowSpectators: boolean
    players: PermanentId[] // permanentId in arbitrary order
    seating?: PermanentId[] // permanentId in the order of the seating
    spectators: PermanentId[] // permanentId in arbitrary order
}

/**
 * Game State Sync
 */

export enum MutationSyncMode {
    Ordered = 'Ordered', // Must apply in order
    Merge = 'Merge', // Always apply all mutations to merge them
    Exclusive = 'Exclusive', // Cannot happen concurrently, only one Player is allowed to do it
}

export type Tick = number

// Versioning with Lamport Clock
export type LamportClockVersion = {
    tick: Tick
    permId: PermanentId
}

// Versioning with Lamport Clock
export type VectorClockVersion = Record<PermanentId, Tick>

// Identify target of mutations that must be synced
export type VersioningId = string

export enum VersioningTarget {
    Turn = 'Turn',
    TurnPhase = 'TurnPhase',
    TheEdge = 'TheEdge',
    Marker = 'Marker',
    Card = 'Card',
    Reveal = 'Reveal',
    Shuffle = 'Shuffle',
    Arrow = 'Arrow',
    Scale = 'Scale',
    Timer = 'Timer',
}

export type GameMutationMessage = {
    gameMutation: SerializedGameMutation
    gameMutationId: GameMutationId
    globalVersion: LamportClockVersion // Always needed
    version?: VectorClockVersion // Only needed for Ordered mutations
}

export type GameStateSyncMessage = {
    gameStateId: string
    globalVersion: LamportClockVersion
    hash: number
}

/**
 * Pub/Sub message types
 */

export enum PubsubMessageType {
    LaunchGame = 'LaunchGame',
    GameMutation = 'GameMutation',
    Chat = 'Chat',
    RequestResync = 'RequestResync',
    Resync = 'Resync',
}
