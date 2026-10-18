import { MinionActionType } from '@/shared/types/state.ts'
import { Discipline, DisciplineLevel } from '@/shared/const/model.ts'
import { getMinionIntercept } from '@/shared/cardImpl/catalog/attached.ts'
import { createHeadlessGame } from '../harness.ts'
import { BrujahDeck } from '@/shared/bot/decks.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { applyOption } from '@/shared/bot/referee.ts'
import { DecisionKind, optionsOfType } from '@/shared/bot/types.ts'
import { findOption } from '@/shared/bot/helpers.ts'
import { chooseThroughView } from '@/shared/bot/playerView.ts'
import { UtilityAgent } from '@/shared/bot/agents/utilityAgent.ts'
import { createCatalogBleed, passUntilDecides } from './catalog.ts'
import { Scenario, ScenarioFailure, createdGames, expectEqual, readySpecific } from './helpers.ts'
import {
    CARRION_CROWS_ID,
    CATS_GUIDANCE_ID,
    DOWAGER_ID,
    LARISSA_ID,
    LENNY_ID,
    LOST_IN_CROWDS_ID,
} from '../cardIds.ts'

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

const LARISSA_DECK = <DeckList>{
    ...BrujahDeck,
    [LARISSA_ID]: 1,
    [CARRION_CROWS_ID]: 2,
    [CATS_GUIDANCE_ID]: 2,
    [LOST_IN_CROWDS_ID]: 2,
}

// Larissa bleeds her prey, her hand is the cards given. With `declined` the prey declines to block and the
// acting player has the impulse.
function createLarissaBleed(cards: string[], options: { declined?: boolean; pool?: number } = {}) {
    const game = createCatalogBleed({
        deck: LARISSA_DECK,
        discipline: Discipline.Presence,
        level: DisciplineLevel.SUPERIOR,
        cards,
        bleederId: LARISSA_ID,
    })
    game.bled.pool = options.pool ?? 10
    if (options.declined) {
        const window = passUntilDecides(game.gameState, game.bled)
        applyOption(window, findOption(window.options, 'noBlock'))
    }
    return game
}

type LarissaBleed = ReturnType<typeof createLarissaBleed>

const larissaDecision = (game: LarissaBleed) => passUntilDecides(game.gameState, game.bleeder)

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
    {
        name: 'Larissa Moreira can discard a card that requires Animalism for +1 bleed in her bleed action once per action, and keeps the impulse',
        run() {
            const game = createLarissaBleed([CARRION_CROWS_ID, CATS_GUIDANCE_ID, LOST_IN_CROWDS_ID])
            const decision = larissaDecision(game)
            const options = optionsOfType(decision.options, 'discardForBleed')
            expectEqual(
                options
                    .map(option => option.discard.krcgId)
                    .toSorted()
                    .join(),
                [CARRION_CROWS_ID, CATS_GUIDANCE_ID].toSorted().join(),
                'the Animalism cards only',
            )
            expectEqual(game.gameState.action?.bleed, 1, 'bleed')

            const [first] = options
            applyOption(decision, first)
            expectEqual(game.gameState.action?.bleed, 2, 'bleed after one discard')
            expectEqual(first.discard.isIn.ashHeap, true, 'the card is discarded')
            const next = larissaDecision(game)
            expectEqual(next.kind, DecisionKind.ActionImpulse, 'the acting player decides again')
            expectEqual(
                optionsOfType(next.options, 'discardForBleed').length,
                0,
                'once per action: the other card is not offered',
            )
            expectEqual(game.gameState.action?.bleed, 2, 'bleed is still 2')
        },
    },
    {
        name: 'Larissa Moreira discards only during a bleed action of her own, and no other vampire has the ability',
        run() {
            const hunt = createCatalogBleed({
                deck: LARISSA_DECK,
                discipline: Discipline.Presence,
                level: DisciplineLevel.SUPERIOR,
                cards: [CARRION_CROWS_ID],
                bleederId: LARISSA_ID,
                actionType: MinionActionType.Hunt,
            })
            expectEqual(
                optionsOfType(larissaDecision(hunt).options, 'discardForBleed').length,
                0,
                'a hunt',
            )

            const other = createCatalogBleed({
                deck: LARISSA_DECK,
                discipline: Discipline.Presence,
                level: DisciplineLevel.SUPERIOR,
                cards: [CARRION_CROWS_ID],
            })
            expectEqual(
                optionsOfType(larissaDecision(other).options, 'discardForBleed').length,
                0,
                'another vampire',
            )
        },
    },
    {
        name: 'Larissa Moreira: the bot discards an Animalism card for the bleed when it adds to the bleed that goes through',
        run() {
            const game = createLarissaBleed([CATS_GUIDANCE_ID], { declined: true })
            const chosen = chooseThroughView(larissaDecision(game), new UtilityAgent(LARISSA_DECK))
            expectEqual(chosen.type, 'discardForBleed', 'the discard')
        },
    },
    {
        name: 'Larissa Moreira: the bot keeps the card while the block window of its prey is open, and when the bleed already ousts the prey',
        run() {
            const waiting = createLarissaBleed([CATS_GUIDANCE_ID])
            const agent = new UtilityAgent(LARISSA_DECK)
            expectEqual(
                chooseThroughView(larissaDecision(waiting), agent).type,
                'noModifier',
                'the window is open',
            )
            const ousted = createLarissaBleed([CATS_GUIDANCE_ID], { declined: true, pool: 1 })
            expectEqual(
                chooseThroughView(larissaDecision(ousted), agent).type,
                'noModifier',
                'the prey is ousted anyway',
            )
        },
    },
]
