import { Player } from '@/shared/model/Player.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { INITIAL_CRYPT_SIZE, INITIAL_HAND_SIZE } from '@/shared/const/model.ts'
import {
    GRID_SIZE,
    ORDERED_PLAYER_COLORS,
    TORPOR_ZONE_Y,
    VERTICAL_SEPARATOR_DEFAULT_X,
} from '@/shared/const/game.ts'
import { registerGameState } from '@/shared/registries.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { User } from '@/shared/types/multiplayer.ts'
import { generateGameId } from '@/shared/state/ids.ts'
import { isCryptId } from '@/shared/model/Card.ts'

function loadDeck(gameState: GameState, player: Player, deckList: DeckList) {
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

export function setupPlayArea(gameState: GameState, player: Player, deckList: DeckList) {
    loadDeck(gameState, player, deckList)

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

export function setupMultiplayerGameState(gameState: GameState, seatedUsers: (User | undefined)[]) {
    gameState.gameId = generateGameId()
    registerGameState(gameState.gameId, gameState)

    for (let i = 0; i < seatedUsers.length; i++) {
        const user = seatedUsers[i]
        if (!user) {
            throw new Error(`User ${i} is undefined`)
        }
        if (!user.deckList) {
            throw new Error(`User ${user.name} has no deck list`)
        }

        const player = gameState.createPlayer(user.name, ORDERED_PLAYER_COLORS[i], user.permId)

        gameState.usersToPlayer[user.permId] = player.oid
        setupPlayArea(gameState, player, user.deckList)
    }
}
