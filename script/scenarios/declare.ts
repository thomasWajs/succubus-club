import { LibraryCard } from '@/shared/model/Card.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { canDeclare } from '@/shared/state/minionActions.ts'
import {
    createHuntAction,
    createBleedAction,
    createActionCardAction,
} from '@/shared/state/minionActionFactories.ts'
import { createHeadlessGame } from '../harness.ts'
import { GovernDeck } from '@/shared/bot/decks.ts'
import { createMinionPhase } from './torpor.ts'
import {
    Scenario,
    ScenarioFailure,
    createdGames,
    giveCard,
    must,
    mustRefuse,
    readyVampire,
} from './helpers.ts'

/**
 * The engine refuses invalid bot declarations (canDeclare), never a human's.
 */

const ALASTOR_ID = '100038'

const ANARCHIST_UPRISING_ID = '100059'

export const DECLARE_SCENARIOS: Scenario[] = [
    {
        name: 'a bot cannot declare with a locked minion, a human can',
        run() {
            const turn = createMinionPhase(5, 0)
            turn.ready.lock()
            mustRefuse(
                gameMutations.ACTION_declareAction.act(turn.player, {
                    minionAction: createHuntAction(turn.ready),
                }),
                'bot hunt with a locked minion',
            )

            turn.player.permId = 'human'
            must(
                gameMutations.ACTION_declareAction.act(turn.player, {
                    minionAction: createHuntAction(turn.ready),
                }),
                'human hunt with a locked minion',
            )
        },
    },
    {
        name: 'a bot cannot bleed a player who is not its prey',
        run() {
            const { gameState, players } = createHeadlessGame([GovernDeck, GovernDeck, GovernDeck])
            createdGames.push(gameState)
            const player = gameState.activePlayer
            if (!player || !player.prey) {
                throw new ScenarioFailure('No active player or no prey')
            }
            const minion = readyVampire(gameState, player, 5)
            const other = players.find(candidate => candidate != player && candidate != player.prey)
            if (!other) {
                throw new ScenarioFailure('No player other than the prey')
            }
            mustRefuse(
                gameMutations.ACTION_declareAction.act(player, {
                    minionAction: createBleedAction(minion, other),
                }),
                'bleed on a player who is not the prey',
            )
            must(
                gameMutations.ACTION_declareAction.act(player, {
                    minionAction: createBleedAction(minion, player.prey),
                }),
                'bleed on the prey',
            )
        },
    },
    {
        name: 'a minion bleeds once a turn, even if it unlocks; another minion can, and the next turn it can again',
        run() {
            const turn = createMinionPhase(5, 0)
            const { gameState, player, ready } = turn
            const other = readyVampire(gameState, player, 5)
            const prey = player.prey
            if (!prey) {
                throw new ScenarioFailure('No prey')
            }
            must(
                gameMutations.ACTION_declareAction.act(player, {
                    minionAction: createBleedAction(ready, prey),
                }),
                'first bleed',
            )
            gameState.action = null
            ready.unlock()
            mustRefuse(
                canDeclare(createBleedAction(ready, prey)),
                'second bleed of the same minion',
            )
            must(canDeclare(createHuntAction(ready)), 'it can hunt')
            must(canDeclare(createBleedAction(other, prey)), 'another minion can bleed')

            gameState.setNewTurnResources()
            must(canDeclare(createBleedAction(ready, prey)), 'next turn')
        },
    },
    {
        name: 'a minion can hunt again after it unlocks, and a bleed it takes back is not counted',
        run() {
            const turn = createMinionPhase(5, 0)
            const { gameState, player, ready } = turn
            const prey = player.prey
            if (!prey) {
                throw new ScenarioFailure('No prey')
            }
            must(
                gameMutations.ACTION_declareAction.act(player, {
                    minionAction: createHuntAction(ready),
                }),
                'hunt',
            )
            gameState.action = null
            ready.unlock()
            must(canDeclare(createHuntAction(ready)), 'a second hunt')

            const bleed = createBleedAction(ready, prey)
            must(gameMutations.ACTION_declareAction.act(player, { minionAction: bleed }), 'bleed')
            mustRefuse(canDeclare(createBleedAction(ready, prey)), 'a locked minion, a bleed done')
            must(
                gameMutations.ACTION_declareActionInverse.act(player, { minionAction: bleed }),
                'the bleed is cancelled',
            )
            must(canDeclare(createBleedAction(ready, prey)), 'a cancelled bleed does not count')
        },
    },
    {
        name: 'a minion plays an action card of the same name once a turn, and one political action, even if it unlocks',
        run() {
            const turn = createMinionPhase(5, 0, {
                ...GovernDeck,
                [ALASTOR_ID]: 2,
                [ANARCHIST_UPRISING_ID]: 1,
            })
            const { gameState, player, ready } = turn
            player.permId = 'human'
            const [first, second] = [ALASTOR_ID, ALASTOR_ID].map(id =>
                giveCard(gameState, player, id),
            )
            const uprising = giveCard(gameState, player, ANARCHIST_UPRISING_ID)
            const action = (card: LibraryCard) => createActionCardAction(ready, card, {})
            must(
                gameMutations.ACTION_declareAction.act(player, { minionAction: action(first) }),
                'the first Alastor',
            )
            gameState.action = null
            ready.unlock()
            mustRefuse(canDeclare(action(second)), 'a second Alastor')
            mustRefuse(canDeclare(action(uprising)), 'a second political action')
            must(canDeclare(createHuntAction(ready)), 'not an action card')

            gameState.setNewTurnResources()
            must(canDeclare(action(second)), 'the next turn')
        },
    },
]
