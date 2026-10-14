/**
 * Setup of a game played with the rules engine ( GameType.Engine ) :
 * the user against bots, the counterpart of setupTrainGame().
 */

import { useCoreStore } from '@/client/store/core.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { resetState } from '@/client/state/setup.ts'
import { GameType } from '@/shared/types/state.ts'
import { generateGameId } from '@/shared/state/ids.ts'
import { gameResources, registerGameState } from '@/shared/registries.ts'
import { ORDERED_PLAYER_COLORS } from '@/shared/const/game.ts'
import { BOT_NAME, BOT_PERM_ID } from '@/shared/const/bot.ts'
import { InvalidDeck } from '@/shared/types/errors.ts'
import { shuffleArray } from '@/shared/utils.ts'
import { PlayerOid } from '@/shared/types/model.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { GameSpec, SpecError } from '@/client/engine/api.ts'
import { EngineHost, engineCatalog, EngineRefused } from '@/client/engine/host.ts'
import { Projection } from '@/client/engine/projection.ts'
import { engineOpportunities, runEngine } from '@/client/engine/driver.ts'

const ENGINE_NB_BOTS = 3
// The bots' decks are drawn among the engine's full preconstructed decks : the Fifth Edition
// ones, the anniversary decks and the Sabbat V5 ones — not the New Blood minis ( half decks ),
// nor the tournament winners
const ENGINE_BOT_DECK = /\((Fifth Edition\b.*|.*Anniversary|Sabbat V5)\)$/
// The server's bots play the trained network
const ENGINE_BOT_PROFILE = 'network'

// Same cards in the same numbers ( a card at 0 copies counts as absent )
function sameDeck(a: DeckList, b: DeckList): boolean {
    const cards = (list: DeckList) =>
        Object.entries(list)
            .filter(([, n]) => n > 0)
            .map(([id, n]) => `${id}:${n}`)
            .sort()
            .join(',')
    return cards(a) == cards(b)
}

// The user's deck refused by the server, or null ( another refusal )
function deckErrorMessage(error: SpecError): string | null {
    switch (error.error) {
        case 'deck_size':
            return `The deck is too small ( ${error.crypt} crypt cards, ${error.library} library cards )`
        case 'unknown_card':
            return `The rules engine doesn't know the card ${error.id}`
        case 'unsupported': {
            const names = error.cards.map(id => gameResources.cardbase[id]?.name ?? id)
            const shown = names.slice(0, 8).join(', ')
            const more = names.length > 8 ? ` and ${names.length - 8} more` : ''
            return `The rules engine doesn't know ${names.length} card(s) of this deck : ${shown}${more}`
        }
        default:
            return null
    }
}

/**
 * Set the game up ; returns the function that starts the engine, to call once the game is started.
 */
export async function setupEngineGame(): Promise<() => void> {
    const core = useCoreStore()
    const gameState = useGameStateStore()

    if (!core.selfDeck) {
        throw new Error(`No deck list`)
    }

    // Not the user's own deck, when it is one of the preconstructed decks
    const selfCards = core.selfDeck.cards
    const botDecks = shuffleArray(
        (await engineCatalog()).filter(
            ([name, deck]) => ENGINE_BOT_DECK.test(name) && !sameDeck(deck, selfCards),
        ),
    )

    // Seats are in turn order : the engine's seat 0 plays first
    const nbSeats = ENGINE_NB_BOTS + 1
    const selfSeat = Math.floor(Math.random() * nbSeats)
    // The bots by seat, from 1
    const botOf = (seat: number) => (seat < selfSeat ? seat + 1 : seat)
    const spec: GameSpec = {
        seed: Math.floor(Math.random() * 2 ** 32),
        time_limit: null,
        client: 'succubus-club',
        seats: Array.from({ length: nbSeats }, (_, seat) =>
            seat == selfSeat ?
                {
                    name: core.userProfile.playerName,
                    deck: selfCards,
                    player: {
                        type: 'human',
                        settings: {
                            views: 'steps',
                            text: true,
                            opportunities: engineOpportunities.value,
                        },
                    },
                }
            :   {
                    name: `${BOT_NAME}${botOf(seat)} - ${botDecks[botOf(seat) - 1][0].split(' (')[0]}`,
                    deck: botDecks[botOf(seat) - 1][1],
                    player: { type: 'bot', profile: ENGINE_BOT_PROFILE },
                },
        ),
    }
    // The server checks the decks : the game state is only set up once it has the game
    let host: EngineHost
    try {
        host = await EngineHost.create(spec)
    } catch (e) {
        const refusal = e instanceof EngineRefused ? e.refusal : null
        const message =
            refusal && 'seat' in refusal && refusal.seat == selfSeat ?
                deckErrorMessage(refusal)
            :   null
        throw message ? new InvalidDeck(message) : e
    }

    resetState()

    // noinspection JSConstantReassignment
    gameState.gameId = generateGameId()
    gameState.gameType = GameType.Engine
    registerGameState(gameState.gameId, gameState)

    const playersOid: PlayerOid[] = spec.seats.map((seat, i) => {
        if (i == selfSeat) {
            const selfPlayer = gameState.createPlayer(
                seat.name,
                ORDERED_PLAYER_COLORS[0],
                core.userProfile.permanentId,
            )
            gameState.usersToPlayer[core.userProfile.permanentId] = selfPlayer.oid
            return selfPlayer.oid
        }
        const bot = botOf(i)
        return gameState.createPlayer(seat.name, ORDERED_PLAYER_COLORS[bot], `${BOT_PERM_ID}${bot}`)
            .oid
    })
    const projection = new Projection(gameState, playersOid)

    core.gameStateIsReady = true

    return () => {
        runEngine(host, projection)
    }
}
