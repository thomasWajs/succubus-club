import { Discipline, DisciplineLevel, Sect } from '@/shared/const/model.ts'
import { Disciplines } from '@/shared/types/resources.ts'
import { DEFLECTION_ID } from '@/shared/cardImpl/cardIds.ts'
import { chooseThroughView } from '@/shared/bot/playerView.ts'
import { findOption } from '@/shared/bot/helpers.ts'
import { MalkavDeck, BrujahDeck } from '@/shared/bot/decks.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { applyOption } from '@/shared/bot/referee.ts'
import { UtilityAgent } from '@/shared/bot/agents/utilityAgent.ts'
import { ExplainCandidate } from '@/shared/bot/utility/explain.ts'
import { DecisionPoint, optionsOfType, BotOption, DecisionKind } from '@/shared/bot/types.ts'
import { EYES_OF_ARGUS_ID, QUI_VIVE_ID, passUntilDecides } from './catalog.ts'
import { KRCG_ID } from './krcg.ts'
import {
    CATS_GUIDANCE_ID,
    createBlockCombat,
    endCombatByHand,
    getPostBlockDecision,
} from './catsGuidance.ts'
import { ORGANIZED_RESISTANCE_ID } from './brujahReaction.ts'
import { BlockBoard, BlockSetup, blockBoard } from './block.ts'
import { Scenario, expectEqual, readyVampire } from './helpers.ts'
import { findAnyCard } from './attachment.ts'
import { createAlineGame, getTriggerDecision } from './aline.ts'
import { passUntilActionOver } from './events.ts'

/**
 * Reaction decision: my predator declares an action against me and I decide what to play in the windows: the
 * cards that reach a block, wake a minion, bounce the bleed, flip a block that fails, or unlock the blocker.
 */

const REACTION_DECK = <DeckList>{
    ...MalkavDeck,
    [EYES_OF_ARGUS_ID]: 3,
    [KRCG_ID]: 2,
    [CATS_GUIDANCE_ID]: 2,
    [ORGANIZED_RESISTANCE_ID]: 2,
}

export const AUSPEX_INFERIOR: Partial<Disciplines> = {
    [Discipline.Auspex]: DisciplineLevel.INFERIOR,
}

export const DOMINATE_INFERIOR: Partial<Disciplines> = {
    [Discipline.Dominate]: DisciplineLevel.INFERIOR,
}

const reactionBoard = (setup: BlockSetup) => blockBoard({ deck: REACTION_DECK, ...setup })

const agentOf = (deck: DeckList = REACTION_DECK) => new UtilityAgent(deck)

// What the agent does at my next decision, and the decision it was made at
function nextChoice(board: BlockBoard, deck?: DeckList) {
    const decision = passUntilDecides(board.ring.gameState, board.me)
    const option = chooseThroughView(decision, agentOf(deck))
    return { decision, option }
}

// My first blocker attempts the block by hand, then my next decision comes
function blockByHand(board: BlockBoard): DecisionPoint {
    const first = passUntilDecides(board.ring.gameState, board.me)
    applyOption(
        first,
        optionsOfType(first.options, 'block').find(option => option.minion == board.blockers[0]) ??
            findOption(first.options, 'block'),
    )
    return passUntilDecides(board.ring.gameState, board.me)
}

const playedCard = (option: BotOption) => (option.type == 'playReaction' ? option.card.krcgId : '')

