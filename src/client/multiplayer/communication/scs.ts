import { GameRoom, RoomId } from '@/shared/types/multiplayer.ts'
import { Key } from '@/client/multiplayer/encryption.ts'
import { Communication } from '@/client/multiplayer/communication/index.ts'

/**
 * Implementation of Communication through SCS
 */

export const scsCommunication: Communication = {
    async joinRoom(roomId: RoomId, key?: Key) {},

    async leaveRoom() {},

    isInRoom() {
        return false
    },

    rollSeating() {},

    async launchGame(gameRoom: GameRoom) {},
    onReceiveLaunchGame() {},

    sendGameMutation() {},
    onReceiveGameMutation() {},

    requestResyncGameState() {},
    onReceiveResyncGameState() {},
}
