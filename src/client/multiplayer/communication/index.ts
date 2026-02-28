import { GameRoom, RoomId } from '@/shared/types/multiplayer.ts'
import { Key } from '@/client/multiplayer/encryption.ts'

export interface Communication {
    joinRoom(roomId: RoomId, key?: Key): Promise<void>
    leaveRoom(): Promise<void>
    isInRoom(): boolean

    rollSeating(): void

    launchGame(gameRoom: GameRoom): Promise<void>
    onReceiveLaunchGame(): void

    sendGameMutation(): void
    onReceiveGameMutation(): void

    requestResyncGameState(): void
    onReceiveResyncGameState(): void
}
