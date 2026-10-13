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
import {
    checkEngineDeck,
    engineCatalog,
    loadEnginePolicy,
    LocalEngineHost,
} from '@/client/engine/host.ts'
import { EngineDeckError, EngineSeatSpec } from '@/client/engine/protocol.ts'
import { Projection } from '@/client/engine/projection.ts'
import { engineOpportunities, runEngine } from '@/client/engine/driver.ts'
import { RemoteEngineHost } from '@/client/engine/remote.ts'

const ENGINE_NB_BOTS = 3
// The bots' decks are drawn among the engine's full preconstructed decks : the Fifth Edition
// ones, the anniversary decks and the Sabbat V5 ones — not the New Blood minis ( half decks ),
// nor the tournament winners
const ENGINE_BOT_DECK = /\((Fifth Edition\b.*|.*Anniversary|Sabbat V5)\)$/
// Without the trained network's weights, the engine's scripted bots play
const ENGINE_SCRIPTED_STYLES = ['aggro_bleed', 'wall']
const ENGINE_NETWORK_STYLE = 'network'
// The engine server the game is played on ( https://engine.krcg.org ) ; absent, in the browser
const ENGINE_SERVER = import.meta.env.VITE_ENGINE_SERVER as string | undefined

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

function deckErrorMessage(error: EngineDeckError): string {
    if (error.error == 'too_small') {
        return `The deck is too small ( ${error.crypt} crypt cards, ${error.library} library cards )`
    }
    const names = error.ids.map(id => gameResources.cardbase[id]?.name ?? id)
    const shown = names.slice(0, 8).join(', ')
    const more = names.length > 8 ? ` and ${names.length - 8} more` : ''
    return `The rules engine doesn't know ${names.length} card(s) of this deck : ${shown}${more}`
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

    const deckError = await checkEngineDeck(core.selfDeck.cards)
    if (deckError) {
        throw new InvalidDeck(deckErrorMessage(deckError))
    }
    // Not the user's own deck, when it is one of the preconstructed decks
    const selfCards = core.selfDeck.cards
    const botDecks = shuffleArray(
        (await engineCatalog()).filter(
            ([name, deck]) => ENGINE_BOT_DECK.test(name) && !sameDeck(deck, selfCards),
        ),
    )
    // On a server, its bots play the network
    const policy = ENGINE_SERVER ? undefined : await loadEnginePolicy()

    resetState()

    // noinspection JSConstantReassignment
    gameState.gameId = generateGameId()
    gameState.gameType = GameType.Engine
    registerGameState(gameState.gameId, gameState)

    // Seats are in turn order : the engine's seat 0 plays first
    const nbSeats = ENGINE_NB_BOTS + 1
    const selfSeat = Math.floor(Math.random() * nbSeats)
    const seats: EngineSeatSpec[] = []
    const playersOid: PlayerOid[] = []
    let botIndex = 0
    for (let seat = 0; seat < nbSeats; seat++) {
        if (seat == selfSeat) {
            const selfPlayer = gameState.createPlayer(
                core.userProfile.playerName,
                ORDERED_PLAYER_COLORS[0],
                core.userProfile.permanentId,
            )
            gameState.usersToPlayer[core.userProfile.permanentId] = selfPlayer.oid
            playersOid.push(selfPlayer.oid)
            seats.push({
                name: selfPlayer.name,
                deck: core.selfDeck.cards,
                player: { kind: 'human' },
            })
        } else {
            const [deckName, deck] = botDecks[botIndex]
            const style =
                policy || ENGINE_SERVER ? ENGINE_NETWORK_STYLE : (
                    ENGINE_SCRIPTED_STYLES[botIndex % ENGINE_SCRIPTED_STYLES.length]
                )
            botIndex++
            const botPlayer = gameState.createPlayer(
                `${BOT_NAME}${botIndex} - ${deckName.split(' (')[0]}`,
                ORDERED_PLAYER_COLORS[botIndex],
                `${BOT_PERM_ID}${botIndex}`,
            )
            playersOid.push(botPlayer.oid)
            seats.push({ name: botPlayer.name, deck, player: { kind: 'bot', style } })
        }
    }

    const spec = { seed: Math.floor(Math.random() * 2 ** 32), seats }
    const host =
        ENGINE_SERVER ?
            await RemoteEngineHost.create(spec, ENGINE_SERVER, engineOpportunities.value)
        :   await LocalEngineHost.create(spec, policy)
    const projection = new Projection(gameState, playersOid)

    core.gameStateIsReady = true

    return () => {
        runEngine(host, projection)
    }
}
