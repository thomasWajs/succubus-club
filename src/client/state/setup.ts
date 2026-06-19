import { ORDERED_PLAYER_COLORS } from '@/shared/const/game.ts'
import { GovernBot } from '@/client/bot/governBot.ts'
import { Conductor } from '@/client/bot/conductor.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { EMPTY_SEATING, GameRoom } from '@/shared/types/multiplayer.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { GameType } from '@/shared/types/state.ts'
import { loadGame } from '@/client/gateway/serialization.ts'
import { DbSavedGame } from '@/client/gateway/db.ts'
import { initAutoSaveGame, stopAutoSaveGame } from '@/client/gateway/savedGames.ts'
import router, { ROUTES } from '@/client/ui/router.ts'
import { useHistoryStore } from '@/client/store/history.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { resetSync } from '@/client/multiplayer/sync.ts'
import { startClock, stopClock, useTimer } from '@/shared/state/useTimer.ts'
import { generateGameId } from '@/shared/state/ids.ts'
import { BOT_NAME, BOT_PERM_ID, NB_BOTS } from '@/shared/const/bot.ts'
import { hasGameState, registerGameState } from '@/shared/registries.ts'
import { shuffleArray } from '@/shared/utils.ts'
import { leaveMultiplayer } from '@/client/multiplayer/lobby.ts'
import { setupMultiplayerGameState, setupPlayArea } from '@/shared/state/setup.ts'

export function resetState() {
    const core = useCoreStore()
    const gameState = useGameStateStore()

    resetSync()

    if (hasGameState(gameState.gameId)) {
        useTimer(gameState.gameId).resetTimer()
    }

    useGameStateStore().$reset()
    useHistoryStore().$reset()
    useGameBusStore().$reset()

    core.gameIsStarted = false
    core.phaserIsReady = false
    core.gameStateIsReady = false
    core.conductor = null
}

export function setupTrainGame() {
    const core = useCoreStore()
    const gameState = useGameStateStore()

    if (!core.selfDeck) {
        throw new Error(`No deck list`)
    }

    resetState()

    // noinspection JSConstantReassignment
    gameState.gameId = generateGameId()
    registerGameState(gameState.gameId, gameState)

    const selfPlayer = gameState.createPlayer(
        core.userProfile.playerName,
        ORDERED_PLAYER_COLORS[0],
        core.userProfile.permanentId,
    )
    gameState.usersToPlayer[core.userProfile.permanentId] = selfPlayer.oid
    setupPlayArea(gameState, selfPlayer, core.selfDeck.cards)

    for (let i = 0; i < NB_BOTS; i++) {
        const botPlayer = gameState.createPlayer(
            `${BOT_NAME}${i + 1}`,
            ORDERED_PLAYER_COLORS[i + 1],
            BOT_PERM_ID + i,
        )
        const bot = new GovernBot(botPlayer)
        if (i == 0) {
            core.conductor = new Conductor(bot)
        }
        setupPlayArea(gameState, botPlayer, GovernBot.deckList)
    }

    // Random starting order
    // noinspection JSConstantReassignment
    gameState.turnOrder = shuffleArray(gameState.turnOrder)

    gameState.setNewTurnResources()

    core.gameStateIsReady = true
}

export function setupMultiplayerGame(gameRoom: GameRoom) {
    const gameState = useGameStateStore()
    const multiplayer = useMultiplayerStore()

    if (!gameRoom.seating || gameRoom.seating == EMPTY_SEATING) {
        throw new Error(`No seating in game room`)
    }

    resetState()
    const seatedUsers = gameRoom.seating.map(permId => multiplayer.users[permId])
    setupMultiplayerGameState(gameState, seatedUsers, multiplayer.userDecks)
    useCoreStore().gameStateIsReady = true
}

export function setupSavedGame(savedGame: DbSavedGame) {
    const gameState = useGameStateStore()
    const core = useCoreStore()

    resetState()
    loadGame(savedGame.game)

    // Resume the timer where it was at save time
    useTimer(gameState.gameId).resumeTimer(savedGame.date)

    if (savedGame.gameType == GameType.TrainBot) {
        const botPlayer = gameState.orderedPlayers.find(p => p.name == `${BOT_NAME}1`)

        if (!botPlayer) {
            throw new Error(`Bot player not found`)
        }

        if (!savedGame.conductorState) {
            throw new Error(`Saved Game has no conductor state`)
        }

        const bot = new GovernBot(botPlayer)
        core.conductor = new Conductor(bot)
        core.conductor.setConductorState(savedGame.conductorState)
    }
}

export function startGame(gameType: GameType) {
    const core = useCoreStore()

    if (core.gameIsStarted) {
        throw new Error(`Game is already started`)
    }

    // Run the clock in the background while the game is running, performance cost is negligible.
    startClock()

    core.gameIsStarted = true
    core.gameType = gameType
    router.push({ name: ROUTES.Game })
    initAutoSaveGame()
}

export function leaveGame(redirectToMenu: boolean = false) {
    const core = useCoreStore()

    if (!core.gameIsStarted) {
        return
    }

    stopClock()
    stopAutoSaveGame()
    leaveMultiplayer()
    resetState()

    if (redirectToMenu) {
        router.push({ name: ROUTES.MainMenu })
    }
}
