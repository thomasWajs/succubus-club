import {
    GameMutationId,
    GameMutationName,
    GameMutationParams,
} from '@/shared/state/gameMutations.ts'
import { AvatarId, DeckList } from '@/shared/types/gateway.ts'
import { Player } from '@/shared/model/Player.ts'
import { CardRegion } from '@/shared/model/CardRegion.ts'
import { KnownCards, PlayerVision } from '@/shared/types/state.ts'
import { Card } from '@/shared/model/Card.ts'
import { ChatMessage } from '@/shared/types/history.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { GameId, ObjectId } from '@/shared/types/model.ts'

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
}

export type UserDecks = Record<PermanentId, DeckList>

export enum CommunicationMode {
    Ably = 'Ably', // Direct messaging through Ably
    SCS = 'SCS', // Websockets through SCS
}

export enum ScsStatus {
    Connecting = 'Connecting',
    Connected = 'Connected',
    Disconnected = 'Disconnected',
}
export const EMPTY_SEATING = 'EMPTY_SEATING'
export type Seating = PermanentId[] | typeof EMPTY_SEATING
export type GameRoom = {
    id: RoomId
    name: string
    hostId: PermanentId
    communication: CommunicationMode
    isStarted: boolean
    hasPassword: boolean
    passwordHash: string
    enableAids: boolean
    allowSpectators: boolean
    players: PermanentId[] // permanentId in arbitrary order
    seating?: Seating // permanentId in the order of the seating
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
    TargetDeclaration = 'TargetDeclaration',
    Scale = 'Scale',
    Separator = 'Separator',
    Timer = 'Timer',
}

/**
 * Serialization
 */

export type JsonValue =
    | null
    | string
    | number
    | boolean
    | JsonValue[]
    | { [key: string]: JsonValue }

export type Serialized<T> = JsonValue & {
    [K in keyof T]: T[K] extends Date ? string
    : // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    T[K] extends Function ? never
    : T[K] extends object ? Serialized<T[K]>
    : T[K]
}

export type SerializedPlayer = Serialized<Player>
export type SerializedCard = Serialized<Card>
export type SerializedCardRegion = Serialized<CardRegion<Card>>

type GameStateKey = keyof GameState
export type SerializedGameState = {
    cards: Record<string, SerializedCard>
    players: Record<string, SerializedPlayer>
} & { [K in Exclude<GameStateKey, 'cards' | 'players'>]: JsonValue }

export type SerializedGameMutation = {
    gameId: GameId // gameId
    name: GameMutationName // name
    timestamp: string // timestamp
    params: Serialized<GameMutationParams> // params
    authorOid: string // authorOid
    previousState: Serialized<GameMutationParams> // previousState
    cancelsMutationId?: GameMutationId // cancelsMutationId
}

// Here we use a compressed representation of the GameMutation class, to save space.
// It's really not readable, but it works.
export type PackedGameMutation = {
    g: GameId // gameId
    n: GameMutationName // name
    t: string // timestamp
    p: Serialized<GameMutationParams> // params
    a: string // authorOid
    s: Serialized<GameMutationParams> // previousState
    c?: GameMutationId // cancelsMutationId
}

// Same compression strategy than for PackedGameMutation
export type PackedLogEntry = {
    t: number // text as string index in stringPool
    i: string // timestamp
    a: number // authorName as string index in stringPool
    r: number // authorColorRgba as string index in stringPool
    n?: number // cancelText as string index in stringPool
    p?: Serialized<PlayerVision> // playerVision
    c?: JsonValue // card
    m?: GameMutationId // mutationId
}

// Use a more compact PackedGameMutation, instead of SerializedGameMutation
export type PackedMutationHistoryEntry = {
    i: GameMutationId // id
    c: boolean // isIgnoredForCancel
    u: boolean // isUserCancellable
    p: PackedGameMutation // packedMutation
}

export type SerializedChatMessage = Serialized<ChatMessage>

export type SerializedHistory = {
    stringPool: string[]
    logEntries: PackedLogEntry[]
    gameMutations: PackedMutationHistoryEntry[]
    archive?: string
}

export type SerializedGame = {
    version: number
    gameState: SerializedGameState
    history: SerializedHistory
}

