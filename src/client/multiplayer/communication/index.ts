import {
    GameMutationMessage,
    GameRoom,
    MultiplayerMessageType,
    RoomId,
} from '@/shared/types/multiplayer.ts'
import { Key } from '@/client/multiplayer/encryption.ts'
import { MessageHandler } from '@/client/gateway/realtime.ts'
import { ChatMessage } from '@/shared/types/history.ts'

export interface Communication {
    joinRoom(roomId: RoomId, key?: Key): Promise<void>
    leaveRoom(): Promise<void>
    isInRoom(): boolean

    subscribe<T>(messageType: MultiplayerMessageType, handler: MessageHandler<T>): Promise<void>

    sendDeck(): Promise<void>
    rollSeating(): void
    launchGame(gameRoom: GameRoom): Promise<void>
    broadcastGameMutation(message: GameMutationMessage): Promise<void>
    requestResyncGameState(): Promise<void>
    // Ably delivers chat peer-to-peer ( and echoes locally ) ; SCS sends it to the
    // authoritative server, which stores it and rebroadcasts to the room.
    sendChat(message: ChatMessage): Promise<void>

    onReceiveLaunchGame(message: unknown): Promise<void>
}
