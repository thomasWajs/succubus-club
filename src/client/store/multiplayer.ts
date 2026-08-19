import { defineStore } from 'pinia'
import { useCoreStore } from '@/client/store/core.ts'
import {
    EMPTY_SEATING,
    GameRoom,
    PermanentId,
    RoomId,
    RoomSeat,
    ScsStatus,
    User,
    UserDecks,
    VectorClockVersion,
    VersioningId,
} from '@/shared/types/multiplayer.ts'
import {
    applyRoomSeat,
    getRoomPermIds,
    getRoomSeat,
    releaseRoomSeat,
} from '@/shared/multiplayer/seats.ts'
import { LamportClock, VectorClock } from '@/shared/multiplayer/clock.ts'
import { GameMutationId } from '@/shared/state/gameMutations.ts'
import { fetchAvatar } from '@/client/gateway/user.ts'
import { AvatarId, DeckList } from '@/shared/types/gateway.ts'
import { MutationHistoryEntry } from '@/shared/types/history.ts'
import { DbSavedGame } from '@/client/gateway/db.ts'

export const useMultiplayerStore = defineStore('multiplayer', {
    state: () => ({
        /**
         *  Lobby / Room connection
         */

        // SCS server connection status
        scsStatus: ScsStatus.Connecting,

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

        // Fallback in case the room is deleted in the lobby,
        // but the user is still playing
        currentGameRoomFallback: null as GameRoom | null,

        selfIsReady: false,

        password: '',

        // The saved game being restored (cleared after the game is launched)
        restoringSavedGame: null as DbSavedGame | null,

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

        currentGameRoom(state): GameRoom | undefined {
            const gameRoom =
                state.currentGameRoomId ? state.gameRooms[state.currentGameRoomId] : undefined
            return gameRoom ?? state.currentGameRoomFallback ?? undefined
        },

        isHostConnected(): boolean {
            const gameRoom = this.currentGameRoom
            return gameRoom ? !!this.users[gameRoom.hostId] : false
        },
        selfIsHost(): boolean {
            return this.currentGameRoom?.hostId == this.selfUser.permId
        },
        // Every user in the room, whatever their seat
        allGameRoomUsers(): User[] {
            const gameRoom = this.currentGameRoom
            if (!gameRoom) {
                return []
            }
            return getRoomPermIds(gameRoom)
                .map(permId => this.users[permId])
                .filter(u => u)
        },
        // Players only. Everything that gates the game start is built on this.
        playerUsers(): User[] {
            return (
                this.currentGameRoom?.players.map(permId => this.users[permId]).filter(u => u) ?? []
            )
        },
        judgeUsers(): User[] {
            return (
                this.currentGameRoom?.judges.map(permId => this.users[permId]).filter(u => u) ?? []
            )
        },
        spectatorUsers(): User[] {
            return (
                this.currentGameRoom?.spectators.map(permId => this.users[permId]).filter(u => u) ??
                []
            )
        },
        selfRoomSeat(): RoomSeat | null {
            const gameRoom = this.currentGameRoom
            return gameRoom ? getRoomSeat(gameRoom, this.selfUser.permId) : null
        },
        selfIsPlayer(): boolean {
            return this.selfRoomSeat == RoomSeat.Player
        },
        selfIsJudge(): boolean {
            return this.selfRoomSeat == RoomSeat.Judge
        },
        selfIsSpectator(): boolean {
            return this.selfRoomSeat == RoomSeat.Spectator
        },
        sortedPlayerUsers(): User[] {
            if (!this.currentGameRoom) return []
            return this.playerUsers.toSorted((u1, u2) => u1.name.localeCompare(u2.name))
        },
        seatedPlayerUsers(): User[] {
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

        areAllPlayerUsersReady(): boolean {
            const gameRoom = this.currentGameRoom
            if (!gameRoom) {
                return false
            }
            if (gameRoom.isSavedGame && gameRoom.competingPlayers) {
                // For saved games, only competing players need to be ready
                return gameRoom.competingPlayers.every(permId => {
                    const user = this.users[permId]
                    return user?.isReady ?? false
                })
            }
            // every() is true on an empty array : an empty table is never ready,
            // else we would roll a seating with no player in it.
            return (
                this.playerUsers.length > 0 &&
                this.playerUsers.every(user => user.isReady && this.userDecks[user.permId])
            )
        },

        missingSavedGamePlayers(): boolean {
            const gameRoom = this.currentGameRoom
            if (!gameRoom) {
                return true
            }
            if (!gameRoom.isSavedGame || !gameRoom.competingPlayers) {
                return false
            }

            // Check that all competing players have joined the room
            const playerPermIds = this.playerUsers.map(user => user.permId)
            return !gameRoom.competingPlayers.every(permId => playerPermIds.includes(permId))
        },

        isSeatingReady(): boolean {
            const gameRoom = this.currentGameRoom
            if (!gameRoom || !gameRoom.seating || gameRoom.seating == EMPTY_SEATING) {
                return false
            }

            const seatingPermIds = [...gameRoom.seating].sort()
            const gameRoomPermIds = this.playerUsers.map(user => user.permId).sort()
            return seatingPermIds.join('') == gameRoomPermIds.join('')
        },

        isRoomReady(): boolean {
            return this.areAllPlayerUsersReady && this.isSeatingReady
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

        snapshotCurrentGameRoom() {
            if (this.currentGameRoom) {
                this.currentGameRoomFallback = { ...this.currentGameRoom }
            }
        },

        // Seats are mutually exclusive : always go through these two.
        setGameRoomSeat(permId: PermanentId, seat: RoomSeat) {
            if (this.currentGameRoom) {
                applyRoomSeat(this.currentGameRoom, permId, seat)
            }
        },
        // A disconnecting user only gives up a player seat : see releaseRoomSeat
        releaseGameRoomSeat(permId: PermanentId) {
            if (this.currentGameRoom) {
                releaseRoomSeat(this.currentGameRoom, permId)
            }
        },
    },
})
