import { Player } from '@/shared/model/Player.ts'
import { MinionActionType } from '@/shared/types/state.ts'
import { Discipline, DisciplineLevel } from '@/shared/const/model.ts'
import { Disciplines } from '@/shared/types/resources.ts'
import { GOVERN_ID } from '@/shared/cardImpl/cardIds.ts'
import { createPlayerView } from '@/shared/bot/playerView.ts'
import { GovernDeck } from '@/shared/bot/decks.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { getDecisionPoint } from '@/shared/bot/referee.ts'
import { BotProfile, DEFAULT_PROFILE } from '@/shared/bot/utility/profile.ts'
import { assess } from '@/shared/bot/utility/assessment.ts'
import { PlayValues } from '@/shared/bot/utility/cardActions.ts'
import { candidateOf, PlannedAction } from '@/shared/bot/utility/turnPlan.ts'
import { optionsOfType } from '@/shared/bot/types.ts'
import { MinionSetup, addMinions, createRing, expectClose, holdOnly } from './assessment.ts'
import { sealLibrary } from './bounce.ts'
import { minionDecisionOf, planAs } from './plan.ts'
import { Scenario, ScenarioFailure, expectEqual } from './helpers.ts'
import { DOMINATE_INFERIOR } from './reaction.ts'
import { RAVEN_SPY_ID } from './attachment.ts'
import { MURDER_OF_CROWS_ID } from './crows.ts'
import { PRETERNATURAL_ID } from './putOn.ts'
import { TORN_SIGNPOST_ID } from './brujah.ts'
import { LINE_BRAWL_ID } from './brujahAction.ts'

/**
 * Action cards other than a bleed or a hunt: what each one is worth to the minion that plays it, in pool,
 * and the plan that chooses among them. Three Methuselahs, nobody holds a hidden card, so the numbers of
 * the judgement can be read.
 */

type CardTurnSetup = {
    minions: MinionSetup[]
    hand: string[]
    // The unlocked minions of my prey
    blockers?: MinionSetup[]
    // The cards that every deck holds, on top of the Govern deck
    extra?: string[]
    // The uncontrolled vampires of mine, as ( capacity, blood )
    uncontrolled?: [number, number][]
    // The minions of my predator, and the cards it holds
    predator?: MinionSetup[]
    predatorHand?: string[]
}

function cardTurn(setup: CardTurnSetup) {
    const deck = <DeckList>{
        ...GovernDeck,
        ...Object.fromEntries((setup.extra ?? []).map(id => [id, 2])),
    }
    const ring = createRing([deck, deck, deck])
    const [me, prey, predator] = ring.players
    const minions = addMinions(ring, me, setup.minions)
    // Old enough to put blood on the vampires below
    for (const minion of minions) {
        minion.minionAttrs.capacity = 11
    }
    addMinions(ring, prey, setup.blockers ?? [])
    addMinions(ring, predator, setup.predator ?? [])
    // The vampires that the scenario does not describe are full: no blood goes there
    for (const [index, vampire] of me.vampiresInUncontrolled.entries()) {
        const [capacity, blood] = setup.uncontrolled?.[index] ?? [
            vampire.minionAttrs.capacity,
            vampire.minionAttrs.capacity,
        ]
        vampire.minionAttrs.capacity = capacity
        vampire.blood = blood
    }
    holdOnly(ring, me, setup.hand)
    holdOnly(ring, prey, [])
    holdOnly(ring, predator, setup.predatorHand ?? [])
    for (const player of ring.players) {
        sealLibrary(ring.gameState, player)
    }
    return { ring, me, prey, minions }
}

type CardTurn = ReturnType<typeof cardTurn>

// The plays of the cards of the hand that the referee offers, with what each is worth
function cardValues(turn: CardTurn, profile: BotProfile = DEFAULT_PROFILE) {
    minionDecisionOf(turn.ring, turn.me)
    const view = createPlayerView(turn.ring.gameState, turn.me)
    try {
        const viewDecision = getDecisionPoint(view.gameState, view.player)
        if (!viewDecision) {
            throw new ScenarioFailure('No decision in the view')
        }
        const assessment = assess(view.gameState, view.player, profile)
        const values = new PlayValues(assessment)
        return optionsOfType(viewDecision.options, 'declareAction')
            .map(candidateOf)
            .flatMap(candidate => {
                const { action } = candidate.option
                if (action.type != MinionActionType.ActionCardFromHand) {
                    return []
                }
                return [
                    {
                        name: action.card.name,
                        level: candidate.play?.key.split(':')[1] ?? '',
                        target: candidate.play?.target,
                        ...values.valueOf(candidate),
                    },
                ]
            })
    } finally {
        view.dispose()
    }
}

const DOMINATE_SUPERIOR: Partial<Disciplines> = { [Discipline.Dominate]: DisciplineLevel.SUPERIOR }

const ANIMALISM_INFERIOR: Partial<Disciplines> = {
    [Discipline.Animalism]: DisciplineLevel.INFERIOR,
}

