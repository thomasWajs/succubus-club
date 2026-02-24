import {
    GRID_SIZE,
    ORDERED_PLAYER_COLORS,
    TORPOR_ZONE_Y,
    VERTICAL_SEPARATOR_DEFAULT_X,
} from '@/shared/const/game.ts'
import { GovernBot } from '@/client/bot/governBot.ts'
import { Conductor } from '@/client/bot/conductor.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { useCoreStore } from '@/client/store/core.ts'
import { Player } from '@/shared/model/Player.ts'
import { INITIAL_CRYPT_SIZE, INITIAL_HAND_SIZE } from '@/shared/const/model.ts'
import { EMPTY_SEATING, GameRoom } from '@/shared/types/multiplayer.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { GameType } from '@/shared/types/state.ts'
import { loadGame } from '@/client/gateway/serialization.ts'
import { DbSavedGame } from '@/client/gateway/db.ts'
import { initAutoSaveGame } from '@/client/gateway/savedGames.ts'
import router, { ROUTES } from '@/client/ui/router.ts'
import { useHistoryStore } from '@/client/store/history.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { resetSync } from '@/client/multiplayer/sync.ts'
import { useTimer } from '@/shared/state/useTimer.ts'
import { generateGameId } from '@/shared/state/ids.ts'
import { BOT_NAME, BOT_PERM_ID, NB_BOTS } from '@/shared/const/bot.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { hasGameState, isCryptId, registerGameState } from '@/shared/registries.ts'
import { shuffleArray } from '@/shared/utils.ts'

function loadDeck(player: Player, deckList: DeckList) {
    const gameState = useGameStateStore()

    for (const [krcgId, quantity] of Object.entries(deckList)) {
        if (isCryptId(krcgId)) {
            for (let i = 0; i < quantity; i++) {
                gameState.createCryptCard(krcgId, player, player.crypt)
            }
        } else {
            for (let i = 0; i < quantity; i++) {
                gameState.createLibraryCard(krcgId, player, player.library)
            }
        }
    }
}

function setupPlayArea(player: Player, deckList: DeckList) {
    const gameState = useGameStateStore()

    loadDeck(player, deckList)

    player.crypt.shuffle()
    player.library.shuffle()

    // Draw 7 library cards
    for (let i = 0; i < INITIAL_HAND_SIZE; i++) {
        const card = player.library.firstCard
        gameState.moveCardToRegion(card, player.hand, i)
    }
    // Draw 4 crypt cards
    for (let i = 0; i < INITIAL_CRYPT_SIZE; i++) {
        const card = player.crypt.firstCard
        card.x = VERTICAL_SEPARATOR_DEFAULT_X + 9 * GRID_SIZE * i
        card.y = TORPOR_ZONE_Y
        gameState.moveCardToRegion(card, player.uncontrolled)
    }
}

export function resetState() {
    const core = useCoreStore()
    const gameState = useGameStateStore()

    resetSync()

    if (hasGameState(gameState.gameId)) {
        useTimer(gameState.gameId).resetTimer()
    }

    gameState.$reset()
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

    gameState.gameId = generateGameId()
    registerGameState(gameState.gameId, gameState)

    const selfPlayer = gameState.createPlayer(
        core.userProfile.playerName,
        ORDERED_PLAYER_COLORS[0],
        core.userProfile.permanentId,
    )
    gameState.usersToPlayer[core.userProfile.permanentId] = selfPlayer.oid
    setupPlayArea(selfPlayer, core.selfDeck.cards)

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
        setupPlayArea(botPlayer, GovernBot.deckList)
    }

    // Random starting order
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

    gameState.gameId = generateGameId()
    registerGameState(gameState.gameId, gameState)

    for (let i = 0; i < gameRoom.seating.length; i++) {
        const user = multiplayer.users[gameRoom.seating[i]]

        if (!user.deckList) {
            throw new Error(`User ${user.name} has no deck list`)
        }

        const player = gameState.createPlayer(user.name, ORDERED_PLAYER_COLORS[i], user.permId)

        gameState.usersToPlayer[user.permId] = player.oid
        setupPlayArea(player, user.deckList)
    }

    useCoreStore().gameStateIsReady = true
}

export function setupSavedGame(savedGame: DbSavedGame) {
    resetState()
    loadGame(savedGame.game)

    if (savedGame.gameType == GameType.TrainBot) {
        const core = useCoreStore()
        const gameState = useGameStateStore()

        const botPlayer = gameState.orderedPlayers.find(p => p.name == `${BOT_NAME}1`)

        if (!botPlayer) {
            throw new Error(`Bot player not found`)
        }

        const bot = new GovernBot(botPlayer)
        core.conductor = new Conductor(bot)
    }
}

export function startGame(gameType: GameType) {
    const core = useCoreStore()

    if (core.gameIsStarted) {
        throw new Error(`Game is already started`)
    }

    core.gameIsStarted = true
    core.gameType = gameType
    router.push({ name: ROUTES.Game })
    initAutoSaveGame()
}
