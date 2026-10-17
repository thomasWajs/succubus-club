import { Vampire, LibraryCard } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { botMutations } from '@/shared/state/botMutations.ts'
import { MinionAction, MinionActionType, GameType, ActionProperty } from '@/shared/types/state.ts'
import {
    TurnSequence,
    TurnPhase,
    LEAVE_TORPOR_COST,
    DisciplineLevel,
} from '@/shared/const/model.ts'
import { GOVERN_ID } from '@/shared/cardImpl/cardIds.ts'
import { findOption } from '@/shared/bot/helpers.ts'
import {
    createBleedAction,
    createHuntAction,
    createLeaveTorporAction,
    createRescueFromTorporAction,
    createActionCardAction,
} from '@/shared/state/minionActionFactories.ts'
import { GovernAgent } from '../governAgent.ts'
import { createHeadlessGame } from '../harness.ts'
import { GovernDeck } from '@/shared/bot/decks.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { getDecidingPlayer, getDecisionPoint, applyOption } from '@/shared/bot/referee.ts'
import { stepBot } from '@/shared/bot/driver.ts'
import { DecisionPoint } from '@/shared/bot/types.ts'
import {
    Scenario,
    ScenarioFailure,
    applyPendingCleanup,
    createdGames,
    expectEqual,
    giveCard,
    must,
    mustRefuse,
    readyVampire,
} from './helpers.ts'
import {
    createBounce,
    decideWith,
    declineBlock,
    emptyHand,
    getBounceOption,
    sealLibrary,
} from './bounce.ts'

/**
 * A human acts, the bots block
 */

type HumanTable = {
    gameState: GameState
    human: Player
    // The Methuselahs after the human, in turn order: [prey, predator] (just the prey at 2 players)
    others: Player[]
    acting: Vampire
    // The ready vampire of each other player, same order as `others`
    blockers: Vampire[]
    // The card given to the human, when asked
    card: LibraryCard | null
}

export function createHumanTable(
    nbPlayers: number,
    humanCard?: string,
    deck: DeckList = GovernDeck,
): HumanTable {
    const { gameState, players } = createHeadlessGame(Array.from({ length: nbPlayers }, () => deck))
    createdGames.push(gameState)
    const human = gameState.activePlayer
    const prey = human?.prey
    if (!human || !prey || !players.includes(human)) {
        throw new ScenarioFailure('No active player or no prey')
    }
    human.permId = 'human'
    const others = nbPlayers >= 3 && prey.prey ? [prey, prey.prey] : [prey]
    for (const player of players) {
        emptyHand(gameState, player)
    }
    const card = humanCard ? giveCard(gameState, human, humanCard) : null
    for (const player of players) {
        sealLibrary(gameState, player)
    }
    gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Minion)
    gameState.turnResources.unlocked = true

    const acting = readyVampire(gameState, human, 3)
    const blockers = others.map(other => {
        const blocker = readyVampire(gameState, other, 3)
        blocker.minionAttrs.intercept = 1
        return blocker
    })
    return { gameState, human, others, acting, blockers, card }
}

export function humanDeclares(table: HumanTable, minionAction: MinionAction): void {
    must(
        gameMutations.ACTION_declareAction.act(table.human, { minionAction }),
        `human ${minionAction.type}`,
    )
}

// The bot declines to block, which gives the impulse back to the human, who passes it again: the bot
// then has its second window and passes with no reaction
function botPassesBothWindows(table: HumanTable, bot: Player, agent: GovernAgent) {
    expectEqual(stepBot(bot, agent)?.option.type, 'noBlock', 'the bot declines to block')
    expectEqual(getDecidingPlayer(table.gameState), table.human, 'the human may play modifiers')
    decideWith(table.gameState, table.human, 'noModifier')
    expectEqual(stepBot(bot, agent)?.option.type, 'noReaction', 'the bot passes')
}

function inTorpor(gameState: GameState, vampire: Vampire, blood: number): void {
    gameState.moveCardToRegion(vampire, vampire.controller.torpor)
    vampire.blood = blood
}

