import { useMultiplayerStore } from '@/store/multiplayer.ts'
import { Room } from 'trystero'
import {
    joinRoom,
    GameRoom,
    makeNetAction,
    onPeerDisconnect,
    PeerId,
    TRYSTERO_CONFIG,
    User,
    GameMutationMessage,
    GameStateSyncMessage,
} from '@/multiplayer/common.ts'
import { resetState, setupMultiplayerGame, startGame } from '@/game/setup.ts'
import { GameType } from '@/state/types.ts'
import {
    deserializeObject,
    loadGame,
    SerializedChatMessage,
    SerializedGame,
    serializeGame,
    serializeObject,
} from '@/gateway/serialization.ts'
import { shuffleArray, TimeoutError, waitUntil } from '@/utils.ts'
import { useBusStore } from '@/store/bus.ts'
import * as logging from '@/logging.ts'
import { lobbyActions } from '@/multiplayer/lobby.ts'
import { watch, WatchHandle } from 'vue'
import { useCoreStore } from '@/store/core.ts'
import {
    applyGameResync,
    applyPeerMutation,
    makeMutationMessage,
    makeResyncGameStateMessage,
    startGameResync,
} from '@/multiplayer/sync.ts'
import { AnyGameMutation } from '@/state/gameMutations.ts'
import { ChatMessage, useHistoryStore } from '@/store/history.ts'

type RoomActions = ReturnType<typeof makeRoomActions>
let roomActions: RoomActions | null = null
let currentRoom: Room | null = null
let unwatchGameRoom: WatchHandle | null = null

function makeRoomActions(room: Room) {
    return {
        // Param : Initial GameState, Serialized
        launchGame: makeNetAction<SerializedGame>(room, 'launchGame', onReceiveLaunchGame),
        // Param : Serialized GameMutation
        broadcastGameMutation: makeNetAction<GameMutationMessage>(
            room,
            'b7tMutation',
            onReceiveGameMutation,
        ),
        broadcastChatMessage: makeNetAction<SerializedChatMessage>(
            room,
            'b7tChat',
            onReceiveChatMessage,
        ),
        // Param : None
        requestResyncGameState: makeNetAction<null>(
            room,
            'reqResync',
            onReceiveRequestResyncGameState,
        ),
        // Param : Current GameState, Serialized
        resyncGameState: makeNetAction<GameStateSyncMessage>(
            room,
            'resync',
            onReceiveResyncGameState,
        ),
    }
}

function canUserBeAPlayer(gameRoom: GameRoom, user: User): boolean {
    if (gameRoom.isStarted) {
        // Started games only accept players existing in the seating
        return gameRoom.seating.includes(user.permId)
    } else {
        // Pending games accept new players up until 5 players
        return gameRoom.players.length < 5 || gameRoom.players.includes(user.permId)
    }
}

export function joinGameRoom(gameRoom: GameRoom) {
    const multiplayer = useMultiplayerStore()
    const bus = useBusStore()

    // We're already there : do nothing
    if (multiplayer.currentGameRoomName == gameRoom.name) {
        return
    }

    // Leave any previous room
    leaveGameRoom()

    try {
        currentRoom = joinRoom(TRYSTERO_CONFIG, gameRoom.name)
    } catch (e) {
        logging.captureException(e)
        bus.alertError('Error joining game room. Please try again')
        return
    }
    roomActions = makeRoomActions(currentRoom)

    multiplayer.currentGameRoomName = gameRoom.name
    if (canUserBeAPlayer(gameRoom, multiplayer.selfUser)) {
        multiplayer.upsertGameRoomPlayer(multiplayer.selfUser)
    }

    // The host is responsible for sending game room updates to the other players
    if (multiplayer.selfIsHost) {
        setupGameRoomWatcher()
    }

    /**
     * Set up room event handlers
     */

    currentRoom.onPeerJoin(onPeerJoin)
    currentRoom.onPeerLeave(onPeerLeave)
}

function onPeerJoin(peerId: PeerId) {
    const multiplayer = useMultiplayerStore()
    const bus = useBusStore()
    const user = multiplayer.getUser(peerId)
    const gameRoom = multiplayer.currentGameRoom

    if (!user || !gameRoom) {
        return
    }

    if (canUserBeAPlayer(gameRoom, user)) {
        multiplayer.upsertGameRoomPlayer(user)
    }

    // If a peer join while the game is started AND he can be a player,
    // then it's a reconnection
    if (gameRoom.isStarted && gameRoom.seating.includes(user.permId)) {
        bus.alertSuccess(`${user.name} has reconnected into the game room.`)
    }
}

function onPeerLeave(peerId: PeerId) {
    onPeerDisconnect(peerId, false)
}

export function setupGameRoomWatcher() {
    // Watcher is already active, do nothing.
    if (unwatchGameRoom) {
        return
    }

    const multiplayer = useMultiplayerStore()

    // Watch for changes to currentGameRoom and broadcast when it updates
    unwatchGameRoom = watch(
        () => multiplayer.currentGameRoom,
        gameRoom => {
            if (gameRoom && multiplayer.selfIsHost) {
                lobbyActions?.broadcastGameRoom.send(gameRoom)
            }
        },
        { deep: true }, // Watch for deep changes in the gameRoom object
    )
}

/** Chat Messages */

export function broadcastChatMessage(message: ChatMessage) {
    const gameRoom = ensureGameRoom()
    if (!gameRoom.isStarted) {
        throw new Error(`Game is not started`)
    }
    roomActions?.broadcastChatMessage.send(serializeObject(message))
}

function onReceiveChatMessage(serializedMessage: SerializedChatMessage) {
    const chatMessage = deserializeObject(serializedMessage) as ChatMessage
    useHistoryStore().addChatMessage(chatMessage)
}

