import {
    GameMutationMessage,
    GameRoom,
    MultiplayerMessageType,
    RoomId,
} from '@/shared/types/multiplayer.ts'
import { Key } from '@/client/multiplayer/encryption.ts'
import { MessageHandler } from '@/client/gateway/realtime.ts'

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

    onReceiveLaunchGame(message: unknown): Promise<void>
}
