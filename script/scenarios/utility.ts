import { GameState } from '@/shared/state/gameState.ts'
import { DisciplineLevel } from '@/shared/const/model.ts'
import { createPlayerView, chooseThroughView } from '@/shared/bot/playerView.ts'
import { findOption } from '@/shared/bot/helpers.ts'
import { GovernAgent } from '@/shared/bot/agents/governAgent.ts'
import {
    MutationRecorder,
    recordMutations,
    checkRecordedLedger,
    createHeadlessGame,
} from '../harness.ts'
import { GovernDeck, MalkavDeck } from '@/shared/bot/decks.ts'
import { applyOption, getDecidingPlayer, getDecisionPoint } from '@/shared/bot/referee.ts'
import { stepBot } from '@/shared/bot/driver.ts'
import { getPlayerLedger } from '@/shared/bot/utility/ledger.ts'
import { UtilityAgent } from '@/shared/bot/agents/utilityAgent.ts'
import { serializeGameState } from '@/shared/serialization.ts'
import { BotContext, BotAgent, BotOption, DecisionKind, optionsOfType } from '@/shared/bot/types.ts'
import {
    blockWithBlocker,
    createEventBleed,
    endBlockCombat,
    passUntilActionOver,
} from './events.ts'
import { Scenario, ScenarioFailure, createdGames, expectEqual } from './helpers.ts'
import { passUntilDecides } from './catalog.ts'
import { createBounce, declineBlock, getBounceOption } from './bounce.ts'

/**
 * What the utility agent stands on. The ledger of what the table did is folded live
 * and rebuilt from the mutation history ( both must agree ), a player view can be played on without
 * touching the game, and the facts the defence reading counts on ( influenced vampires are
 * unlocked blockers ).
 */

// Records the mutations of the game the scenario creates, and checks the ledger against its history
function withRecording(run: (recorder: MutationRecorder) => GameState): void {
    const recorder = recordMutations({ history: true })
    try {
        checkRecordedLedger(run(recorder), recorder)
    } finally {
        recorder.stop()
    }
}

