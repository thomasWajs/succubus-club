import { MinionActionType } from '@/shared/types/state.ts'
import { createPlayerView, chooseThroughView } from '@/shared/bot/playerView.ts'
import { findOption } from '@/shared/bot/helpers.ts'
import { GovernDeck } from '@/shared/bot/decks.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { applyOption, getDecisionPoint } from '@/shared/bot/referee.ts'
import { UtilityAgent } from '@/shared/bot/agents/utilityAgent.ts'
import { DEFAULT_PROFILE } from '@/shared/bot/utility/profile.ts'
import { assess } from '@/shared/bot/utility/assessment.ts'
import { judgeBlock, BlockJudgement } from '@/shared/bot/utility/blockDecision.ts'
import { BotOption, optionsOfType } from '@/shared/bot/types.ts'
import { MinionSetup, addMinions, createRing, expectClose, holdOnly } from './assessment.ts'
import { sealLibrary } from './bounce.ts'
import { minionDecisionOf } from './plan.ts'
import { Scenario, ScenarioFailure, expectEqual } from './helpers.ts'
import { passUntilDecides } from './catalog.ts'

/**
 * Block decision: my predator declares an action against me and I decide the block. Three Methuselahs, the
 * hands are controlled and the vampires have no discipline, so the numbers of the judgement can be read.
 */

export type BlockSetup = {
    // The acting vampire of my predator
    actor?: MinionSetup
    // Another unlocked vampire of my predator, which could still bleed
    second?: MinionSetup
    blockers: MinionSetup[]
    pool?: number
    predatorHand?: number
    hand?: string[]
    action?: MinionActionType
    // The stealth of the action once declared, when the scenario sets it
    stealth?: number
    // My deck, the cards I hold come from it
    deck?: DeckList
}

export function blockBoard(setup: BlockSetup) {
    const ring = createRing([setup.deck ?? GovernDeck, GovernDeck, GovernDeck])
    const [me, , predator] = ring.players
    const [actor] = addMinions(ring, predator, [{ bleed: 2, blood: 5, ...setup.actor }])
    if (setup.second) {
        addMinions(ring, predator, [setup.second])
    }
    const blockers = addMinions(ring, me, setup.blockers)
    me.pool = setup.pool ?? 10
    holdOnly(ring, me, setup.hand ?? [])
    // What the predator holds is not seen: only how many cards it has counts
    holdOnly(ring, predator, [])
    for (const card of predator.library.cards.slice(0, setup.predatorHand ?? 0)) {
        ring.gameState.moveCardToRegion(card, predator.hand)
    }
    for (const player of ring.players) {
        sealLibrary(ring.gameState, player)
    }
    const decision = minionDecisionOf(ring, predator)
    const type = setup.action ?? MinionActionType.Bleed
    const declare = decision.options.find(
        option =>
            option.type == 'declareAction' &&
            option.action.type == type &&
            option.action.actingMinion == actor,
    )
    if (!declare) {
        throw new ScenarioFailure(`The ${type} is not offered`)
    }
    applyOption(decision, declare)
    if (setup.stealth !== undefined && ring.gameState.action) {
        ring.gameState.action.stealth = setup.stealth
    }
    return { ring, me, predator, actor, blockers }
}

export type BlockBoard = ReturnType<typeof blockBoard>

// The decision of the bled player at the block window, and what the utility agent judges and chooses
export function blockWindow(board: BlockBoard) {
    const decision = passUntilDecides(board.ring.gameState, board.me)
    const view = createPlayerView(board.ring.gameState, board.me)
    try {
        const viewDecision = getDecisionPoint(view.gameState, view.player)
        if (!viewDecision) {
            throw new ScenarioFailure('No decision in the view')
        }
        const judged = judgeBlock(
            viewDecision,
            assess(view.gameState, view.player, DEFAULT_PROFILE),
        )
        return { decision, judged }
    } finally {
        view.dispose()
    }
}

function judgementOf(board: BlockBoard): BlockJudgement {
    const { judged } = blockWindow(board)
    if (!judged) {
        throw new ScenarioFailure('The block is not judged')
    }
    return judged
}

const chosenBlock = (board: BlockBoard): BotOption =>
    chooseThroughView(blockWindow(board).decision, new UtilityAgent(GovernDeck))

