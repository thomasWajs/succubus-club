import { Discipline, DisciplineLevel } from '@/shared/const/model.ts'
import { MalkavDeck } from '@/shared/bot/decks.ts'
import { getDecisionPoint, applyOption } from '@/shared/bot/referee.ts'
import { optionsOfType } from '@/shared/bot/types.ts'
import { attemptBlock, createCatalogBleed, passUntilDecides } from './catalog.ts'
import { Scenario, ScenarioFailure, expectEqual } from './helpers.ts'
import { decideWith } from './bounce.ts'

export const WARRENS_ID = '102216'

// A bleed against a prey whose vampire is a Nosferatu, titled or not, holding The Warrens
function createWarrens(titled: boolean, clan: string) {
    const game = createCatalogBleed({
        deck: { ...MalkavDeck, [WARRENS_ID]: 4 },
        discipline: Discipline.Dominate,
        level: DisciplineLevel.INFERIOR,
        cards: [],
        preyCards: [WARRENS_ID],
    })
    game.blocker.vampireAttrs.clan = clan
    game.blocker.vampireAttrs.title = titled ? 'Prince' : ''
    return game
}

export const WARRENS_SCENARIOS: Scenario[] = [
    {
        name: 'The Warrens adds 2 intercept, 3 for a titled Nosferatu, and needs a Nosferatu',
        run() {
            for (const [titled, expected] of [
                [false, 2],
                [true, 3],
            ] as const) {
                const game = createWarrens(titled, 'Nosferatu')
                const before = passUntilDecides(game.gameState, game.bled)
                expectEqual(
                    optionsOfType(before.options, 'playReaction').length,
                    0,
                    'no block attempt stands yet',
                )
                attemptBlock(game, false)
                decideWith(game.gameState, game.bleeder, 'noModifier')
                const decision = getDecisionPoint(game.gameState, game.bled)
                const reactions = decision ? optionsOfType(decision.options, 'playReaction') : []
                if (!decision) {
                    throw new ScenarioFailure('The prey has no decision')
                }
                expectEqual(reactions.length, 1, 'offered')
                const intercept = game.gameState.action?.intercept ?? 0
                applyOption(decision, reactions[0])
                expectEqual(game.gameState.action?.intercept, intercept + expected, 'intercept')
            }

            const other = createWarrens(false, 'Malkavian')
            attemptBlock(other, false)
            decideWith(other.gameState, other.bleeder, 'noModifier')
            const next = getDecisionPoint(other.gameState, other.bled)
            expectEqual(
                next ? optionsOfType(next.options, 'playReaction').length : -1,
                0,
                'not a Nosferatu',
            )
        },
    },
]
