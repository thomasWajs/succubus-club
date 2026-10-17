import { Player } from '@/shared/model/Player.ts'
import {
    Discipline,
    DisciplineLevel,
    TurnPhase,
    TurnSequence,
    transfersOfTurn,
} from '@/shared/const/model.ts'
import { Disciplines } from '@/shared/types/resources.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { chooseThroughView } from '@/shared/bot/playerView.ts'
import { GovernDeck } from '@/shared/bot/decks.ts'
import { applyOption, getDecisionPoint } from '@/shared/bot/referee.ts'
import { UtilityAgent } from '@/shared/bot/agents/utilityAgent.ts'
import { BotOption, DecisionKind } from '@/shared/bot/types.ts'
import { BotProfile, DEFAULT_PROFILE } from '@/shared/bot/utility/profile.ts'
import { InfluencePlan, influencePlans } from '@/shared/bot/utility/influence.ts'
import {
    MinionSetup,
    Ring,
    addMinions,
    assessAs,
    createRing,
    expectClose,
    holdOnly,
} from './assessment.ts'
import { sealLibrary } from './bounce.ts'
import { VILLEIN_DECK } from './catalog.ts'
import { Scenario, ScenarioFailure, expectEqual } from './helpers.ts'
import { GOVERN_ID, VILLEIN_ID } from '../cardIds.ts'

/**
 * The influence phase: which vampire comes out, in which order, and when the pool says stop. The
 * transfers of every turn are known from the start, so the order is a plan over them. Four Methuselahs
 * with no card of interest, so the numbers can be read.
 */

type InfluenceSetup = {
    // The turn of the table ( 1 to 4 decide the transfers )
    turn: number
    // The uncontrolled vampires of mine, as ( capacity, blood ); the four are described
    uncontrolled: [number, number][]
    pool?: number
    ready?: MinionSetup[]
    hand?: string[]
    // The deck of the table, when the hand needs a card the Govern deck lacks
    deck?: DeckList
    // The vampires of my predator, which are unlocked
    predator?: MinionSetup[]
    // The transfers left of the turn, when it is not a fresh one
    transfers?: number
}

type InfluenceTurn = {
    ring: Ring
    me: Player
}

function influenceTurn(setup: InfluenceSetup): InfluenceTurn {
    const players = 4
    const ring = createRing(Array.from({ length: players }, () => setup.deck ?? GovernDeck))
    const { gameState } = ring
    const me = ring.players[0]
    const predator = ring.players[players - 1]
    const ready = addMinions(ring, me, setup.ready ?? [])
    // Old enough to put blood on the vampires below
    for (const minion of ready) {
        minion.minionAttrs.capacity = 11
    }
    addMinions(ring, predator, setup.predator ?? [])
    for (const [index, vampire] of me.vampiresInUncontrolled.entries()) {
        const [capacity, blood] = setup.uncontrolled[index]
        vampire.minionAttrs.capacity = capacity
        vampire.minionAttrs.disciplines = {} as Disciplines
        vampire.blood = blood
    }
    for (const player of ring.players) {
        holdOnly(ring, player, player == me ? (setup.hand ?? []) : [])
        sealLibrary(gameState, player)
    }
    me.pool = setup.pool ?? 30
    gameState.turnNumber = setup.turn
    gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Influence)
    gameState.turnResources.unlocked = true
    gameState.turnResources.transfers = setup.transfers ?? transfersOfTurn(setup.turn, players)
    gameState.activePlayerIndex = gameState.competingPlayers.indexOf(me)
    return { ring, me }
}

// The plans the bot makes, through its view
function plansOf(turn: InfluenceTurn, deck: DeckList = GovernDeck): InfluencePlan[] {
    return influencePlans(assessAs(turn.ring, turn.me), deck)
}

// Plays the phase with the utility agent until it ends it: what it influenced, as ( capacity, amount )
function playPhase(turn: InfluenceTurn, profile: BotProfile = DEFAULT_PROFILE): [number, number][] {
    const agent = new UtilityAgent(GovernDeck, profile)
    const done: [number, number][] = []
    for (let step = 0; step < 12; step++) {
        const decision = getDecisionPoint(turn.ring.gameState, turn.me)
        if (decision?.kind != DecisionKind.Influence) {
            throw new ScenarioFailure('No influence decision')
        }
        const option: BotOption = chooseThroughView(decision, agent)
        if (option.type == 'endPhase') {
            return done
        }
        if (option.type != 'influence') {
            throw new ScenarioFailure(`Unexpected ${option.type}`)
        }
        done.push([option.vampire.minionAttrs.capacity, option.amount])
        applyOption(decision, option)
    }
    throw new ScenarioFailure('The influence phase does not end')
}

