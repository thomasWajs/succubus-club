import { Player } from '@/shared/model/Player.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { botMutations } from '@/shared/state/botMutations.ts'
import { DisciplineLevel } from '@/shared/const/model.ts'
import { getMinionIntercept } from '@/shared/cardImpl/catalog/attached.ts'
import { findOption } from '@/shared/bot/helpers.ts'
import { GovernAgent } from '@/shared/bot/agents/governAgent.ts'
import { MalkavDeck } from '@/shared/bot/decks.ts'
import { applyOption, getDecidingPlayer, getDecisionPoint } from '@/shared/bot/referee.ts'
import { stepBot } from '@/shared/bot/driver.ts'
import { optionsOfType, DecisionPoint, DecisionKind } from '@/shared/bot/types.ts'
import {
    GUARD_DOGS_ID,
    blockWithReaction,
    passUntilCombat,
    reactionOptions,
} from './animalismReaction.ts'
import { attemptBlock, passUntilDecides } from './catalog.ts'
import { decideWith } from './bounce.ts'
import {
    Scenario,
    ScenarioFailure,
    applyPendingCleanup,
    createFight,
    expectEqual,
    giveCard,
    must,
} from './helpers.ts'

/**
 * The post block window: Cats' Guidance, played by the blocker once the combat of its block is over
 */

export const CATS_GUIDANCE_ID = '100308'

// The prey, a bot holding Cats' Guidance, blocks the bleed with its vampire: the combat starts
export function createBlockCombat(level: DisciplineLevel, extra: string[] = []) {
    const game = blockWithReaction(CATS_GUIDANCE_ID, level, { extra })
    const { gameState, bleeder, bled, blocker } = game
    const first = passUntilDecides(gameState, bled)
    applyOption(
        first,
        optionsOfType(first.options, 'block').find(o => o.minion == blocker) ??
            findOption(first.options, 'block'),
    )
    if (gameState.action) {
        gameState.action.stealth = 0
    }
    decideWith(gameState, bleeder, 'noModifier')
    const combat = passUntilCombat(gameState)
    if (!combat) {
        throw new ScenarioFailure('No combat')
    }
    return { ...game, combat }
}

export const endCombatByHand = (game: { gameState: GameState; bleeder: Player }) =>
    must(botMutations.COMBAT_end.act(game.bleeder, {}), 'end combat')

export function getPostBlockDecision(game: { gameState: GameState; bled: Player }): DecisionPoint {
    expectEqual(getDecidingPlayer(game.gameState), game.bled, 'the blocker decides')
    const decision = getDecisionPoint(game.gameState, game.bled)
    if (!decision) {
        throw new ScenarioFailure('No decision in the post block window')
    }
    expectEqual(decision.kind, DecisionKind.PostBlock, 'decision kind')
    return decision
}

