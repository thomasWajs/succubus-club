import { MinionActionType } from '@/shared/types/state.ts'
import { Discipline, DisciplineLevel } from '@/shared/const/model.ts'
import { Disciplines } from '@/shared/types/resources.ts'
import { LOST_IN_CROWDS_ID } from '@/shared/cardImpl/cardIds.ts'
import { createPlayerView, chooseThroughView } from '@/shared/bot/playerView.ts'
import { findOption } from '@/shared/bot/helpers.ts'
import { MalkavDeck, GovernDeck } from '@/shared/bot/decks.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { applyOption, getDecisionPoint, getDecidingPlayer } from '@/shared/bot/referee.ts'
import { UtilityAgent } from '@/shared/bot/agents/utilityAgent.ts'
import { BotProfile, DEFAULT_PROFILE } from '@/shared/bot/utility/profile.ts'
import { assess } from '@/shared/bot/utility/assessment.ts'
import { judgeModifier, ModifierJudgement } from '@/shared/bot/utility/modifierDecision.ts'
import { optionsOfType, BotOption } from '@/shared/bot/types.ts'
import {
    MinionSetup,
    addMinions,
    assessAs,
    createRing,
    expectClose,
    holdOnly,
} from './assessment.ts'
import { findAnyCard } from './attachment.ts'
import { sealLibrary } from './bounce.ts'
import { minionDecisionOf } from './plan.ts'
import { Scenario, ScenarioFailure, expectEqual } from './helpers.ts'
import {
    BONDING_ID,
    CONDITIONING_ID,
    FACELESS_NIGHT_ID,
    modifierLevel,
    passUntilDecides,
} from './catalog.ts'
import { KRCG_ID } from './krcg.ts'
import { AUSPEX_INFERIOR } from './reaction.ts'
import { LABYRINTH_ID } from './labyrinth.ts'
import { blockBoard, blockWindow } from './block.ts'

/**
 * Modifier decision: my minion bleeds my prey and I decide the stealth and bleed cards. Three Methuselahs,
 * the hands are controlled and the vampires have no discipline but the ones the cards need.
 */

type ModifierSetup = {
    actor?: MinionSetup
    blockers?: MinionSetup[]
    // The pool of my prey
    pool?: number
    hand: string[]
    // What my prey does when the window is open: attempts the first block, declines, or is not asked yet
    prey: 'blocks' | 'declines' | 'waiting'
    // The stealth of the action once the block stands, when the scenario sets it
    stealth?: number
    // A card put in play under my control, for a Nosferatu actor
    permanent?: string
    // A card put in play, unlocked, under the control of my prey
    preyPermanent?: string
    // The cards in the hand of my prey ( I do not see them )
    preyHand?: string[]
    action?: MinionActionType
}

const OBFUSCATE_INFERIOR: Partial<Disciplines> = {
    [Discipline.Obfuscate]: DisciplineLevel.INFERIOR,
}

function modifierBoard(setup: ModifierSetup) {
    const ring = createRing([
        setup.permanent ? <DeckList>{ ...MalkavDeck, [setup.permanent]: 2 } : MalkavDeck,
        setup.preyPermanent ? <DeckList>{ ...MalkavDeck, [setup.preyPermanent]: 2 } : MalkavDeck,
        MalkavDeck,
    ])
    const [me, prey] = ring.players
    const [actor] = addMinions(ring, me, [{ bleed: 3, blood: 5, ...setup.actor }])
    const blockers = addMinions(ring, prey, setup.blockers ?? [])
    prey.pool = setup.pool ?? 10
    if (setup.permanent) {
        actor.vampireAttrs.clan = 'Nosferatu'
        ring.gameState.moveCardToRegion(findAnyCard(me, setup.permanent), me.ready)
    }
    if (setup.preyPermanent) {
        ring.gameState.moveCardToRegion(findAnyCard(prey, setup.preyPermanent), prey.ready)
    }
    holdOnly(ring, me, setup.hand)
    holdOnly(ring, prey, setup.preyHand ?? [])
    for (const player of ring.players) {
        sealLibrary(ring.gameState, player)
    }
    const decision = minionDecisionOf(ring, me)
    const declare = decision.options.find(
        option =>
            option.type == 'declareAction' &&
            option.action.type == (setup.action ?? MinionActionType.Bleed) &&
            option.action.actingMinion == actor,
    )
    if (!declare) {
        throw new ScenarioFailure('The action is not offered')
    }
    applyOption(decision, declare)
    const { gameState } = ring
    if (setup.prey != 'waiting') {
        const window = passUntilDecides(gameState, prey)
        applyOption(
            window,
            setup.prey == 'blocks' ?
                (optionsOfType(window.options, 'block').find(
                    option => option.minion == blockers[0],
                ) ?? findOption(window.options, 'block'))
            :   findOption(window.options, 'noBlock'),
        )
        if (setup.stealth !== undefined && gameState.action) {
            gameState.action.stealth = setup.stealth
        }
    }
    return { ring, me, prey, actor, blockers }
}