// The plan that brings out these capacities in this order
function planOf(plans: InfluencePlan[], capacities: number[]): InfluencePlan {
    const plan = plans.find(
        candidate =>
            candidate.order.length == capacities.length &&
            candidate.order.every(({ vampire }, index) => vampire.capacity == capacities[index]),
    )
    if (!plan) {
        throw new ScenarioFailure(`No plan brings out ${capacities.join(', ')}`)
    }
    return plan
}

const turnsOf = (plan: InfluencePlan) => plan.order.map(({ turn }) => turn).join(',')

const DOMINATE_SUPERIOR: Partial<Disciplines> = { [Discipline.Dominate]: DisciplineLevel.SUPERIOR }

export const INFLUENCE_SCENARIOS: Scenario[] = [
    {
        name: 'Influence: the first Methuselah has 1, 5, 9, 13 transfers, so a 5 and then an 8 come on turns 2 and 4',
        run() {
            const turn = influenceTurn({
                turn: 1,
                uncontrolled: [
                    [8, 0],
                    [5, 0],
                    [11, 0],
                    [11, 0],
                ],
            })
            const plans = plansOf(turn)
            const small = planOf(plans, [5, 8])
            expectEqual(turnsOf(small), '1,3', 'turns of the 5 then the 8')
            const big = planOf(plans, [8, 5])
            expectEqual(turnsOf(big), '2,3', 'turns of the 8 then the 5')
            expectEqual(small.value > big.value, true, 'the 5 first is the better plan')
            expectEqual(playPhase(turn).join(' '), '5,1', 'the transfer goes on the 5')
        },
    },
    {
        name: 'Influence: the second Methuselah has 2, 6, 10 transfers, a 6 comes on turn 2',
        run() {
            const turn = influenceTurn({
                turn: 2,
                uncontrolled: [
                    [6, 0],
                    [9, 0],
                    [11, 0],
                    [11, 0],
                ],
            })
            expectEqual(turnsOf(planOf(plansOf(turn), [6])), '1', 'turn of the 6')
            expectEqual(playPhase(turn).join(' '), '6,2', 'the two transfers go on the 6')
        },
    },
    {
        name: 'Influence: the fourth Methuselah has 4 transfers at once, a 4 comes now and the rest goes on the next',
        run() {
            const turn = influenceTurn({
                turn: 4,
                uncontrolled: [
                    [7, 0],
                    [4, 0],
                    [9, 0],
                    [11, 0],
                ],
            })
            expectEqual(turnsOf(planOf(plansOf(turn), [4, 7])), '0,2', 'turns of the 4 then the 7')
            expectEqual(playPhase(turn).join(' '), '4,4', 'all four go on the 4')
        },
    },
    {
        name: 'Influence: a vampire already started is finished first, the rest of the transfers go on the next',
        run() {
            const turn = influenceTurn({
                turn: 5,
                uncontrolled: [
                    [5, 0],
                    [6, 4],
                    [11, 0],
                    [11, 0],
                ],
            })
            expectEqual(turnsOf(planOf(plansOf(turn), [6])), '0', 'turn of the 6 that has 4 blood')
            expectEqual(
                playPhase(turn).join(' '),
                '6,2 5,2',
                'the 6 is completed, then the 5 started',
            )
        },
    },
    {
        name: 'Influence: a crew of three keeps the floor, the pool goes no lower',
        run() {
            const ready = [{}, {}, {}]
            const poor = influenceTurn({
                turn: 5,
                pool: 9,
                ready,
                uncontrolled: [
                    [5, 0],
                    [11, 0],
                    [11, 0],
                    [11, 0],
                ],
            })
            expectEqual(playPhase(poor).length, 0, 'nothing is brought out with a pool of 9')
            const rich = influenceTurn({
                turn: 5,
                pool: 14,
                ready,
                uncontrolled: [
                    [5, 0],
                    [11, 0],
                    [11, 0],
                    [11, 0],
                ],
            })
            expectEqual(playPhase(rich).join(' '), '5,4', 'the 5 is started with a pool of 14')
        },
    },
    {
        name: 'Influence: a predator that can oust me leaves the pool alone',
        run() {
            const menace = Array.from({ length: 4 }, () => ({ bleed: 5, blood: 5 }))
            const threatened = influenceTurn({
                turn: 5,
                pool: 14,
                predator: menace,
                uncontrolled: [
                    [5, 0],
                    [11, 0],
                    [11, 0],
                    [11, 0],
                ],
            })
            expectEqual(playPhase(threatened).length, 0, 'nothing is brought out under threat')
            const calm = influenceTurn({
                turn: 5,
                pool: 30,
                predator: menace,
                uncontrolled: [
                    [5, 0],
                    [11, 0],
                    [11, 0],
                    [11, 0],
                ],
            })
            expectEqual(playPhase(calm).length > 0, true, 'a deep pool still brings one out')
        },
    },
    {
        name: 'Influence: a Govern card and an older Dominate vampire in play bring the younger ones sooner',
        run() {
            const uncontrolled: [number, number][] = [
                [5, 0],
                [6, 0],
                [11, 0],
                [11, 0],
            ]
            const without = influenceTurn({
                turn: 5,
                ready: [{ disciplines: DOMINATE_SUPERIOR }],
                uncontrolled,
            })
            const with_ = influenceTurn({
                turn: 5,
                ready: [{ disciplines: DOMINATE_SUPERIOR }],
                hand: [GOVERN_ID],
                uncontrolled,
            })
            const before = planOf(plansOf(without, {}), [5, 6])
            const after = planOf(plansOf(with_, {}), [5, 6])
            expectEqual(turnsOf(before), '1,2', 'turns of the 5 then the 6 without the card')
            expectEqual(turnsOf(after), '1,1', 'turns of the 5 then the 6 with the card')
        },
    },
    {
        name: 'Influence: a Govern card does nothing for a vampire that is not younger than the one that plays it',
        run() {
            const turn = influenceTurn({
                turn: 5,
                ready: [{ disciplines: DOMINATE_SUPERIOR }],
                hand: [GOVERN_ID],
                uncontrolled: [
                    [11, 0],
                    [12, 0],
                    [13, 0],
                    [14, 0],
                ],
            })
            const plan = planOf(plansOf(turn, {}), [11])
            expectEqual(turnsOf(plan), '2', 'turn of the 11 with a Govern the card cannot use')
        },
    },
]