export const CATS_GUIDANCE_SCENARIOS: Scenario[] = [
    {
        name: "Cats' Guidance: the window opens after the combat of a block, the inferior version unlocks the blocker",
        run() {
            const game = createBlockCombat(DisciplineLevel.INFERIOR)
            const { gameState, bleeder, bled, blocker, combat } = game
            expectEqual(gameState.action?.blockResolved, blocker, 'the action is open, blocked')
            expectEqual(blocker.isLocked, true, 'locked by its block')
            expectEqual(getDecidingPlayer(gameState), combat.impulsePlayer, 'the combat decides')
            const during = getDecisionPoint(gameState, combat.impulsePlayer)
            expectEqual(
                (during?.options ?? []).some(option => option.type == 'playReaction'),
                false,
                'no reaction in the combat',
            )

            endCombatByHand(game)
            expectEqual(gameState.action?.blockResolved, blocker, 'the window is open')
            const decision = getPostBlockDecision(game)
            const reactions = reactionOptions(decision)
            expectEqual(reactions.length, 1, 'offered')
            expectEqual(reactions[0].effect.type, 'unlock', 'unlocks')
            expectEqual(
                decision.options.some(option => option.type == 'noReaction'),
                true,
                'it can pass',
            )

            applyOption(decision, reactions[0])
            expectEqual(blocker.isLocked, false, 'unlocked')
            expectEqual(getMinionIntercept(blocker), blocker.minionAttrs.intercept, 'intercept')

            // Nothing more to play: the player passes, and the turn goes on
            const next = getPostBlockDecision(game)
            expectEqual(next.options.length, 1, 'only passing is left')
            applyOption(next, findOption(next.options, 'noReaction'))
            expectEqual(gameState.action, null, 'the window is closed, the action is over')
            applyPendingCleanup(gameState, bled)
            expectEqual(reactions[0].card.region == bled.ashHeap, true, 'the card is discarded')
            expectEqual(getDecidingPlayer(gameState), bleeder, 'the active player goes on')
        },
    },
    {
        name: "Cats' Guidance: the versions are separate plays, and a minion plays the card once per action",
        run() {
            // Played during the block attempt: +1 intercept, and the unlock is no longer playable
            const game = blockWithReaction(CATS_GUIDANCE_ID, DisciplineLevel.SUPERIOR, {
                copies: 2,
            })
            const { gameState, bleeder, bled } = game
            attemptBlock(game, false)
            decideWith(gameState, bleeder, 'noModifier')
            const decision = getDecisionPoint(gameState, bled)
            const reactions = decision ? optionsOfType(decision.options, 'playReaction') : []
            expectEqual(reactions.length, 2, 'one play per copy: only the superior version fits')
            expectEqual(
                reactions.some(reaction => reaction.effect.type == 'unlock'),
                false,
                'no unlock during the block attempt',
            )
            const before = gameState.action?.intercept ?? 0
            if (decision) {
                applyOption(decision, reactions[0])
            }
            expectEqual(gameState.action?.intercept, before + 1, 'intercept')
            const again = getDecisionPoint(gameState, bled)
            expectEqual(
                again ? reactionOptions(again).length : 0,
                0,
                'not played twice in the same action',
            )

            passUntilCombat(gameState)
            endCombatByHand(game)
            const post = getPostBlockDecision(game)
            expectEqual(reactionOptions(post).length, 0, 'the unlock is not playable after it')
            expectEqual(post.options.length, 1, 'only passing is left')

            // Not played during the block attempt: the unlock is offered after it
            const other = createBlockCombat(DisciplineLevel.SUPERIOR)
            endCombatByHand(other)
            const postOther = reactionOptions(getPostBlockDecision(other))
            expectEqual(postOther.length, 1, 'the unlock is offered')
            expectEqual(postOther[0].effect.type, 'unlock', 'unlocks')
        },
    },
    {
        name: "Cats' Guidance: a blocked leave torpor starts no combat, the blocker is locked and the window opens",
        run() {
            const game = blockWithReaction(CATS_GUIDANCE_ID, DisciplineLevel.INFERIOR)
            const { gameState, bleeder, bled, blocker, bleeding } = game
            const first = passUntilDecides(gameState, bled)
            applyOption(
                first,
                optionsOfType(first.options, 'block').find(o => o.minion == blocker) ??
                    findOption(first.options, 'block'),
            )
            if (gameState.action) {
                gameState.action.stealth = 0
            }
            // The acting vampire is in torpor, as for a leave torpor action
            gameState.moveCardToRegion(bleeding, bleeder.torpor)
            decideWith(gameState, bleeder, 'noModifier')
            for (let i = 0; i < 8 && gameState.action && !gameState.action.blockResolved; i++) {
                const decider = getDecidingPlayer(gameState)
                const decision = decider && getDecisionPoint(gameState, decider)
                const pass = decision?.options.find(option =>
                    ['noReaction', 'noModifier'].includes(option.type),
                )
                if (!decision || !pass) {
                    break
                }
                applyOption(decision, pass)
            }
            expectEqual(gameState.combat, null, 'no combat')
            expectEqual(blocker.isLocked, true, 'the blocker is locked')
            expectEqual(gameState.action?.blockResolved, blocker, 'the window is open')
        },
    },
    {
        name: "Cats' Guidance: the window offers only what is made for it, not the reactions about the action",
        run() {
            const game = createBlockCombat(DisciplineLevel.INFERIOR, [GUARD_DOGS_ID])
            expectEqual(
                game.bled.hand.cards.some(card => card.krcgId == GUARD_DOGS_ID),
                true,
                'Guard Dogs in hand',
            )
            endCombatByHand(game)
            const reactions = reactionOptions(getPostBlockDecision(game))
            expectEqual(reactions.length, 1, 'one play only')
            expectEqual(reactions[0].card.krcgId, CATS_GUIDANCE_ID, 'Cats Guidance')
        },
    },
    {
        name: "Cats' Guidance is not offered as a reaction during the action",
        run() {
            const locked = blockWithReaction(CATS_GUIDANCE_ID, DisciplineLevel.INFERIOR, {
                locked: true,
            })
            expectEqual(
                reactionOptions(passUntilDecides(locked.gameState, locked.bled)).length,
                0,
                'during the action',
            )
        },
    },
    {
        name: "Cats' Guidance: no window when the blocker went to torpor, when the hand has no reaction, or when the combat is not from a block",
        run() {
            const torpor = createBlockCombat(DisciplineLevel.INFERIOR)
            torpor.gameState.moveCardToRegion(torpor.blocker, torpor.bled.torpor)
            endCombatByHand(torpor)
            expectEqual(torpor.gameState.action, null, 'in torpor: the action is over')

            const noCard = createBlockCombat(DisciplineLevel.INFERIOR)
            for (const card of [...noCard.bled.hand.cards]) {
                noCard.gameState.moveCardToRegion(card, noCard.bled.ashHeap)
            }
            endCombatByHand(noCard)
            expectEqual(noCard.gameState.action, null, 'no reaction card in hand')

            // An enter combat action is not a block
            const fight = createFight(3, 3, { ...MalkavDeck, [CATS_GUIDANCE_ID]: 4 })
            giveCard(fight.gameState, fight.defendingPlayer, CATS_GUIDANCE_ID)
            expectEqual(fight.gameState.action, null, 'no action stays open')
            must(botMutations.COMBAT_end.act(fight.actingPlayer, {}), 'end combat')
            expectEqual(fight.gameState.action, null, 'no window')
        },
    },
    {
        name: "Cats' Guidance: a bot plays it through the decision flow, and the combat played out ends the same way",
        run() {
            const game = createBlockCombat(DisciplineLevel.INFERIOR)
            const { gameState, blocker } = game
            const agent = new GovernAgent()
            let steps = 0
            while (gameState.combat && steps++ < 200) {
                const decider = getDecidingPlayer(gameState)
                if (!decider) {
                    throw new ScenarioFailure('Nobody decides in the combat')
                }
                stepBot(decider, agent)
            }
            expectEqual(gameState.combat, null, 'the combat is over')
            // The window opens only if the blocker is still ready
            if (blocker.isIn.ready) {
                expectEqual(gameState.action?.blockResolved, blocker, 'the window is open')
                stepBot(game.bled, agent)
                expectEqual(blocker.isLocked, false, 'the bot unlocked its blocker')
            } else {
                expectEqual(gameState.action, null, 'no window for a blocker in torpor')
            }
        },
    },
]