export const BLOCK_SCENARIOS: Scenario[] = [
    {
        name: 'Block decision: a bleed that my stronger blocker stops is blocked',
        run() {
            const board = blockBoard({
                actor: { strength: 1, bleed: 3 },
                blockers: [{ strength: 4, intercept: 1 }],
            })
            const option = chosenBlock(board)
            if (option.type != 'block') {
                throw new ScenarioFailure(`The agent chose ${option.type}`)
            }
            expectEqual(option.minion, board.blockers[0], 'the blocker')
        },
    },
    {
        name: 'Block decision: a small bleed is not blocked when the fight costs more than the bleed ( block only when needed )',
        run() {
            const board = blockBoard({
                actor: { strength: 5, bleed: 1 },
                blockers: [{ strength: 1, intercept: 1, blood: 3 }],
            })
            const judged = judgementOf(board)
            expectEqual(judged.block, null, 'no block')
            const [candidate] = judged.candidates
            expectEqual(
                candidate.parts.fight > candidate.parts.denial,
                true,
                'the fight costs more',
            )
            expectEqual(chosenBlock(board).type == 'block', false, 'the agent does not block')
        },
    },
    {
        name: 'Block decision: the same fight is worth it when the bleed would oust me',
        run() {
            const board = blockBoard({
                actor: { strength: 5, bleed: 6 },
                blockers: [{ strength: 1, intercept: 1, blood: 3 }],
                pool: 5,
            })
            expectEqual(chosenBlock(board).type, 'block', 'blocked against an ouster')
        },
    },
    {
        name: 'Block decision: a block that cannot stand is not attempted ( the intercept is below the stealth )',
        run() {
            const board = blockBoard({
                actor: { strength: 1, bleed: 4 },
                blockers: [{ strength: 4, intercept: 0 }],
                stealth: 1,
            })
            const judged = judgementOf(board)
            expectEqual(judged.block, null, 'no block')
            expectEqual(judged.candidates[0].parts.stands, 0, 'it does not stand')
        },
    },
    {
        name: 'Block decision: the stealth cards that the acting side may hold lower what a block that only just stands is worth',
        run() {
            const stands = (intercept: number, hand: number) =>
                judgementOf(
                    blockBoard({
                        actor: { strength: 1, bleed: 3 },
                        blockers: [{ strength: 4, intercept }],
                        predatorHand: hand,
                    }),
                ).candidates[0].parts.stands
            expectEqual(stands(0, 7) < 1, true, 'a hand can flip an attempt at equal intercept')
            expectEqual(stands(0, 7) < stands(0, 1), true, 'the more cards the likelier')
            expectEqual(stands(0, 0), 1, 'no card, no flip')
            expectEqual(
                stands(3, 7),
                1,
                'three points of intercept above the stealth are out of reach',
            )
        },
    },
    {
        name: 'Block decision: the blocker that is locked matters when my predator has more attackers to send',
        run() {
            const lock = (second: MinionSetup | undefined) =>
                judgementOf(
                    blockBoard({
                        actor: { strength: 1, bleed: 2 },
                        second,
                        blockers: [{ strength: 4, intercept: 1 }],
                    }),
                ).candidates[0].parts.lock
            expectEqual(lock(undefined), 0, 'nobody else to send')
            expectEqual(
                lock({ bleed: 4 }) > 0.5,
                true,
                'the next bleed lands once my blocker is locked',
            )
        },
    },
    {
        name: 'Block decision: a blocker is kept for the bigger bleed that my predator can still send',
        run() {
            const decide = (second: MinionSetup | undefined) =>
                chosenBlock(
                    blockBoard({
                        actor: { strength: 3, bleed: 3 },
                        second,
                        blockers: [{ strength: 3, intercept: 1 }],
                    }),
                ).type
            expectEqual(decide(undefined), 'block', 'nobody else to send')
            expectEqual(decide({ bleed: 4 }) == 'block', false, 'kept for the bleed of 4')
        },
    },
    {
        name: 'Block decision: what a bleed costs me counts the cards that raise it and the ouster it makes',
        run() {
            const denial = (setup: Partial<BlockSetup>) =>
                judgementOf(
                    blockBoard({
                        actor: { strength: 1, bleed: 3 },
                        blockers: [{ strength: 3, intercept: 3 }],
                        ...setup,
                    }),
                ).candidates[0].parts.denial
            expectEqual(
                denial({ predatorHand: 7 }) > denial({ predatorHand: 0 }),
                true,
                'its cards',
            )
            expectEqual(
                denial({ pool: 3 }) - denial({ pool: 4 }) > DEFAULT_PROFILE.plan.oustedCost / 2,
                true,
                'the ouster',
            )
        },
    },
    {
        name: 'Block decision: an action that is not a bleed is worth the guard of the profile, by its kind',
        run() {
            const denialOf = (action: MinionActionType) =>
                judgementOf(
                    blockBoard({
                        actor: { strength: 1, blood: 1 },
                        blockers: [{ strength: 5, intercept: 1 }],
                        action,
                    }),
                ).candidates[0].parts.denial
            const { guard, guardKinds } = DEFAULT_PROFILE.plan
            expectClose(
                denialOf(MinionActionType.Hunt),
                guard * guardKinds.hunt,
                'a hunt gives some blood',
                1e-9,
            )
        },
    },
    {
        name: 'Block decision: the better blocker is chosen, and the weaker one is spared a fight it loses',
        run() {
            const board = blockBoard({
                actor: { strength: 3, bleed: 3 },
                blockers: [
                    { strength: 1, intercept: 1, blood: 3 },
                    { strength: 6, intercept: 1 },
                ],
            })
            const option = chosenBlock(board)
            if (option.type != 'block') {
                throw new ScenarioFailure(`The agent chose ${option.type}`)
            }
            expectEqual(option.minion, board.blockers[1], 'the strong blocker')
        },
    },
    {
        name: 'Block decision: an action that is not a bleed is blocked only when the fight is won',
        run() {
            const won = blockBoard({
                actor: { strength: 1, blood: 1 },
                blockers: [{ strength: 5, intercept: 1 }],
                action: MinionActionType.Hunt,
            })
            expectEqual(chosenBlock(won).type, 'block', 'a fight won')
            const lost = blockBoard({
                actor: { strength: 5, blood: 1 },
                blockers: [{ strength: 1, intercept: 1, blood: 3 }],
                action: MinionActionType.Hunt,
            })
            expectEqual(chosenBlock(lost).type == 'block', false, 'a fight lost')
        },
    },
    {
        name: 'Block window: a Methuselah that declined to block is not offered a block again when the window comes back after the modifiers (rulebook: the decision is final)',
        run() {
            const board = blockBoard({
                actor: { strength: 1, bleed: 3 },
                blockers: [{ strength: 4, intercept: 1 }],
            })
            const first = passUntilDecides(board.ring.gameState, board.me)
            applyOption(first, findOption(first.options, 'noBlock'))
            const second = passUntilDecides(board.ring.gameState, board.me)
            expectEqual(optionsOfType(second.options, 'block').length, 0, 'no block offered')
            expectEqual(optionsOfType(second.options, 'noBlock').length, 0, 'no second decline')
        },
    },
]
