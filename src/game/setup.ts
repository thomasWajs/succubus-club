import {
    CONTROLLED_ZONE_HEIGHT,
    ORDERED_PLAYER_COLORS,
    PLAY_AREA_WIDTH,
    GRID_SIZE,
} from '@/game/const.ts'
import { GovernBot } from '@/bot/governBot.ts'
import { Conductor } from '@/bot/conductor.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { useCoreStore } from '@/store/core.ts'
import { Player } from '@/model/Player.ts'
import { INITIAL_CRYPT_SIZE, INITIAL_HAND_SIZE } from '@/model/const.ts'
import { GameRoom } from '@/multiplayer/common.ts'
import { useMultiplayerStore } from '@/store/multiplayer.ts'
import { GameType } from '@/state/types.ts'
import { loadGame } from '@/gateway/serialization.ts'
import { DbSavedGame } from '@/gateway/db.ts'
import { initAutoSaveGame } from '@/gateway/savedGames.ts'
import router, { ROUTES } from '@/ui/router.ts'
import { useHistoryStore } from '@/store/history.ts'
import { DeckList } from '@/gateway/deck.ts'
import { useGameBusStore } from '@/store/bus.ts'

export const BOT_NAME = 'Bot'
export const BOT_PERM_ID = 'Bot'

function loadDeck(player: Player, deck: DeckList) {
    const gameState = useGameStateStore()

    for (const [krcgId, quantity] of Object.entries(deck)) {
        // Krcg id of crypt card begins by 2, library begins by 1
        if (krcgId[0] == '2') {
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

function setupPlayArea(player: Player, deck: DeckList) {
    const gameState = useGameStateStore()

    loadDeck(player, deck)

    player.crypt.shuffle()
    player.library.shuffle()

    // Draw 7 library cards
    for (let i = 0; i < INITIAL_HAND_SIZE; i++) {
        const card = player.library.firstCard
        card.x = GRID_SIZE * 5 * i
        gameState.moveCardToRegion(card, player.hand)
    }
    // Draw 4 crypt cards
    for (let i = 0; i < INITIAL_CRYPT_SIZE; i++) {
        const card = player.crypt.firstCard
        card.x = PLAY_AREA_WIDTH / 2 + GRID_SIZE * 4 * i
        card.y = CONTROLLED_ZONE_HEIGHT
        gameState.moveCardToRegion(card, player.uncontrolled)
    }
}

export function resetState() {
    const core = useCoreStore()

    useGameStateStore().$reset()
    useHistoryStore().$reset()
    useGameBusStore().$reset()

    core.gameIsStarted = false
    core.phaserIsReady = false
    core.gameStateIsReady = false
}

export function setupTrainGame() {
    const core = useCoreStore()
    const gameState = useGameStateStore()

    if (!core.selfDeck) {
        throw new Error(`No deck list`)
    }

    resetState()

    const selfPlayer = gameState.createPlayer(
        core.userProfile.playerName,
        ORDERED_PLAYER_COLORS[0],
        core.userProfile.permanentId,
    )
    gameState.usersToPlayer[core.userProfile.permanentId] = selfPlayer.oid
    setupPlayArea(selfPlayer, core.selfDeck.cards)

    const NB_BOTS = 1
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
        setupPlayArea(botPlayer, GovernBot.deck)
    }

    core.gameStateIsReady = true
}

export function setupMultiplayerGame(gameRoom: GameRoom) {
    const gameState = useGameStateStore()
    const multiplayer = useMultiplayerStore()

    resetState()

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
