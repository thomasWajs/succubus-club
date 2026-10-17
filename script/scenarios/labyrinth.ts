import { Discipline, DisciplineLevel } from '@/shared/const/model.ts'
import { getLockForActionOptions } from '@/shared/bot/cardOptions.ts'
import { findOption } from '@/shared/bot/helpers.ts'
import { GovernAgent } from '../governAgent.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { getDecisionPoint, applyOption } from '@/shared/bot/referee.ts'
import { stepBot } from '@/shared/bot/driver.ts'
import { optionsOfType, DecisionKind } from '@/shared/bot/types.ts'
import { LENNY_ID, NOSFERATU_DECK } from './nosferatu.ts'
import { attemptBlock, createCatalogBleed } from './catalog.ts'
import { findAnyCard } from './attachment.ts'
import { Scenario, ScenarioFailure, expectEqual } from './helpers.ts'

export const LABYRINTH_ID = '101070'

export const LABYRINTH_DECK = <DeckList>{ ...NOSFERATU_DECK, [LABYRINTH_ID]: 2 }

// Lenny declares a bleed with The Labyrinth in play under her controller, unlocked
function createLabyrinthBleed() {
    const game = createCatalogBleed({
        deck: LABYRINTH_DECK,
        discipline: Discipline.Presence,
        level: DisciplineLevel.SUPERIOR,
        cards: [],
        bleederId: LENNY_ID,
    })
    const labyrinth = findAnyCard(game.bleeder, LABYRINTH_ID)
    game.gameState.moveCardToRegion(labyrinth, game.bleeder.ready)
    return { ...game, labyrinth }
}

const labyrinthDecision = (game: ReturnType<typeof createLabyrinthBleed>) => {
    const decision = getDecisionPoint(game.gameState, game.bleeder)
    if (!decision) {
        throw new ScenarioFailure('The acting player has no decision')
    }
    return decision
}

export const LABYRINTH_SCENARIOS: Scenario[] = [
    {
        name: 'The Labyrinth locks for the action of a Nosferatu: +1 stealth once, the acting player keeps the impulse',
        run() {
            const game = createLabyrinthBleed()
            expectEqual(
                optionsOfType(labyrinthDecision(game).options, 'lockForAction').length,
                0,
                'no block attempt stands',
            )
            attemptBlock(game, false)
            expectEqual(
                optionsOfType(labyrinthDecision(game).options, 'lockForAction').length,
                0,
                'the block attempt fails anyway',
            )
            if (game.gameState.action) {
                game.gameState.action.intercept = game.gameState.action.stealth
            }
            const stealth = game.gameState.action?.stealth ?? 0
            const decision = labyrinthDecision(game)
            const options = optionsOfType(decision.options, 'lockForAction')
            expectEqual(options.length, 1, 'options')
            expectEqual(options[0].card, game.labyrinth, 'card')

            applyOption(decision, options[0])
            expectEqual(game.gameState.action?.stealth, stealth + 1, 'stealth')
            expectEqual(game.labyrinth.isLocked, true, 'locked')
            const next = labyrinthDecision(game)
            expectEqual(next.kind, DecisionKind.ActionImpulse, 'the acting player decides again')
            expectEqual(optionsOfType(next.options, 'lockForAction').length, 0, 'once')
        },
    },
    {
        name: 'The Labyrinth is not offered for another clan, a Nosferatu antitribu, a locked or a held card, nor to another Methuselah',
        run() {
            // A block attempt stands that would succeed: the stealth is needed
            const blocked = () => {
                const game = createLabyrinthBleed()
                attemptBlock(game, true)
                return game
            }
            const clanOf = (clan: string) => {
                const game = blocked()
                game.bleeding.vampireAttrs.clan = clan
                return game
            }
            const offered = (game: ReturnType<typeof createLabyrinthBleed>) =>
                optionsOfType(labyrinthDecision(game).options, 'lockForAction').length
            expectEqual(offered(clanOf('Nosferatu')), 1, 'a Nosferatu')
            expectEqual(offered(clanOf('Ventrue')), 0, 'another clan')
            expectEqual(offered(clanOf('Nosferatu antitribu')), 0, 'a Nosferatu antitribu')

            const locked = blocked()
            locked.labyrinth.lock()
            expectEqual(offered(locked), 0, 'locked')

            const held = blocked()
            held.gameState.moveCardToRegion(held.labyrinth, held.bleeder.hand)
            expectEqual(offered(held), 0, 'in hand')

            const other = createLabyrinthBleed()
            other.gameState.moveCardToRegion(
                findAnyCard(other.bled, LABYRINTH_ID),
                other.bled.ready,
            )
            expectEqual(
                getLockForActionOptions(other.bled, other.bleeding).length,
                0,
                'not the Methuselah of the acting minion',
            )
        },
    },
    {
        name: 'The Labyrinth: the Govern agent locks it when a block would succeed, not before',
        run() {
            const game = createLabyrinthBleed()
            const stealth = game.gameState.action?.stealth ?? 0
            const first = stepBot(game.bleeder, new GovernAgent())
            expectEqual(first?.option.type, 'noModifier', 'no block yet')

            const blockDecision = getDecisionPoint(game.gameState, game.bled)
            if (!blockDecision) {
                throw new ScenarioFailure('The prey has no decision')
            }
            applyOption(blockDecision, findOption(blockDecision.options, 'block'))
            const second = stepBot(game.bleeder, new GovernAgent())
            expectEqual(second?.option.type, 'lockForAction', 'a block stands')
            expectEqual(game.gameState.action?.stealth, stealth + 1, 'stealth')
        },
    },
]