// Worth of one vampire of capacity 4 that comes now: its 8 turns of action at 1.5 + 0.15 x 4, its blood at 0.5, less its 4 pool
const FOUR_NOW = 8 * 2.1 + 2 - 4

export const INFLUENCE_VALUE_SCENARIOS: Scenario[] = [
    {
        name: 'Influence: a vampire is worth the turns it acts, its blood, less the pool it costs',
        run() {
            const now = influenceTurn({
                turn: 4,
                uncontrolled: [
                    [4, 0],
                    [11, 0],
                    [11, 0],
                    [11, 0],
                ],
            })
            expectClose(planOf(plansOf(now, {}), [4]).value, FOUR_NOW, 'a 4 that comes now')
            const later = influenceTurn({
                turn: 3,
                uncontrolled: [
                    [4, 0],
                    [11, 0],
                    [11, 0],
                    [11, 0],
                ],
            })
            expectClose(
                planOf(plansOf(later, {}), [4]).value,
                FOUR_NOW - 2.1,
                'a 4 that comes a turn later acts a turn less',
            )
        },
    },
    {
        name: 'Influence: a Villein in hand makes the blood of a vampire worth pool, so the big vampire is worth more',
        run() {
            const uncontrolled: [number, number][] = [
                [8, 0],
                [11, 0],
                [11, 0],
                [11, 0],
            ]
            const bare = influenceTurn({ turn: 4, uncontrolled })
            const tapped = influenceTurn({
                turn: 4,
                uncontrolled,
                hand: [VILLEIN_ID],
                deck: VILLEIN_DECK,
            })
            const gain =
                planOf(plansOf(tapped, {}), [8]).value - planOf(plansOf(bare, {}), [8]).value
            // The blood past the 2 a vampire keeps, up to the 5 a Villein takes, is worth a pool instead of half of one
            expectClose(gain, 0.5 * 5, 'what the Villein adds to the 8')
        },
    },
    {
        name: 'Influence: a plan that brings less than the margin is not made',
        run() {
            const turn = influenceTurn({
                turn: 4,
                uncontrolled: [
                    [4, 0],
                    [11, 0],
                    [11, 0],
                    [11, 0],
                ],
            })
            const strict = {
                ...DEFAULT_PROFILE,
                influence: { ...DEFAULT_PROFILE.influence, margin: 100 },
            }
            expectEqual(playPhase(turn, strict).length, 0, 'nothing is brought out')
        },
    },
    {
        name: 'Influence: a vampire that comes this turn blocks, so it comes where the same pool under threat does not buy a slower one',
        run() {
            const menace = Array.from({ length: 4 }, () => ({ bleed: 5, blood: 5 }))
            const setup = (capacity: number): InfluenceTurn =>
                influenceTurn({
                    turn: 5,
                    pool: 20,
                    predator: menace,
                    uncontrolled: [
                        [capacity, 0],
                        [11, 0],
                        [11, 0],
                        [11, 0],
                    ],
                })
            expectEqual(playPhase(setup(4)).join(' '), '4,4', 'the 4 comes and blocks')
            expectEqual(playPhase(setup(5)).length, 0, 'the 5 cannot come this turn')
        },
    },
]