export const REACTION_SCENARIOS: Scenario[] = [
    {
        name: 'Reaction decision: an intercept card that reaches the stealth makes the block worth attempting, then it is played to flip it',
        run() {
            const setup: BlockSetup = {
                actor: { strength: 1, bleed: 4 },
                blockers: [{ strength: 4, intercept: 0, disciplines: AUSPEX_INFERIOR }],
                stealth: 1,
            }
            const without = reactionBoard({ ...setup, hand: [] })
            expectEqual(nextChoice(without).option.type, 'noBlock', 'nothing reaches it')

            const board = reactionBoard({ ...setup, hand: [EYES_OF_ARGUS_ID] })
            const first = nextChoice(board)
            expectEqual(first.option.type, 'block', 'the card reaches the stealth')
            applyOption(first.decision, first.option)

            const second = nextChoice(board)
            expectEqual(second.decision.kind, DecisionKind.ReactionImpulse, 'the window')
            expectEqual(playedCard(second.option), EYES_OF_ARGUS_ID, 'Eyes of Argus')
            applyOption(second.decision, second.option)
            const action = board.ring.gameState.action
            expectEqual(
                (action?.intercept ?? 0) >= (action?.stealth ?? 9),
                true,
                'the block stands',
            )
        },
    },
    {
        name: 'Reaction decision: a flip that is not worth the fight it runs my blocker into is not played',
        run() {
            const board = reactionBoard({
                actor: { strength: 5, bleed: 1 },
                blockers: [{ strength: 1, intercept: 0, blood: 3, disciplines: AUSPEX_INFERIOR }],
                stealth: 1,
                hand: [EYES_OF_ARGUS_ID],
            })
            expectEqual(nextChoice(board).option.type, 'noBlock', 'not blocked')
            const window = blockByHand(board)
            expectEqual(window.kind, DecisionKind.ReactionImpulse, 'the window')
            expectEqual(
                optionsOfType(window.options, 'playReaction').length > 0,
                true,
                'the card is offered',
            )
            expectEqual(chooseThroughView(window, agentOf()).type, 'noReaction', 'passes')
        },
    },
    {
        name: 'Reaction decision: the card in play that costs nothing is used before the card of the hand',
        run() {
            const board = reactionBoard({
                actor: { strength: 1, bleed: 4 },
                blockers: [{ strength: 4, intercept: 0, disciplines: AUSPEX_INFERIOR }],
                stealth: 1,
                hand: [EYES_OF_ARGUS_ID],
            })
            const krcg = findAnyCard(board.me, KRCG_ID)
            board.ring.gameState.moveCardToRegion(krcg, board.me.ready)
            const window = blockByHand(board)
            expectEqual(optionsOfType(window.options, 'playReaction').length > 0, true, 'a card')
            const option = chooseThroughView(window, agentOf())
            expectEqual(option.type, 'lockForReaction', 'the permanent first')
            applyOption(window, option)
            expectEqual(krcg.isLocked, true, 'locked')

            // The block stands and succeeds: nothing is left to play
            const next = passUntilDecides(board.ring.gameState, board.me)
            expectEqual(chooseThroughView(next, agentOf()).type, 'noReaction', 'passes')
        },
    },
    {
        name: 'Reaction decision: two sources that are both needed are played one after the other, the cheaper one first',
        run() {
            const board = reactionBoard({
                actor: { strength: 1, bleed: 4 },
                blockers: [{ strength: 4, intercept: 0, disciplines: AUSPEX_INFERIOR }],
                stealth: 3,
                hand: [EYES_OF_ARGUS_ID],
            })
            const krcg = findAnyCard(board.me, KRCG_ID)
            board.ring.gameState.moveCardToRegion(krcg, board.me.ready)
            const window = blockByHand(board)
            const first = chooseThroughView(window, agentOf())
            expectEqual(first.type, 'lockForReaction', 'the permanent first')
            applyOption(window, first)
            const next = passUntilDecides(board.ring.gameState, board.me)
            const second = chooseThroughView(next, agentOf())
            expectEqual(playedCard(second), EYES_OF_ARGUS_ID, 'then the card')
            applyOption(next, second)
            const action = board.ring.gameState.action
            expectEqual(
                (action?.intercept ?? 0) >= (action?.stealth ?? 9),
                true,
                'the block stands',
            )
        },
    },
    {
        name: 'Reaction decision: a bounce card is preferred to a block that runs my blocker into a fight, not without the card',
        run() {
            const setup: BlockSetup = {
                actor: { strength: 3, bleed: 4 },
                blockers: [{ strength: 3, intercept: 1, disciplines: DOMINATE_INFERIOR }],
            }
            expectEqual(
                nextChoice(reactionBoard({ ...setup, hand: [] })).option.type,
                'block',
                'a block without the card',
            )
            expectEqual(
                nextChoice(reactionBoard({ ...setup, hand: [DEFLECTION_ID] })).option.type,
                'noBlock',
                'a bounce with it',
            )
        },
    },
    {
        name: 'Reaction decision: an inferior bounce locks the reacting minion, which counts when it is my last defender against the attackers to come',
        run() {
            const bounceScore = (second: boolean) => {
                const board = reactionBoard({
                    actor: { strength: 5, bleed: 4 },
                    second: second ? { bleed: 4, blood: 5 } : undefined,
                    blockers: [
                        { strength: 1, intercept: 1, blood: 3, disciplines: DOMINATE_INFERIOR },
                    ],
                    hand: [DEFLECTION_ID],
                })
                const first = passUntilDecides(board.ring.gameState, board.me)
                applyOption(first, findOption(first.options, 'noBlock'))
                const window = passUntilDecides(board.ring.gameState, board.me)
                const trace: ExplainCandidate[] = []
                const agent = new UtilityAgent(REACTION_DECK, undefined, entry =>
                    trace.push(...entry.candidates),
                )
                chooseThroughView(window, agent)
                return trace[0]?.parts.lock ?? 0
            }
            expectEqual(bounceScore(false), 0, 'nobody else to send')
            expectEqual(bounceScore(true) > 0, true, 'a second attacker is waiting')
        },
    },
    {
        name: 'Reaction decision: a locked minion is woken by the card when its block is worth it, not without the card',
        run() {
            const setup: BlockSetup = {
                actor: { strength: 1, bleed: 6 },
                blockers: [{ strength: 4, intercept: 1, locked: true }],
                pool: 5,
            }
            expectEqual(
                nextChoice(reactionBoard({ ...setup, hand: [] })).option.type,
                'noBlock',
                'no card',
            )
            const board = reactionBoard({ ...setup, hand: [QUI_VIVE_ID] })
            const woken = nextChoice(board)
            expectEqual(playedCard(woken.option), QUI_VIVE_ID, 'On the Qui Vive')
            applyOption(woken.decision, woken.option)
            const after = nextChoice(board)
            expectEqual(after.option.type, 'block', 'the woken minion blocks')
        },
    },
    {
        name: 'Reaction decision: a card that unlocks a vampire and blocks with it is played against a bleed that would oust me',
        run() {
            const board = reactionBoard({
                actor: { strength: 1, bleed: 6 },
                blockers: [{ strength: 4, intercept: 1, locked: true }],
                pool: 5,
                hand: [ORGANIZED_RESISTANCE_ID],
            })
            board.blockers[0].vampireAttrs.sect = Sect.Anarch
            board.blockers[0].vampireAttrs.title = 'baron'
            const choice = nextChoice(board)
            expectEqual(playedCard(choice.option), ORGANIZED_RESISTANCE_ID, 'Organized Resistance')
            if (choice.option.type == 'playReaction') {
                expectEqual(choice.option.effect.type, 'unlockBlock', 'unlocks and blocks')
            }
        },
    },
    {
        name: 'Reaction decision: a bleed that is not worth a fight is bounced with the card, in the next window',
        run() {
            const setup: BlockSetup = {
                actor: { strength: 5, bleed: 4 },
                blockers: [{ strength: 1, intercept: 1, blood: 3, disciplines: DOMINATE_INFERIOR }],
            }
            const without = reactionBoard({ ...setup, hand: [] })
            const window = passUntilDecides(without.ring.gameState, without.me)
            applyOption(window, findOption(window.options, 'noBlock'))
            expectEqual(nextChoice(without).option.type, 'noReaction', 'nothing to bounce with')

            const board = reactionBoard({ ...setup, hand: [DEFLECTION_ID] })
            const first = nextChoice(board)
            expectEqual(first.option.type, 'noBlock', 'the block is left to the bounce')
            applyOption(first.decision, first.option)
            const second = nextChoice(board)
            expectEqual(playedCard(second.option), DEFLECTION_ID, 'Deflection')
            if (second.option.type == 'playReaction') {
                expectEqual(second.option.effect.type, 'changeTarget', 'a bounce')
            }
        },
    },
    {
        name: "Reaction decision: Cats' Guidance unlocks the blocker once the combat is over when my predator has attackers left",
        run() {
            const unlockChoice = (extraAttacker: boolean) => {
                const game = createBlockCombat(DisciplineLevel.INFERIOR)
                if (extraAttacker) {
                    const second = readyVampire(game.gameState, game.bleeder, 5)
                    second.minionAttrs.bleed = 4
                }
                game.bled.pool = 3
                endCombatByHand(game)
                const decision = getPostBlockDecision(game)
                return chooseThroughView(decision, agentOf(MalkavDeck)).type
            }
            expectEqual(unlockChoice(false), 'noReaction', 'nobody left to stop')
            expectEqual(unlockChoice(true), 'playReaction', 'a defender is worth the card')
        },
    },
    {
        name: 'Reaction decision: the trigger that unlocks a minion for a blood is used while the minion has the blood to act',
        run() {
            const choose = (blood: number) => {
                const game = createAlineGame({ alineBlood: blood })
                passUntilActionOver(game.gameState)
                return chooseThroughView(getTriggerDecision(game), agentOf(BrujahDeck)).type
            }
            expectEqual(choose(3), 'useTrigger', 'blood to spare')
            expectEqual(choose(1), 'skipTrigger', 'her last blood')
        },
    },
]
