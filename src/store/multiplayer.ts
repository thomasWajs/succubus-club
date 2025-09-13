import { defineStore } from 'pinia'
import { useCoreStore } from '@/store/core.ts'
import { GameRoom, PeerId, PermanentId, User, VersionningId } from '@/multiplayer/common.ts'
import { selfId } from 'trystero'
import { LamportClock } from '@/multiplayer/sync.ts'

export const useMultiplayerStore = defineStore('multiplayer', {
    state: () => ({
        /**
         *  Lobby / Room connection
         */

        // id ==> User
        users: {} as Record<PermanentId, User>,

        // name ==> GameRoom
        gameRooms: {} as Record<string, GameRoom>,

        // The name of the current game room we're connected at
        currentGameRoomName: null as string | null,

        selfIsReady: false,

        /**
         *  Game state synchronization
         */

        // Global Lamport to resolve whole state resync
        globalClock: new LamportClock(useCoreStore().userProfile.permanentId),

        // Per-object Lamport versions for LWW mutations
        objectVersions: {} as Record<VersionningId, LamportClock>,

        // dedup for non-LLW mutations
        // A bit overkill, because trystero is reliable delivery
        // seenMutations: new Set(),
    }),
    getters: {
        selfUser: (state): User => {
            const core = useCoreStore()
            return {
                permId: core.userProfile.permanentId,
                peerId: selfId,
                name: core.userProfile.playerName,
                avatar: core.userProfile.avatar,
                isReady: state.selfIsReady,
                deckList: core.selfDeck?.cards ?? null,
            }
        },

        // User.peerId ==> User.permId
        peerMapping: (state): Record<PeerId, PermanentId> => {
            return Object.fromEntries(
                Object.values(state.users).map(user => [user.peerId, user.permId]),
            )
        },
        // Get a user from its peerId
        getUser() {
            return (peerId: PeerId): User | undefined => this.users[this.peerMapping[peerId]]
        },

        hasJoinedLobby: (state): boolean => useCoreStore().userProfile.permanentId in state.users,

        gameRoomNames: (state): string[] => Object.values(state.gameRooms).map(r => r.name),

        currentGameRoom: (state): GameRoom | undefined =>
            state.currentGameRoomName ? state.gameRooms[state.currentGameRoomName] : undefined,

        host(): User | undefined {
            return this.currentGameRoom ? this.users[this.currentGameRoom.hostId] : undefined
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
            if (!this.currentGameRoom || !this.isSeatingReady) return []
            return this.currentGameRoom.seating.map(permId => this.users[permId]).filter(u => u)
        },

        areAllUsersReady(): boolean {
            return this.gameRoomUsers.every(user => user.isReady && user.deckList)
        },
        isSeatingReady(): boolean {
            if (!this.currentGameRoom) return false

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
        },
        removeUser(permId: PermanentId) {
            delete this.users[permId]
        },

        upsertGameRoom(room: GameRoom) {
            this.gameRooms[room.name] = room
        },

        deleteGameRoom(name: string) {
            delete this.gameRooms[name]
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
    },
})