export const HUMAN_ACTION_SCENARIOS: Scenario[] = [
    {
        name: 'a human bleed hands the impulse to the bot prey as soon as it is declared',
        run() {
            const table = createHumanTable(3)
            humanDeclares(table, createBleedAction(table.acting, table.others[0]))
            expectEqual(getDecidingPlayer(table.gameState), table.others[0], 'the prey decides')
        },
    },
    {
        name: 'a human hunt hands the impulse to the bot prey, then the predator once the prey has passed',
        run() {
            const table = createHumanTable(3)
            const [prey, predator] = table.others
            humanDeclares(table, createHuntAction(table.acting))
            expectEqual(getDecidingPlayer(table.gameState), prey, 'the prey decides first')
            // Its vampire does not intercept enough: the prey passes without a block
            table.blockers[0].minionAttrs.intercept = 0
            botPassesBothWindows(table, prey, new GovernAgent())
            expectEqual(getDecidingPlayer(table.gameState), predator, 'the predator decides')
        },
    },
    {
        name: 'the target of an action cannot pass before its block is decided, then it can only pass or react',
        run() {
            const table = createHumanTable(2)
            const [prey] = table.others
            humanDeclares(table, createBleedAction(table.acting, prey))
            const first = getDecisionPoint(table.gameState, prey)
            const types = (decision: DecisionPoint | null) =>
                (decision?.options ?? []).map(option => option.type)
            expectEqual(types(first).includes('noReaction'), false, 'no pass in the block window')
            expectEqual(types(first).includes('noBlock'), true, 'noBlock is offered')

            applyOption(
                first as DecisionPoint,
                findOption((first as DecisionPoint).options, 'noBlock'),
            )
            decideWith(table.gameState, table.human, 'noModifier')
            const second = types(getDecisionPoint(table.gameState, prey))
            expectEqual(second.includes('noReaction'), true, 'the pass is offered once declined')
            expectEqual(second.includes('noBlock') || second.includes('block'), false, 'no block')
        },
    },
    {
        name: 'a human leaving torpor hands the impulse to the bot prey',
        run() {
            const table = createHumanTable(2)
            inTorpor(table.gameState, table.acting, LEAVE_TORPOR_COST)
            humanDeclares(table, createLeaveTorporAction(table.acting))
            expectEqual(getDecidingPlayer(table.gameState), table.others[0], 'the prey decides')
        },
    },
    {
        name: 'a human rescuing a bot vampire hands the impulse to that bot, not to the prey',
        run() {
            const table = createHumanTable(3)
            const [prey, predator] = table.others
            const rescued = readyVampire(table.gameState, predator, 4)
            inTorpor(table.gameState, rescued, 4)
            humanDeclares(table, createRescueFromTorporAction(table.acting, rescued, 1, 1))
            expectEqual(getDecidingPlayer(table.gameState), predator, 'the owner decides')
            expectEqual(prey == predator, false, 'a prey that differs from the owner')
        },
    },
    {
        name: 'a human diablerizing a bot vampire hands the impulse to that bot',
        run() {
            const table = createHumanTable(2)
            const [prey] = table.others
            const victim = readyVampire(table.gameState, prey, 4)
            inTorpor(table.gameState, victim, 4)
            humanDeclares(table, {
                type: MinionActionType.Diablerize,
                actingMinion: table.acting,
                target: victim,
            })
            expectEqual(getDecidingPlayer(table.gameState), prey, 'the owner decides')
        },
    },
    {
        name: 'a human action card waits for the human: the bot is not given the impulse',
        run() {
            const table = createHumanTable(2, GOVERN_ID)
            if (!table.card) {
                throw new ScenarioFailure('No card given')
            }
            humanDeclares(table, createActionCardAction(table.acting, table.card, {}))
            expectEqual(getDecidingPlayer(table.gameState), table.human, 'the human decides')
            expectEqual(table.gameState.action?.declared, false, 'not declared yet')
        },
    },
    {
        name: 'the Declare button of a human action card hands the impulse to the bot, which then blocks',
        run() {
            const table = createHumanTable(2, GOVERN_ID)
            const [prey] = table.others
            if (!table.card) {
                throw new ScenarioFailure('No card given')
            }
            humanDeclares(table, createActionCardAction(table.acting, table.card, {}))
            must(botMutations.ACTION_completeDeclaration.act(table.human, {}), 'declare')
            expectEqual(table.gameState.action?.declared, true, 'declared')
            expectEqual(getDecidingPlayer(table.gameState), prey, 'the bot decides')
            expectEqual(stepBot(prey, new GovernAgent())?.option.type, 'block', 'the bot blocks')
            mustRefuse(
                botMutations.ACTION_completeDeclaration.act(table.human, {}),
                'declared twice',
            )
        },
    },
    {
        name: 'a usage change after the bots passed gives them a new reason to react',
        run() {
            const table = createHumanTable(2, GOVERN_ID)
            const [prey] = table.others
            if (!table.card) {
                throw new ScenarioFailure('No card given')
            }
            table.acting.minionAttrs.strength = table.blockers[0].minionAttrs.strength + 1
            humanDeclares(table, createActionCardAction(table.acting, table.card, {}))
            must(botMutations.ACTION_completeDeclaration.act(table.human, {}), 'declare')
            botPassesBothWindows(table, prey, new GovernAgent())
            expectEqual(table.gameState.action?.reactionsPassed, true, 'all passed')
            must(gameMutations.ACTION_updateUsage.act(table.human, { usage: { x: 1 } }), 'usage')
            expectEqual(table.gameState.action?.reactionsPassed, false, 'new reason to react')
        },
    },
    {
        name: 'a bot action does not pass the impulse by itself, only the human action does',
        run() {
            const table = createHumanTable(2)
            table.human.permId = 'Bot1'
            humanDeclares(table, createBleedAction(table.acting, table.others[0]))
            expectEqual(getDecidingPlayer(table.gameState), table.human, 'the bleeder decides')
        },
    },
    {
        name: 'the Govern agent blocks the bleed of a human, and the successful block starts a combat',
        run() {
            const table = createHumanTable(2)
            const [prey] = table.others
            const agent = new GovernAgent()
            humanDeclares(table, createBleedAction(table.acting, prey))
            expectEqual(stepBot(prey, agent)?.option.type, 'block', 'the bot blocks')
            expectEqual(getDecidingPlayer(table.gameState), table.human, 'back to the human')

            decideWith(table.gameState, table.human, 'noModifier')
            expectEqual(stepBot(prey, agent)?.option.type, 'noReaction', 'the bot passes')
            expectEqual(table.gameState.action?.blockResolved, table.blockers[0], 'block resolved')
            const combat = table.gameState.combat
            expectEqual(combat?.acting.minion, table.acting, 'the human minion is the one blocked')
            expectEqual(combat?.defending.minion, table.blockers[0], 'the bot minion blocked')
            expectEqual(table.blockers[0].isLocked, true, 'the blocker is locked')
        },
    },
    {
        name: 'the Govern agent blocks a human hunt with the prey, which intercepts as much as the stealth',
        run() {
            const table = createHumanTable(3)
            const [prey] = table.others
            humanDeclares(table, createHuntAction(table.acting))
            expectEqual(table.gameState.action?.stealth, 1, 'the stealth of an undirected action')
            expectEqual(stepBot(prey, new GovernAgent())?.option.type, 'block', 'the prey blocks')
        },
    },
    {
        name: 'the Govern agent does not block when the stealth is above the intercept',
        run() {
            const table = createHumanTable(2)
            const [prey] = table.others
            humanDeclares(table, createBleedAction(table.acting, prey))
            if (!table.gameState.action) {
                throw new ScenarioFailure('No action')
            }
            table.gameState.action.stealth = 2
            expectEqual(stepBot(prey, new GovernAgent())?.option.type, 'noBlock', 'no block')
        },
    },
    {
        name: 'the Govern agent does not block a stronger minion',
        run() {
            const table = createHumanTable(2)
            const [prey] = table.others
            table.acting.minionAttrs.strength = table.blockers[0].minionAttrs.strength + 1
            humanDeclares(table, createBleedAction(table.acting, prey))
            expectEqual(stepBot(prey, new GovernAgent())?.option.type, 'noBlock', 'no block')
        },
    },
    {
        name: 'the Govern agent blocks with the strongest of its minions',
        run() {
            const table = createHumanTable(2)
            const [prey] = table.others
            const strong = readyVampire(table.gameState, prey, 3)
            strong.minionAttrs.intercept = 1
            strong.minionAttrs.strength = 2
            humanDeclares(table, createBleedAction(table.acting, prey))
            const step = stepBot(prey, new GovernAgent())
            expectEqual(step?.option.type, 'block', 'the bot blocks')
            expectEqual(
                step?.option.type == 'block' ? step.option.minion : null,
                strong,
                'the strongest blocks',
            )
        },
    },
    {
        name: 'a block that fails against a raised stealth gives the impulse back and the action goes on',
        run() {
            const table = createHumanTable(2)
            const [prey] = table.others
            const agent = new GovernAgent()
            humanDeclares(table, createBleedAction(table.acting, prey))
            expectEqual(stepBot(prey, agent)?.option.type, 'block', 'the bot blocks')
            // The human plays a stealth modifier by hand, then passes
            if (!table.gameState.action) {
                throw new ScenarioFailure('No action')
            }
            table.gameState.action.stealth = 2
            decideWith(table.gameState, table.human, 'noModifier')
            stepBot(prey, agent)
            expectEqual(table.gameState.combat, null, 'no combat')
            expectEqual(table.gameState.action !== null, true, 'the human ends the action')
            expectEqual(getDecidingPlayer(table.gameState), table.human, 'the human decides')
            expectEqual(table.blockers[0].isLocked, false, 'the failed blocker stays unlocked')
        },
    },
    {
        name: 'a human resolves a bleed with the Resolve action button: the bled bot loses the bleed amount',
        run() {
            const table = createHumanTable(2)
            const [prey] = table.others
            table.acting.minionAttrs.strength = table.blockers[0].minionAttrs.strength + 1
            humanDeclares(table, createBleedAction(table.acting, prey))
            stepBot(prey, new GovernAgent())
            const pool = prey.pool
            must(botMutations.ACTION_resolveAction.act(table.human, {}), 'resolve')
            expectEqual(table.gameState.action, null, 'the action is over')
            expectEqual(prey.pool, pool - table.acting.minionAttrs.bleed, 'the bleed went through')
        },
    },
    {
        name: 'the reaction card a bot played against a human action is put away once the human ends the action',
        run() {
            const bounce = createBounce(DisciplineLevel.SUPERIOR)
            const { gameState, bleeder, bled, third, deflection } = bounce
            if (!third) {
                throw new ScenarioFailure('No third player')
            }
            bleeder.permId = 'human'
            const decision = declineBlock(bounce)
            applyOption(decision, getBounceOption(decision, DisciplineLevel.SUPERIOR))
            decideWith(gameState, bleeder, 'noModifier')
            decideWith(gameState, third, 'noBlock')
            decideWith(gameState, bleeder, 'noModifier')
            decideWith(gameState, third, 'noReaction')
            expectEqual(gameState.action !== null, true, 'the human ends the action')
            expectEqual(deflection.isIn.ready, true, 'Deflection stays while the action goes on')

            must(botMutations.ACTION_resolveAction.act(bleeder, {}), 'the human resolves')
            expectEqual(gameState.action, null, 'the action is over')
            applyPendingCleanup(gameState, bled)
            expectEqual(deflection.isIn.ashHeap, true, 'Deflection put away')
            expectEqual(getDecidingPlayer(gameState), bleeder, 'the turn goes on')
        },
    },
    {
        name: 'a human cannot resolve an action the engine does not know, nor over a standing block, nor outside bot games',
        run() {
            const table = createHumanTable(2)
            const [prey] = table.others
            humanDeclares(table, createBleedAction(table.acting, prey))
            stepBot(prey, new GovernAgent())
            mustRefuse(botMutations.ACTION_resolveAction.act(table.human, {}), 'a standing block')

            table.gameState.action = null
            table.gameState.gameType = GameType.Unset
            humanDeclares(table, createBleedAction(table.acting, prey))
            mustRefuse(botMutations.ACTION_resolveAction.act(table.human, {}), 'outside bot games')

            table.gameState.action = null
            table.gameState.gameType = GameType.TrainBot
            humanDeclares(table, {
                type: MinionActionType.Diablerize,
                actingMinion: table.acting,
                target: table.blockers[0],
            })
            mustRefuse(botMutations.ACTION_resolveAction.act(table.human, {}), 'a diablerie')
        },
    },
    {
        name: 'once the bots have passed, nothing is left to pass until the human changes the action',
        run() {
            const table = createHumanTable(2)
            const [prey] = table.others
            table.acting.minionAttrs.strength = table.blockers[0].minionAttrs.strength + 1
            humanDeclares(table, createBleedAction(table.acting, prey))
            expectEqual(table.gameState.action?.reactionsPassed, false, 'passed at declaration')
            botPassesBothWindows(table, prey, new GovernAgent())
            expectEqual(getDecidingPlayer(table.gameState), table.human, 'back to the human')
            expectEqual(table.gameState.action?.reactionsPassed, true, 'all passed')

            must(
                gameMutations.ACTION_changeProperty.act(table.human, {
                    propertyName: ActionProperty.Bleed,
                    amount: 1,
                }),
                'raise the bleed',
            )
            expectEqual(table.gameState.action?.reactionsPassed, false, 'new reason to react')
        },
    },
]