export const UTILITY_SCENARIOS: Scenario[] = [
    {
        name: 'Ledger: an unblocked bleed is recorded with the pool it took, and the refusal to block',
        run() {
            withRecording(recorder => {
                const game = createEventBleed(0)
                const poolBefore = game.bled.pool
                passUntilActionOver(game.gameState)
                const taken = poolBefore - game.bled.pool
                expectEqual(taken > 0, true, 'pool taken')
                const bleeder = getPlayerLedger(recorder.ledger, game.bleeder.oid)
                const bled = getPlayerLedger(recorder.ledger, game.bled.oid)
                expectEqual(bleeder.bleedsDeclared, 1, 'bleeds declared')
                expectEqual(
                    JSON.stringify(bleeder.bleedAmounts),
                    JSON.stringify([taken]),
                    'amounts',
                )
                expectEqual(bled.poolLostToBleeds, taken, 'pool lost')
                expectEqual(bled.blocksDeclined, 1, 'blocks declined')
                expectEqual(bled.blocksAttempted, 0, 'blocks attempted')
                return game.gameState
            })
        },
    },
    {
        name: 'Ledger: a failed block attempt is recorded, and the bleed still lands',
        run() {
            withRecording(recorder => {
                const game = createEventBleed(0)
                blockWithBlocker(game)
                passUntilActionOver(game.gameState)
                const bled = getPlayerLedger(recorder.ledger, game.bled.oid)
                expectEqual(bled.blocksAttempted, 1, 'blocks attempted')
                expectEqual(bled.blocksFailed, 1, 'blocks failed')
                expectEqual(bled.blocksDeclined, 0, 'blocks declined')
                expectEqual(bled.poolLostToBleeds > 0, true, 'the bleed lands')
                return game.gameState
            })
        },
    },
    {
        name: 'Ledger: a block that succeeds stops the action, which is not a bleed that landed',
        run() {
            withRecording(recorder => {
                const game = createEventBleed(1)
                blockWithBlocker(game)
                passUntilActionOver(game.gameState)
                endBlockCombat(game)
                const bleeder = getPlayerLedger(recorder.ledger, game.bleeder.oid)
                const bled = getPlayerLedger(recorder.ledger, game.bled.oid)
                expectEqual(bled.blocksSucceeded, 1, 'blocks succeeded')
                expectEqual(bleeder.actionsBlocked, 1, 'actions blocked')
                expectEqual(bleeder.bleedAmounts.length, 0, 'bleeds landed')
                expectEqual(bled.poolLostToBleeds, 0, 'pool lost')
                return game.gameState
            })
        },
    },
    {
        name: 'Ledger: giving up a block attempt is a withdrawal, not a refusal to block',
        run() {
            withRecording(recorder => {
                const game = createEventBleed(0)
                blockWithBlocker(game)
                const next = passUntilDecides(game.gameState, game.bled)
                applyOption(next, findOption(next.options, 'noBlock'))
                passUntilActionOver(game.gameState)
                const bled = getPlayerLedger(recorder.ledger, game.bled.oid)
                expectEqual(bled.blocksAttempted, 1, 'blocks attempted')
                expectEqual(bled.blocksWithdrawn, 1, 'blocks withdrawn')
                expectEqual(bled.blocksDeclined, 0, 'blocks declined')
                expectEqual(bled.blocksFailed, 0, 'blocks failed')
                return game.gameState
            })
        },
    },
    {
        name: 'Ledger: a bounce is recorded, and the bleed lands on the new target',
        run() {
            withRecording(recorder => {
                const bounce = createBounce(DisciplineLevel.INFERIOR)
                const { gameState, bleeder, bled, third } = bounce
                if (!third) {
                    throw new ScenarioFailure('No third player')
                }
                const decision = declineBlock(bounce)
                applyOption(decision, getBounceOption(decision, DisciplineLevel.INFERIOR))
                passUntilActionOver(gameState)
                expectEqual(getPlayerLedger(recorder.ledger, bled.oid).bouncesPlayed, 1, 'bounces')
                expectEqual(getPlayerLedger(recorder.ledger, bled.oid).poolLostToBleeds, 0, 'bled')
                const amounts = getPlayerLedger(recorder.ledger, bleeder.oid).bleedAmounts
                expectEqual(amounts.length, 1, 'bleeds landed')
                expectEqual(
                    getPlayerLedger(recorder.ledger, third.oid).poolLostToBleeds,
                    amounts[0],
                    'pool lost by the new target',
                )
                return gameState
            })
        },
    },
    {
        name: 'A player view can be played on: the game, its history and the ledger are untouched',
        run() {
            withRecording(recorder => {
                const game = createEventBleed(0)
                const { gameState } = game
                const decider = getDecidingPlayer(gameState)
                if (!decider) {
                    throw new ScenarioFailure('Nobody has a decision')
                }
                const live = JSON.stringify(serializeGameState(gameState))
                const ledger = JSON.stringify(recorder.ledger)
                const entries = recorder.history?.gameMutations.length

                const view = createPlayerView(gameState, decider)
                try {
                    const decision = getDecisionPoint(view.gameState, view.player)
                    if (!decision) {
                        throw new ScenarioFailure('No decision in the view')
                    }
                    applyOption(decision, decision.options[0])
                    expectEqual(
                        JSON.stringify(serializeGameState(view.gameState)) != live,
                        true,
                        'the view moved on',
                    )
                } finally {
                    view.dispose()
                }
                expectEqual(JSON.stringify(serializeGameState(gameState)), live, 'live state')
                expectEqual(JSON.stringify(recorder.ledger), ledger, 'ledger')
                expectEqual(recorder.history?.gameMutations.length, entries, 'history')
                return gameState
            })
        },
    },
    {
        name: 'The utility agent gets the ledger and its own decklist, and explains its choice',
        run() {
            const { gameState } = createHeadlessGame([GovernDeck, MalkavDeck])
            createdGames.push(gameState)
            // Plays on until a decision with a real choice
            const govern = new GovernAgent()
            let player = getDecidingPlayer(gameState)
            let decision = player && getDecisionPoint(gameState, player)
            for (let i = 0; i < 40 && player && decision?.options.length == 1; i++) {
                stepBot(player, govern)
                player = getDecidingPlayer(gameState)
                decision = player && getDecisionPoint(gameState, player)
            }
            if (!player || !decision || decision.options.length < 2) {
                throw new ScenarioFailure('No decision with a real choice')
            }
            let explained = 0
            const agent = new UtilityAgent(GovernDeck, undefined, () => explained++)
            expectEqual(agent.deck, GovernDeck, 'own deck')

            // Whatever the agent receives next to the view: the ledger of the table, not the game
            let received: BotContext | undefined
            const spy: BotAgent = {
                choose(viewDecision, context) {
                    received = context
                    return viewDecision.options[0]
                },
            }
            const recorder = recordMutations({ history: false })
            try {
                const context = { ledger: recorder.ledger }
                chooseThroughView(decision, spy, context)
                expectEqual(received, context, 'the context reaches the agent')
            } finally {
                recorder.stop()
            }

            chooseThroughView(decision, agent)
            expectEqual(explained, 1, 'explain entries')
        },
    },
    {
        name: 'An influenced vampire enters play unlocked: it can attempt a block at once',
        run() {
            const game = createEventBleed(0)
            const { gameState, bled, blocker } = game
            const newcomer = bled.vampiresInUncontrolled[0]
            const influence: BotOption = {
                type: 'influence',
                vampire: newcomer,
                amount: newcomer.minionAttrs.capacity,
            }
            applyOption(
                { kind: DecisionKind.Influence, player: bled, options: [influence] },
                influence,
            )
            expectEqual(newcomer.isIn.ready, true, 'ready')
            expectEqual(newcomer.isLocked, false, 'unlocked')
            expectEqual(bled.minionsReadyUnlocked.includes(newcomer), true, 'counted unlocked')

            blocker.lock()
            const decision = passUntilDecides(gameState, bled)
            const blockers = optionsOfType(decision.options, 'block').map(option => option.minion)
            expectEqual(blockers.includes(newcomer), true, 'the newcomer can block')
            expectEqual(blockers.includes(blocker), false, 'a locked minion cannot')
        },
    },
]
