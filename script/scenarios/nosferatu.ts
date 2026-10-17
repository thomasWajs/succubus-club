import { MinionActionType } from '@/shared/types/state.ts'
import { Discipline, DisciplineLevel } from '@/shared/const/model.ts'
import { getMinionIntercept } from '@/shared/cardImpl/catalog/attached.ts'
import { createHeadlessGame } from '../harness.ts'
import { BrujahDeck } from '@/shared/bot/decks.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { applyOption } from '@/shared/bot/referee.ts'
import { optionsOfType } from '@/shared/bot/types.ts'
import { createCatalogBleed, passUntilDecides } from './catalog.ts'
import { Scenario, ScenarioFailure, createdGames, expectEqual, readySpecific } from './helpers.ts'
import { DOWAGER_ID, LENNY_ID } from '../cardIds.ts'

export const NOSFERATU_DECK = <DeckList>{ ...BrujahDeck, [LENNY_ID]: 1, [DOWAGER_ID]: 1 }

// The first player declares an action, which the Dowager of its prey can attempt to block
function createDowagerBlock(actionType: MinionActionType) {
    const game = createCatalogBleed({
        deck: NOSFERATU_DECK,
        discipline: Discipline.Presence,
        level: DisciplineLevel.SUPERIOR,
        cards: [],
        actionType,
        preyVampireId: DOWAGER_ID,
    })
    const decision = passUntilDecides(game.gameState, game.bled)
    const block = optionsOfType(decision.options, 'block').find(
        option => option.minion == game.blocker,
    )
    if (!block) {
        throw new ScenarioFailure('The Dowager cannot attempt to block')
    }
    return { ...game, decision, block }
}

export const NOSFERATU_SCENARIOS: Scenario[] = [
    {
        name: 'Lenny Burkhead has +1 bleed on her bleed action',
        run() {
            const game = createCatalogBleed({
                deck: NOSFERATU_DECK,
                discipline: Discipline.Presence,
                level: DisciplineLevel.SUPERIOR,
                cards: [],
                bleederId: LENNY_ID,
            })
            expectEqual(game.bleeding.minionAttrs.bleed, 2, 'bleed of the vampire')
            expectEqual(game.gameState.action?.bleed, 2, 'bleed of the action')
        },
    },
    {
        name: 'The Dowager has +1 intercept when she attempts to block a directed action',
        run() {
            const game = createDowagerBlock(MinionActionType.Bleed)
            expectEqual(getMinionIntercept(game.blocker), 1, 'intercept')
            applyOption(game.decision, game.block)
            expectEqual(game.gameState.action?.intercept, 1, 'intercept of the block attempt')
        },
    },
    {
        name: 'The Dowager has no intercept bonus against an undirected action, nor outside an action',
        run() {
            const game = createDowagerBlock(MinionActionType.Hunt)
            expectEqual(getMinionIntercept(game.blocker), 0, 'intercept')
            applyOption(game.decision, game.block)
            expectEqual(game.gameState.action?.intercept, 0, 'intercept of the block attempt')

            const idle = createHeadlessGame([NOSFERATU_DECK, NOSFERATU_DECK])
            createdGames.push(idle.gameState)
            const dowager = readySpecific(idle.gameState, idle.players[0], DOWAGER_ID, 3)
            expectEqual(getMinionIntercept(dowager), 0, 'intercept with no action')
        },
    },
]
