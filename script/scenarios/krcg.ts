import { Discipline, DisciplineLevel } from '@/shared/const/model.ts'
import { getLockForReactionOptions } from '@/shared/bot/cardOptions.ts'
import { GovernAgent } from '@/shared/bot/agents/governAgent.ts'
import { MalkavDeck } from '@/shared/bot/decks.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { applyOption, getDecidingPlayer } from '@/shared/bot/referee.ts'
import { stepBot } from '@/shared/bot/driver.ts'
import { optionsOfType, DecisionKind } from '@/shared/bot/types.ts'
import { attemptBlock, createCatalogBleed, passUntilDecides } from './catalog.ts'
import { findAnyCard } from './attachment.ts'
import { Scenario, expectEqual, summaryOf } from './helpers.ts'

export const KRCG_ID = '101067'

export const KRCG_DECK = <DeckList>{ ...MalkavDeck, [KRCG_ID]: 2 }

// A bleed against a prey that has KRCG News Radio in play, unlocked
function createKrcgBleed() {
    const game = createCatalogBleed({
        deck: KRCG_DECK,
        discipline: Discipline.Presence,
        level: DisciplineLevel.SUPERIOR,
        cards: [],
    })
    const krcg = findAnyCard(game.bled, KRCG_ID)
    game.gameState.moveCardToRegion(krcg, game.bled.ready)
    return { ...game, krcg }
}

// The prey decides, once the acting player passed the impulse
const krcgOptions = (game: ReturnType<typeof createKrcgBleed>) =>
    optionsOfType(passUntilDecides(game.gameState, game.bled).options, 'lockForReaction')

export const KRCG_SCENARIOS: Scenario[] = [
    {
        name: 'KRCG News Radio flips a failing block: +1 intercept once, the card is locked, the acting player regains the impulse',
        run() {
            const game = createKrcgBleed()
            attemptBlock(game, false)
            const action = game.gameState.action
            const decision = passUntilDecides(game.gameState, game.bled)
            const options = optionsOfType(decision.options, 'lockForReaction')
            expectEqual(decision.kind, DecisionKind.ReactionImpulse, 'a reaction window')
            expectEqual(options.length, 1, 'options')
            expectEqual(options[0].card, game.krcg, 'card')
            expectEqual(options[0].minion, game.blocker, 'the blocker')

            const intercept = action?.intercept ?? 0
            applyOption(decision, options[0])
            expectEqual(action?.intercept, intercept + 1, 'intercept')
            expectEqual(
                (action?.intercept ?? 0) >= (action?.stealth ?? 1),
                true,
                'the block stands',
            )
            expectEqual(game.krcg.isLocked, true, 'locked')
            expectEqual(
                getDecidingPlayer(game.gameState),
                game.bleeder,
                'the acting player decides',
            )
            const next = passUntilDecides(game.gameState, game.bled)
            expectEqual(optionsOfType(next.options, 'lockForReaction').length, 0, 'once')
        },
    },
    {
        name: 'KRCG News Radio is only offered when the intercept is needed: a block attempt stands and fails, the card is unlocked and in play',
        run() {
            const before = createKrcgBleed()
            expectEqual(krcgOptions(before).length, 0, 'no block attempt yet')

            const succeeding = createKrcgBleed()
            attemptBlock(succeeding, true)
            expectEqual(krcgOptions(succeeding).length, 0, 'the block already succeeds')

            const locked = createKrcgBleed()
            attemptBlock(locked, false)
            locked.krcg.lock()
            expectEqual(krcgOptions(locked).length, 0, 'locked')

            const held = createKrcgBleed()
            held.gameState.moveCardToRegion(held.krcg, held.bled.hand)
            attemptBlock(held, false)
            expectEqual(krcgOptions(held).length, 0, 'in hand')

            const failing = createKrcgBleed()
            attemptBlock(failing, false)
            expectEqual(krcgOptions(failing).length, 1, 'a failing block attempt stands')
        },
    },
    {
        name: 'KRCG News Radio only gives its intercept to a minion of its controller, never to the acting minion',
        run() {
            const game = createKrcgBleed()
            attemptBlock(game, false)
            expectEqual(getLockForReactionOptions(game.bled, game.blocker).length, 1, 'the blocker')
            expectEqual(
                getLockForReactionOptions(game.bled, game.bleeding).length,
                0,
                'a minion of another Methuselah',
            )
            const other = createKrcgBleed()
            other.gameState.moveCardToRegion(
                findAnyCard(other.bleeder, KRCG_ID),
                other.bleeder.ready,
            )
            attemptBlock(other, false)
            expectEqual(
                getLockForReactionOptions(other.bleeder, other.blocker).length,
                0,
                'not the Methuselah of the blocker',
            )
        },
    },
    {
        name: 'KRCG News Radio: the Govern agent passes with it, it never plays a reaction by itself',
        run() {
            const game = createKrcgBleed()
            attemptBlock(game, false)
            passUntilDecides(game.gameState, game.bled)
            const step = stepBot(game.bled, new GovernAgent())
            expectEqual(step?.option.type, 'noReaction', 'passes')
            expectEqual(game.krcg.isLocked, false, 'not locked')
        },
    },
    {
        name: 'Summary: KRCG News Radio is an intercept ability in the window of a standing block attempt, and it locks the card',
        run() {
            const ability = summaryOf(KRCG_ID).plays[0].abilities[0]
            expectEqual(ability.activate, 'lockForReaction', 'activate')
            expectEqual(ability.windows.join(), 'blockAttemptStands', 'window')
            expectEqual(ability.locks, true, 'locks the card')
            expectEqual(ability.roles.join(), 'intercept', 'an intercept source')
        },
    },
]