/** Game Room Messages */

function ensureGameRoom(): GameRoom {
    const multiplayer = useMultiplayerStore()
    if (!roomActions || !multiplayer.currentGameRoom) {
        throw new Error(`Not in a game room`)
    }
    return multiplayer.currentGameRoom
}

export function leaveGameRoom() {
    const multiplayer = useMultiplayerStore()

    // We're not in a room, do nothing.
    if (!currentRoom) {
        return
    }

    // We're the last user in the room, we can delete it.
    if (multiplayer.gameRoomUsers.length == 1 && multiplayer.currentGameRoomName) {
        lobbyActions?.deleteGameRoom.send(multiplayer.currentGameRoomName)
        multiplayer.deleteGameRoom(multiplayer.currentGameRoomName)
    }

    currentRoom.leave()
    currentRoom = null
    roomActions = null
    unwatchGameRoom?.()
    unwatchGameRoom = null
    multiplayer.selfIsReady = false
    multiplayer.currentGameRoomName = null
}

export function rollSeating() {
    const gameRoom = ensureGameRoom()
    // Cannot roll seating on a game that's already started
    if (gameRoom.isStarted) {
        throw new Error(`Game already started`)
    }

    gameRoom.seating = shuffleArray<string>(gameRoom.players)
}

export function launchGame() {
    const core = useCoreStore()
    const gameRoom = ensureGameRoom()
    // Cannot launch a game that's already started
    if (gameRoom.isStarted || core.gameIsStarted) {
        throw new Error(`Game already started`)
    }

    setupMultiplayerGame(gameRoom)
    const gameState = serializeGame()
    roomActions?.launchGame.send(gameState)
    core.userProfile.setLastMultiGame(gameRoom.name)
    gameRoom.isStarted = true
    startGame(GameType.Multiplayer)
}

function onReceiveLaunchGame(serializedGame: SerializedGame) {
    const core = useCoreStore()
    const gameRoom = ensureGameRoom()
    // Cannot launch a game if we're already in one
    if (core.gameIsStarted) {
        return
    }

    resetState()
    loadGame(serializedGame)
    startGame(GameType.Multiplayer)
    core.userProfile.setLastMultiGame(gameRoom.name)
}

export async function reconnectIntoGame(gameRoom?: GameRoom) {
    const bus = useBusStore()

    if (gameRoom) {
        const multiplayer = useMultiplayerStore()

        joinGameRoom(gameRoom)

        // Wait to be connected with other players to continue
        try {
            // First : try to connect to all players
            await waitUntil(
                () => {
                    if (!multiplayer.currentGameRoom || !currentRoom) {
                        return false
                    }

                    // The peerId of the trystero room
                    const peerIds = Object.keys(currentRoom.getPeers() ?? [])

                    // For each player connected in the game room
                    for (const playerPermId of multiplayer.currentGameRoom.players) {
                        // Ignore ourself
                        if (playerPermId == multiplayer.selfUser.permId) {
                            continue
                        }
                        // If we're not connected to that player yet...
                        if (!peerIds.includes(multiplayer.users[playerPermId].peerId)) {
                            // ...wait until we are
                            return false
                        }
                    }
                    // We've seen every player, we can go on with the resync
                    return true
                },
                200,
                30,
            )
        } catch (error) {
            // If we're connected to at least one player, we still go on with the resync,
            // hoping to connect to the other players later
            if (error instanceof TimeoutError && currentRoom && multiplayer.currentGameRoom) {
                const peerIds = Object.keys(currentRoom.getPeers() ?? [])
                const nbPlayersConnected = multiplayer.currentGameRoom.players.filter(
                    playerPermId => peerIds.includes(multiplayer.users[playerPermId].peerId),
                ).length
                // Nope, no players connected, we can't go on with the resync'
                if (nbPlayersConnected == 0) {
                    throw error
                }
            } else {
                throw error
            }
        }
    }

    bus.isResyncing = true

    resetState()
    startGame(GameType.Multiplayer)
    requestResyncGameState()
}

/** Game Mutation Messages */

export function broadcastGameMutation(gameMutation: AnyGameMutation) {
    const gameRoom = ensureGameRoom()
    if (!gameRoom.isStarted) {
        throw new Error(`Game is not started`)
    }

    makeMutationMessage(gameMutation).then(message => {
        roomActions?.broadcastGameMutation.send(message)
    })
}

async function onReceiveGameMutation(gameMutationMessage: GameMutationMessage) {
    const gameRoom = ensureGameRoom()
    // Cannot receive mutations if the game is not started
    if (!gameRoom.isStarted) {
        return
    }

    await applyPeerMutation(gameMutationMessage)
}

/** State Sync Messages */

export function requestResyncGameState(isUserRequest: boolean = false) {
    const gameRoom = ensureGameRoom()
    if (!gameRoom.isStarted) {
        throw new Error(`Game is not started`)
    }

    startGameResync(isUserRequest)

    // Ask everyone, and use the more recent state ( according to global clock )
    roomActions?.requestResyncGameState.send(null)
}

export function onReceiveRequestResyncGameState(_: null, peerId: PeerId) {
    const gameRoom = ensureGameRoom()
    if (!gameRoom.isStarted) {
        throw new Error(`Game is not started`)
    }

    makeResyncGameStateMessage().then(syncMessage => {
        roomActions?.resyncGameState.send(syncMessage, peerId)
    })
}

export async function onReceiveResyncGameState(syncMessage: GameStateSyncMessage) {
    const gameRoom = ensureGameRoom()
    // Cannot receive sync state if the game is not started
    if (!gameRoom.isStarted) {
        return
    }

    await applyGameResync(syncMessage)
}