const targetOf = (action: PlannedAction | undefined) =>
    action?.option.action.type == MinionActionType.ActionCardFromHand ?
        action.option.action.usage.target
    :   undefined

export const CARD_ACTION_SCENARIOS: Scenario[] = [
    {
        name: 'Card actions: blood goes on the biggest vampire of the uncontrolled region, before a bleed',
        run() {
            const turn = cardTurn({
                minions: [{ disciplines: DOMINATE_SUPERIOR }],
                hand: [GOVERN_ID],
                uncontrolled: [
                    [3, 0],
                    [8, 0],
                ],
            })
            const plan = planAs(turn.ring, turn.me, { cards: true })
            const big = turn.me.vampiresInUncontrolled[1]
            expectEqual(
                targetOf(plan.actions[0])?.oid,
                big.oid,
                'the biggest vampire gets the blood',
            )
        },
    },
    {
        name: 'Card actions: a vampire that is full gets no blood, the card bleeds instead',
        run() {
            const turn = cardTurn({
                minions: [{ disciplines: DOMINATE_SUPERIOR }],
                hand: [GOVERN_ID],
                uncontrolled: [
                    [4, 4],
                    [6, 6],
                ],
            })
            const plan = planAs(turn.ring, turn.me, { cards: true })
            expectEqual(
                targetOf(plan.actions[0]) instanceof Player,
                true,
                'a bleed, no vampire filled',
            )
        },
    },
    {
        name: 'Card actions: the blood is worth less the more minions I already have',
        run() {
            const worth = (minions: number) => {
                const turn = cardTurn({
                    minions: Array.from({ length: minions }, (_, index) => ({
                        disciplines: index == 0 ? DOMINATE_SUPERIOR : {},
                    })),
                    hand: [GOVERN_ID],
                    uncontrolled: [[8, 0]],
                })
                const fill = cardValues(turn).find(
                    play => play.target == turn.me.vampiresInUncontrolled[0].oid,
                )
                return fill?.value ?? 0
            }
            expectEqual(worth(1) > worth(2), true, 'one minion fills more than two do')
            expectEqual(worth(2) > worth(3), true, 'and two more than three')
            expectEqual(worth(3) > 0, true, 'still worth something')
        },
    },
    {
        name: 'Card actions: two minions with two Govern fill two vampires, with one Govern only one plays it',
        run() {
            const plays = (hand: string[]) => {
                const turn = cardTurn({
                    minions: [
                        { disciplines: DOMINATE_SUPERIOR },
                        { disciplines: DOMINATE_SUPERIOR },
                    ],
                    hand,
                    uncontrolled: [
                        [8, 0],
                        [7, 0],
                    ],
                })
                const plan = planAs(turn.ring, turn.me, { cards: true })
                const cards = plan.actions.flatMap(action =>
                    action.option.action.type == MinionActionType.ActionCardFromHand ?
                        [action.option.action.card.oid]
                    :   [],
                )
                const targets = plan.actions.map(action => targetOf(action)?.oid)
                return { cards, targets }
            }
            const two = plays([GOVERN_ID, GOVERN_ID])
            expectEqual(new Set(two.cards).size, 2, 'two cards')
            expectEqual(new Set(two.targets).size, 2, 'two vampires')
            const one = plays([GOVERN_ID])
            expectEqual(one.cards.length, 1, 'one card, played once')
        },
    },
    {
        name: 'Card actions: a bleed card is worth its points, and played by a minion that would not bleed better',
        run() {
            const turn = cardTurn({
                minions: [{ disciplines: DOMINATE_INFERIOR }],
                hand: [GOVERN_ID],
            })
            const [govern] = cardValues(turn)
            expectClose(govern.value, 5, 'Govern adds 2 to the bleed')
            const plan = planAs(turn.ring, turn.me, { cards: true })
            expectEqual(targetOf(plan.actions[0]) instanceof Player, true, 'bleeds with the card')
        },
    },
    {
        name: 'Card actions: an action that my prey would block is worth less, the worth if unblocked is the same',
        run() {
            const fill = (blockers: MinionSetup[]) => {
                const turn = cardTurn({
                    minions: [{ disciplines: DOMINATE_SUPERIOR }],
                    hand: [GOVERN_ID],
                    blockers,
                    uncontrolled: [[8, 0]],
                })
                return cardValues(turn).find(
                    candidate => candidate.target == turn.me.vampiresInUncontrolled[0].oid,
                )
            }
            const open = fill([])
            const guarded = fill([{ intercept: 3, strength: 4 }])
            if (!open || !guarded) {
                throw new ScenarioFailure('The blood is not offered')
            }
            expectEqual(open.value > guarded.value, true, 'a blocker takes from it')
            expectEqual(open.unblocked > 0, true, 'it is worth something unblocked')
            expectClose(guarded.unblocked, open.unblocked, 'the worth if unblocked is the same')
        },
    },
    {
        name: 'Card actions: a retainer is an investment, worth more on a bearer that lasts',
        run() {
            const worth = (blood: number) => {
                const turn = cardTurn({
                    minions: [{ disciplines: ANIMALISM_INFERIOR, blood }],
                    hand: [MURDER_OF_CROWS_ID],
                    extra: [MURDER_OF_CROWS_ID],
                })
                turn.minions[0].minionAttrs.capacity = 8
                const [crows] = cardValues(turn)
                return crows
            }
            const healthy = worth(7)
            const weak = worth(2)
            expectEqual(healthy.name, 'Murder of Crows', 'the card')
            expectEqual(
                healthy.unblocked > weak.unblocked,
                true,
                'a bearer with blood keeps it longer',
            )
            expectEqual(healthy.unblocked > 0, true, 'it is worth its price')
        },
    },
    {
        name: 'Card actions: an intercept is worth the blocks it makes, the actions at the table it reaches and the lunge it stops',
        run() {
            const worth = (
                setup: Partial<CardTurnSetup>,
                profile: BotProfile = DEFAULT_PROFILE,
            ) => {
                const turn = cardTurn({
                    minions: [{ disciplines: ANIMALISM_INFERIOR, blood: 7 }],
                    hand: [RAVEN_SPY_ID],
                    extra: [RAVEN_SPY_ID],
                    ...setup,
                })
                const play = cardValues(turn, profile).find(
                    candidate => candidate.name == 'Raven Spy',
                )
                if (!play) {
                    throw new ScenarioFailure('Raven Spy is not offered')
                }
                return play.unblocked
            }
            const alone = worth({})
            const hunted = worth({ blockers: [{ bleed: 0 }] })
            expectEqual(hunted > alone, true, 'a hunt at the table has stealth 1: it blocks it')
            const noGuard = { ...DEFAULT_PROFILE, plan: { ...DEFAULT_PROFILE.plan, guard: 0 } }
            expectClose(
                worth({ blockers: [{ bleed: 0 }] }, noGuard),
                alone,
                'the guard is the whole gain',
            )

            // My predator holds stealth cards: an intercept of 1 stops the bleeds that stealth 1 would pass
            const stealthy: BotProfile = {
                ...noGuard,
                opponentPrior: {
                    ...noGuard.opponentPrior,
                    density: { ...noGuard.opponentPrior.density, stealth: 0.5 },
                },
            }
            const bleeders = [{ bleed: 2 }, { bleed: 2 }]
            const cards = [GOVERN_ID, GOVERN_ID, GOVERN_ID, GOVERN_ID]
            const backed = worth({ predator: bleeders, predatorHand: cards }, stealthy)
            const bare = worth({ predator: bleeders }, stealthy)
            expectEqual(backed > bare, true, 'the lunge it stops')
            expectClose(bare, alone, 'with no stealth behind the bleeds it stops none')
        },
    },
    {
        name: 'Card actions: what an equipment forbids counts against it, the card and the turns it serves set its price',
        run() {
            const worth = (hand: string[], profile: BotProfile = DEFAULT_PROFILE) => {
                const turn = cardTurn({
                    minions: [{ disciplines: { [Discipline.Potence]: DisciplineLevel.INFERIOR } }],
                    hand,
                    extra: [PRETERNATURAL_ID, TORN_SIGNPOST_ID],
                })
                const play = cardValues(turn, profile).find(
                    candidate => candidate.name == 'Preternatural Strength',
                )
                if (!play) {
                    throw new ScenarioFailure('Preternatural Strength is not offered')
                }
                return play.unblocked
            }
            const alone = worth([PRETERNATURAL_ID])
            expectEqual(
                worth([PRETERNATURAL_ID, TORN_SIGNPOST_ID]) < alone,
                true,
                'the Signpost is locked out',
            )
            const dear = { ...DEFAULT_PROFILE, plan: { ...DEFAULT_PROFILE.plan, spentCard: 3 } }
            expectEqual(worth([PRETERNATURAL_ID], dear) < alone, true, 'a dear card')
            const long = { ...DEFAULT_PROFILE, cards: { ...DEFAULT_PROFILE.cards, stay: 6 } }
            expectEqual(worth([PRETERNATURAL_ID], long) > alone, true, 'it serves longer')
        },
    },
    {
        name: 'Card actions: stealing pool is worth the pool of both Methuselahs, less the block it risks',
        run() {
            const steal = (blockers: MinionSetup[]) => {
                const turn = cardTurn({
                    minions: [
                        {
                            disciplines: { [Discipline.Celerity]: DisciplineLevel.INFERIOR },
                            blood: 5,
                        },
                    ],
                    hand: [LINE_BRAWL_ID],
                    blockers,
                    extra: [LINE_BRAWL_ID],
                })
                turn.minions[0].vampireAttrs.sect = 'Anarch'
                const play = cardValues(turn).find(candidate =>
                    candidate.level.includes('Celerity'),
                )
                if (!play) {
                    throw new ScenarioFailure('The steal is not offered')
                }
                return play
            }
            const open = steal([])
            const guarded = steal([{ intercept: 2, strength: 3 }])
            expectEqual(open.unblocked > 1, true, 'a point of pool taken and a point gained')
            expectEqual(open.value > guarded.value, true, 'the block costs')
        },
    },
]