type ModifierBoard = ReturnType<typeof modifierBoard>

function modifierWindow(board: ModifierBoard, profile: BotProfile = DEFAULT_PROFILE) {
    const decision = passUntilDecides(board.ring.gameState, board.me)
    const view = createPlayerView(board.ring.gameState, board.me)
    try {
        const viewDecision = getDecisionPoint(view.gameState, view.player)
        if (!viewDecision) {
            throw new ScenarioFailure('No decision in the view')
        }
        const judged = judgeModifier(viewDecision, assess(view.gameState, view.player, profile))
        return { decision, judged }
    } finally {
        view.dispose()
    }
}

function modifierJudgement(board: ModifierBoard): ModifierJudgement {
    const { judged } = modifierWindow(board)
    if (!judged) {
        throw new ScenarioFailure('The modifier is not judged')
    }
    return judged
}

const chosenModifier = (board: ModifierBoard, profile: BotProfile = DEFAULT_PROFILE): BotOption =>
    chooseThroughView(
        modifierWindow(board, profile).decision,
        new UtilityAgent(MalkavDeck, profile),
    )

const modifierCard = (option: BotOption) =>
    option.type == 'playModifier' ? option.modifier.card.krcgId : option.type

export const MODIFIER_SCENARIOS: Scenario[] = [
    {
        name: 'Modifier decision: the stealth that flips a block that would cost me the fight is played',
        run() {
            const board = modifierBoard({
                actor: { strength: 1, disciplines: OBFUSCATE_INFERIOR },
                blockers: [{ strength: 4, intercept: 0 }],
                hand: [LOST_IN_CROWDS_ID],
                prey: 'blocks',
            })
            expectEqual(modifierCard(chosenModifier(board)), LOST_IN_CROWDS_ID, 'the card')
            const dear = { ...DEFAULT_PROFILE, plan: { ...DEFAULT_PROFILE.plan, spentCard: 10 } }
            expectEqual(
                modifierCard(chosenModifier(board, dear)),
                'noModifier',
                'kept at a dear price',
            )
        },
    },
    {
        name: 'Modifier decision: the stealth is not played when it cannot flip the block alone ( a card wasted )',
        run() {
            const board = modifierBoard({
                actor: { strength: 1, disciplines: OBFUSCATE_INFERIOR },
                blockers: [{ strength: 4, intercept: 1 }],
                hand: [LOST_IN_CROWDS_ID],
                prey: 'blocks',
            })
            expectEqual(modifierCard(chosenModifier(board)), 'noModifier', 'the pass')
        },
    },
    {
        name: 'Modifier decision: two cards that flip the block together are both played, one then the other',
        run() {
            const board = modifierBoard({
                actor: { strength: 1, disciplines: OBFUSCATE_INFERIOR },
                blockers: [{ strength: 4, intercept: 1 }],
                hand: [LOST_IN_CROWDS_ID, FACELESS_NIGHT_ID],
                prey: 'blocks',
            })
            const agent = new UtilityAgent(MalkavDeck)
            const window = modifierWindow(board).decision
            const first = chooseThroughView(window, agent)
            expectEqual(first.type, 'playModifier', 'the first card')
            applyOption(window, first)
            const second = chooseThroughView(modifierWindow(board).decision, agent)
            expectEqual(second.type, 'playModifier', 'the second card')
        },
    },
    {
        name: 'Modifier decision: a block I would win is left standing when the action is worth less than the fight',
        run() {
            const board = modifierBoard({
                actor: { strength: 6, blood: 8, bleed: 1, disciplines: OBFUSCATE_INFERIOR },
                blockers: [{ strength: 1, intercept: 0, blood: 2 }],
                hand: [LOST_IN_CROWDS_ID],
                prey: 'blocks',
            })
            expectEqual(modifierCard(chosenModifier(board)), 'noModifier', 'the pass')
        },
    },
    {
        name: 'Modifier decision: a flip that the intercept in play of my prey raises back is not played, with a second card it is',
        run() {
            const setup = {
                actor: { strength: 1, disciplines: OBFUSCATE_INFERIOR },
                blockers: [{ strength: 4, intercept: 0 }],
                preyPermanent: KRCG_ID,
                prey: 'blocks' as const,
            }
            const alone = modifierBoard({ ...setup, hand: [LOST_IN_CROWDS_ID] })
            const judged = modifierJudgement(alone)
            expectEqual(judged.option.type, 'noModifier', 'one card is raised back')
            expectEqual(judged.candidates[0].parts.reblocked, 1, 'the radio raises it')
            expectEqual(judged.candidates[0].score < 0, true, 'the card is lost for nothing')

            const both = modifierBoard({ ...setup, hand: [LOST_IN_CROWDS_ID, FACELESS_NIGHT_ID] })
            expectEqual(modifierCard(chosenModifier(both)), LOST_IN_CROWDS_ID, 'the race is won')
        },
    },
    {
        name: 'Modifier decision: the intercept in play of my prey counts only while it is unlocked',
        run() {
            const board = modifierBoard({
                actor: { strength: 1, disciplines: OBFUSCATE_INFERIOR },
                blockers: [{ strength: 4, intercept: 0 }],
                hand: [LOST_IN_CROWDS_ID],
                preyPermanent: KRCG_ID,
                prey: 'blocks',
            })
            const radio = board.prey.ready.cards.find(card => card.krcgId == KRCG_ID)
            if (!radio) {
                throw new ScenarioFailure('The radio is not in play')
            }
            radio.isLocked = true
            const judged = modifierJudgement(board)
            expectEqual(judged.candidates[0].parts.reblocked, 0, 'nothing to raise')
            expectEqual(modifierCard(chosenModifier(board)), LOST_IN_CROWDS_ID, 'the card')
        },
    },
    {
        name: 'Modifier decision: the intercept cards my prey may hold weigh on the flip when its blocker has Auspex',
        run() {
            const hand = [LOST_IN_CROWDS_ID, FACELESS_NIGHT_ID]
            const withAuspex = { strength: 4, intercept: 0, disciplines: AUSPEX_INFERIOR }
            const without = { strength: 4, intercept: 0 }
            // The same two minions, the one that blocks is the other
            const board = (blockers: MinionSetup[]) =>
                modifierBoard({
                    actor: { strength: 1, disciplines: OBFUSCATE_INFERIOR },
                    blockers,
                    hand: [LOST_IN_CROWDS_ID],
                    preyHand: hand,
                    prey: 'blocks',
                })
            const auspex = board([withAuspex, without])
            const density =
                assessAs(auspex.ring, auspex.me).densities[auspex.prey.oid].intercept ?? 0
            expectEqual(density > 0, true, 'Auspex is the evidence')
            const risky = modifierJudgement(auspex).candidates[0]
            expectClose(
                risky.parts.reblocked,
                1 - (1 - density) ** hand.length,
                'a card among two is intercept',
                0.001,
            )
            const plain = modifierJudgement(board([without, withAuspex])).candidates[0]
            expectEqual(plain.parts.reblocked, 0, 'the blocker has no discipline to play it')
            expectEqual(risky.score < plain.score, true, 'the doubt costs')
        },
    },
    {
        name: 'Modifier decision: a flip that the intercept cards of my prey would very likely raise back is not played',
        run() {
            const board = () =>
                modifierBoard({
                    actor: { strength: 1, disciplines: OBFUSCATE_INFERIOR },
                    blockers: [{ strength: 4, intercept: 0, disciplines: AUSPEX_INFERIOR }],
                    hand: [LOST_IN_CROWDS_ID],
                    preyHand: [LOST_IN_CROWDS_ID, FACELESS_NIGHT_ID],
                    prey: 'blocks',
                })
            const parts = modifierJudgement(board()).candidates[0].parts
            const plan = { ...DEFAULT_PROFILE.plan, spentCard: (parts.success + parts.fight) / 2 }
            const prior = DEFAULT_PROFILE.opponentPrior
            const unlikely = { ...DEFAULT_PROFILE, plan }
            const likely = {
                ...unlikely,
                opponentPrior: { ...prior, density: { ...prior.density, intercept: 1 } },
            }
            expectEqual(
                modifierCard(chosenModifier(board(), unlikely)),
                LOST_IN_CROWDS_ID,
                'the card',
            )
            expectEqual(modifierCard(chosenModifier(board(), likely)), 'noModifier', 'raised back')
        },
    },
    {
        name: 'Modifier decision: a bleed bonus waits for the block window of my prey',
        run() {
            const board = modifierBoard({
                actor: { disciplines: { [Discipline.Dominate]: DisciplineLevel.INFERIOR } },
                hand: [CONDITIONING_ID],
                prey: 'waiting',
            })
            const judged = modifierJudgement(board)
            expectEqual(judged.option.type, 'noModifier', 'the pass')
        },
    },
    {
        name: 'Modifier decision: a bleed bonus is played once my prey declined to block',
        run() {
            const board = modifierBoard({
                actor: { disciplines: { [Discipline.Dominate]: DisciplineLevel.INFERIOR } },
                hand: [CONDITIONING_ID],
                prey: 'declines',
            })
            expectEqual(modifierCard(chosenModifier(board)), CONDITIONING_ID, 'the card')
        },
    },
    {
        name: 'Modifier decision: a bleed bonus that adds nothing is kept ( the bleed already ousts my prey )',
        run() {
            const board = modifierBoard({
                actor: { disciplines: { [Discipline.Dominate]: DisciplineLevel.INFERIOR } },
                hand: [CONDITIONING_ID],
                prey: 'declines',
                pool: 2,
            })
            expectEqual(modifierCard(chosenModifier(board)), 'noModifier', 'the pass')
        },
    },
    {
        name: 'Modifier decision: a card in play that gives the stealth for free is used before a card of the hand',
        run() {
            const board = modifierBoard({
                actor: { strength: 1, disciplines: OBFUSCATE_INFERIOR },
                blockers: [{ strength: 4, intercept: 0 }],
                hand: [LOST_IN_CROWDS_ID],
                permanent: LABYRINTH_ID,
                prey: 'blocks',
            })
            const judged = modifierJudgement(board)
            expectEqual(judged.candidates.length, 2, 'the card and the permanent')
            expectEqual(chosenModifier(board).type, 'lockForAction', 'the permanent')
        },
    },
    {
        name: 'Modifier decision: a flip that only draws the next blocker is not played ( no stealth left for it )',
        run() {
            const board = modifierBoard({
                actor: { strength: 1, disciplines: OBFUSCATE_INFERIOR },
                blockers: [
                    { strength: 4, intercept: 0 },
                    { strength: 4, intercept: 1 },
                ],
                hand: [LOST_IN_CROWDS_ID],
                prey: 'blocks',
            })
            const judged = modifierJudgement(board)
            expectEqual(judged.option.type, 'noModifier', 'the pass')
            expectEqual(judged.candidates[0].parts.blocked, 1, 'the next blocker stops it')
        },
    },
    {
        name: 'Modifier decision: a hunt that a block would stop is flipped when the blood is worth the card',
        run() {
            const board = modifierBoard({
                actor: { strength: 1, blood: 1, disciplines: OBFUSCATE_INFERIOR },
                blockers: [{ strength: 4, intercept: 1 }],
                hand: [LOST_IN_CROWDS_ID],
                action: MinionActionType.Hunt,
                prey: 'blocks',
                stealth: 0,
            })
            expectEqual(modifierCard(chosenModifier(board)), 'noModifier', 'the pass: needs two')
            const flip = modifierBoard({
                actor: { strength: 1, blood: 1, disciplines: OBFUSCATE_INFERIOR },
                blockers: [{ strength: 4, intercept: 0 }],
                hand: [LOST_IN_CROWDS_ID],
                action: MinionActionType.Hunt,
                prey: 'blocks',
                stealth: 0,
            })
            expectEqual(modifierCard(chosenModifier(flip)), LOST_IN_CROWDS_ID, 'the card')
        },
    },
    {
        name: 'Modifier decision: the whole action through the agent: the block window is declined, the bonus played, the bleed lands with it',
        run() {
            const board = modifierBoard({
                actor: { disciplines: { [Discipline.Dominate]: DisciplineLevel.INFERIOR } },
                hand: [CONDITIONING_ID],
                prey: 'waiting',
            })
            const { gameState } = board.ring
            const agent = new UtilityAgent(MalkavDeck)
            for (let step = 0; step < 12 && gameState.action; step++) {
                const decider = getDecidingPlayer(gameState)
                const decision = decider && getDecisionPoint(gameState, decider)
                if (!decision) {
                    throw new ScenarioFailure('Nobody has a decision')
                }
                applyOption(decision, chooseThroughView(decision, agent))
            }
            expectEqual(gameState.action, null, 'the action is over')
            expectEqual(board.prey.pool, 5, 'the bleed of 3 and the bonus of 2 landed')
        },
    },
    {
        name: 'Modifier decision: a block I would win is still flipped when the bleed is worth more than the fight',
        run() {
            const board = modifierBoard({
                actor: { strength: 6, blood: 8, bleed: 5, disciplines: OBFUSCATE_INFERIOR },
                blockers: [{ strength: 1, intercept: 0, blood: 2 }],
                hand: [LOST_IN_CROWDS_ID],
                prey: 'blocks',
            })
            const judged = modifierJudgement(board)
            expectEqual(judged.candidates[0].parts.fight < 0, true, 'the fight is won')
            expectEqual(modifierCard(chosenModifier(board)), LOST_IN_CROWDS_ID, 'the card')
        },
    },
    {
        name: 'Modifier decision: a flip that also gets past the next blocker is played',
        run() {
            const board = modifierBoard({
                actor: { strength: 1, disciplines: OBFUSCATE_INFERIOR },
                blockers: [
                    { strength: 4, intercept: 0 },
                    { strength: 4, intercept: 0 },
                ],
                hand: [LOST_IN_CROWDS_ID],
                prey: 'blocks',
            })
            const judged = modifierJudgement(board)
            expectEqual(judged.candidates[0].parts.blocked, 0, 'nobody blocks again')
            expectEqual(judged.option.type, 'playModifier', 'the card')
        },
    },
    {
        name: 'Modifier decision: a card that costs more than it brings is kept ( the card has a price )',
        run() {
            const board = () =>
                modifierBoard({
                    actor: {
                        bleed: 1,
                        disciplines: { [Discipline.Dominate]: DisciplineLevel.INFERIOR },
                    },
                    hand: [BONDING_ID],
                    prey: 'declines',
                    pool: 30,
                })
            expectEqual(
                modifierCard(chosenModifier(board())),
                BONDING_ID,
                'played at the default price',
            )
            const dear = { ...DEFAULT_PROFILE, plan: { ...DEFAULT_PROFILE.plan, spentCard: 2 } }
            expectEqual(
                modifierCard(chosenModifier(board(), dear)),
                'noModifier',
                'kept at a dear price',
            )
        },
    },
    {
        name: 'Modifier decision: the best level of a card that costs a blood is played, and none when the blood is dear',
        run() {
            const board = () =>
                modifierBoard({
                    actor: {
                        bleed: 1,
                        disciplines: { [Discipline.Dominate]: DisciplineLevel.SUPERIOR },
                    },
                    hand: [CONDITIONING_ID],
                    prey: 'declines',
                    pool: 30,
                })
            const level = (profile: BotProfile) => {
                const option = chosenModifier(board(), profile)
                return option.type == 'playModifier' ? modifierLevel(option) : option.type
            }
            expectEqual(
                level(DEFAULT_PROFILE),
                DisciplineLevel.SUPERIOR,
                'superior at the default price',
            )
            const dear = { ...DEFAULT_PROFILE, plan: { ...DEFAULT_PROFILE.plan, bloodValue: 4 } }
            expectEqual(level(dear), 'noModifier', 'kept when the blood is dear')
        },
    },
    {
        name: 'Block window: a Methuselah that does not block says so, and the acting player has the impulse back',
        run() {
            const board = blockBoard({
                actor: { strength: 5, bleed: 1 },
                blockers: [{ strength: 1, intercept: 1, blood: 3 }],
            })
            const window = blockWindow(board).decision
            const option = chooseThroughView(window, new UtilityAgent(GovernDeck))
            expectEqual(option.type, 'noBlock', 'declined out loud')
            applyOption(window, option)
            expectEqual(
                getDecidingPlayer(board.ring.gameState),
                board.predator,
                'the acting player',
            )
        },
    },
    {
        name: 'Block window: with no minion able to block the window is still declined out loud',
        run() {
            const board = blockBoard({ actor: { strength: 1, bleed: 3 }, blockers: [] })
            const option = chooseThroughView(
                blockWindow(board).decision,
                new UtilityAgent(GovernDeck),
            )
            expectEqual(option.type, 'noBlock', 'declined out loud')
        },
    },
]