export type SerializedMultiplayerGame = SerializedGame & {
    objectClocks: Record<VersioningId, VectorClockVersion>
    mutationVersions: Record<GameMutationId, VectorClockVersion>
}

/**
 * Messaging ( through ably OR SCS )
 */

export enum MultiplayerMessageType {
    SetUser = 'SetUser',

    JoinRoom = 'JoinRoom',
    LeaveRoom = 'LeaveRoom',

    Deck = 'Deck',

    RollSeating = 'RollSeating',
    PickSeat = 'PickSeat',
    LeaveSeat = 'LeaveSeat',

    SetupGame = 'SetupGame',
    LaunchGame = 'LaunchGame',

    GameMutation = 'GameMutation',
    ShuffleCardRegion = 'ShuffleCardRegion',
    RequestResync = 'RequestResync',
    GameState = 'GameState', // Send a whole game state

    Chat = 'Chat',

    Error = 'Error',
}

export type DeckMessage = {
    permId: PermanentId
    deckList: DeckList // Full deck or card counts (SCS-to-client)
}

export type PickSeatMessage = {
    permId: PermanentId
    position: number
}

export type LeaveSeatMessage = {
    permId: PermanentId
}

export type GameMutationMessage = {
    gameMutation: PackedGameMutation
    gameMutationId: GameMutationId
    globalVersion: LamportClockVersion // Always needed
    version?: VectorClockVersion // Only needed for Ordered mutations
    knownCards?: KnownCards // Sent by the server in SCS mode
}

export type ErrorMessage = {
    type: MultiplayerMessageType.Error
    message: string
}

/**
 * Ably
 */

export type AblyLaunchGameMessage = {
    gameStateId: string
}

export type AblyRequestResyncMessage = {
    syncChannelName: string
}

export type AblyGameStateMessage = {
    gameStateId: string
    globalVersion: LamportClockVersion
    hash: number
}

export type AblyMessage =
    | DeckMessage
    | AblyLaunchGameMessage
    | PickSeatMessage
    | LeaveSeatMessage
    | GameMutationMessage
    | AblyRequestResyncMessage
    | AblyGameStateMessage
    | SerializedChatMessage

/**
 * SCS
 */

// Client → Server messages
export type SetUserMessage = {
    type: MultiplayerMessageType.SetUser
    permId: PermanentId
    name: string
    isReady: boolean
}

export type ScsDeckMessage = DeckMessage & {
    type: MultiplayerMessageType.Deck
}

export type JoinRoomMessage = {
    type: MultiplayerMessageType.JoinRoom
    roomId: RoomId
    passwordHash: string
}

export type LeaveRoomMessage = {
    type: MultiplayerMessageType.LeaveRoom
}

export type RollSeatingMessage = {
    type: MultiplayerMessageType.RollSeating
}

export type ScsSetupGameMessage = {
    type: MultiplayerMessageType.SetupGame
}

export type ScsGameMutationMessage = GameMutationMessage & {
    type: MultiplayerMessageType.GameMutation
}

export type ScsShuffleCardRegionMessage = {
    type: MultiplayerMessageType.ShuffleCardRegion
    cardRegionOid: ObjectId
    globalVersion: LamportClockVersion
    version: VectorClockVersion
}

export type ScsRequestResyncMessage = {
    type: MultiplayerMessageType.RequestResync
}

export type ScsClientMessage =
    | SetUserMessage
    | ScsDeckMessage
    | JoinRoomMessage
    | LeaveRoomMessage
    | RollSeatingMessage
    | ScsSetupGameMessage
    | ScsGameMutationMessage
    | ScsShuffleCardRegionMessage
    | ScsRequestResyncMessage

// Server → Client messages
export type ScsRollSeatingMessage = {
    type: MultiplayerMessageType.RollSeating
    seating: PermanentId[]
}

export type ScsLaunchGameMessage = {
    type: MultiplayerMessageType.LaunchGame
    serializedGame: SerializedMultiplayerGame
}

export type ScsGameStateMessage = {
    type: MultiplayerMessageType.GameState
    serializedGame: SerializedMultiplayerGame
    globalVersion: LamportClockVersion
    hash: number
}

export type ScsServerMessage =
    | ScsDeckMessage
    | ScsRollSeatingMessage
    | ScsLaunchGameMessage
    | ScsGameMutationMessage
    | ScsGameStateMessage
    | ErrorMessage
