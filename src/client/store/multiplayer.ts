import { defineStore } from 'pinia'
import { useCoreStore } from '@/client/store/core.ts'
import {
    EMPTY_SEATING,
    GameRoom,
    PermanentId,
    RoomId,
    User,
    UserDecks,
    VectorClockVersion,
    VersioningId,
} from '@/shared/types/multiplayer.ts'
import { LamportClock, VectorClock } from '@/shared/multiplayer/clock.ts'
import { GameMutationId } from '@/shared/state/gameMutations.ts'
import { fetchAvatar } from '@/client/gateway/user.ts'
import { AvatarId, DeckList } from '@/shared/types/gateway.ts'
import { MutationHistoryEntry } from '@/shared/types/history.ts'

export const useMultiplayerStore = defineStore('multiplayer', {
    state: () => ({
        /**
         *  Lobby / Room connection
         */

        // id ==> User
        users: {} as Record<PermanentId, User>,

        // Fetched from firebase. avatarId  => encoded image data
        avatars: {} as Record<AvatarId, string>,

        // Known decklists of users in the room
        userDecks: {} as UserDecks,

        // RoomId ==> GameRoom
        gameRooms: {} as Record<RoomId, GameRoom>,

        // The id of the current game room we're connected at
        currentGameRoomId: null as RoomId | null,

        selfIsReady: false,

        password: '',

        /**
         *  Game state synchronization
         */

        // Global Lamport to resolve whole state resync
        globalClock: new LamportClock(useCoreStore().userProfile.permanentId),

        // Per-object Vector Clock Versions
        objectClocks: {} as Record<VersioningId, VectorClock>,

        // Per-mutation Vector Clock Versions, GameMutationId -> Version
        mutationVersions: {} as Record<GameMutationId, VectorClockVersion>,

        // Maintains a map of recent ordered mutations per versioningId that could potentially
        // conflict with incoming mutations. This avoids scanning the entire history.
        conflictWindows: {} as Record<VersioningId, MutationHistoryEntry[]>,
    }),
    getters: {
        selfUser: (state): User => {
            const core = useCoreStore()
            return {
                permId: core.userProfile.permanentId,
                name: core.userProfile.playerName,
                avatarId: core.userProfile.avatarFirebaseId,
                isReady: state.selfIsReady,
            }
        },

        selfDeck: (): DeckList | null => {
            return useCoreStore().selfDeck?.cards ?? null
        },

        hasJoinedLobby: (state): boolean => useCoreStore().userProfile.permanentId in state.users,

        gameRoomNames(state): string[] {
            return Object.values(state.gameRooms).map(room => room.name)
        },

        currentGameRoom: (state): GameRoom | undefined =>
            state.currentGameRoomId ? state.gameRooms[state.currentGameRoomId] : undefined,

        isHostConnected(): boolean {
            return this.currentGameRoom?.players.includes(this.currentGameRoom?.hostId) ?? false
        },
        selfIsHost(): boolean {
            return this.currentGameRoom?.hostId == this.selfUser.permId
        },
        gameRoomUsers(): User[] {
            return (
                this.currentGameRoom?.players.map(permId => this.users[permId]).filter(u => u) ?? []
            )
        },
        sortedGameRoomUsers(): User[] {
            if (!this.currentGameRoom) return []
            return this.gameRoomUsers.toSorted((u1, u2) => u1.name.localeCompare(u2.name))
        },
        seatedGameRoomUsers(): User[] {
            if (
                !this.currentGameRoom ||
                !this.isSeatingReady ||
                !this.currentGameRoom.seating ||
                this.currentGameRoom.seating == EMPTY_SEATING
            ) {
                return []
            }
            return this.currentGameRoom.seating.map(permId => this.users[permId]).filter(u => u)
        },

        areAllUsersReady(): boolean {
            return this.gameRoomUsers.every(user => user.isReady && this.userDecks[user.permId])
        },
        isSeatingReady(): boolean {
            if (
                !this.currentGameRoom ||
                !this.currentGameRoom.seating ||
                this.currentGameRoom.seating == EMPTY_SEATING
            ) {
                return false
            }

            const seatingPermIds = [...this.currentGameRoom.seating].sort()
            const gameRoomPermIds = this.gameRoomUsers.map(user => user.permId).sort()
            return seatingPermIds.join('') == gameRoomPermIds.join('')
        },

        isRoomReady(): boolean {
            return this.areAllUsersReady && this.isSeatingReady
        },
    },
    actions: {
        upsertUser(user: User) {
            this.users[user.permId] = user
            fetchAvatar(user)
        },

        upsertGameRoom(room: GameRoom) {
            this.gameRooms[room.id] = room
        },

        upsertGameRoomPlayer(user: User) {
            if (this.currentGameRoom && !this.currentGameRoom.players.includes(user.permId)) {
                this.currentGameRoom.players.push(user.permId)
            }
        },
        removeGameRoomPlayer(user: User) {
            if (this.currentGameRoom) {
                this.currentGameRoom.players = this.currentGameRoom.players.filter(
                    permId => permId !== user.permId,
                )
            }
        },
        upsertGameRoomSpectator(user: User) {
            if (this.currentGameRoom && !this.currentGameRoom.spectators.includes(user.permId)) {
                this.currentGameRoom.spectators.push(user.permId)
            }
        },
        removeGameRoomSpectator(user: User) {
            if (this.currentGameRoom) {
                this.currentGameRoom.spectators = this.currentGameRoom.spectators.filter(
                    permId => permId !== user.permId,
                )
            }
        },
    },
})
