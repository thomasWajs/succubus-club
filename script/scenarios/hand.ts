import { Player } from '@/shared/model/Player.ts'
import { Vampire } from '@/shared/model/Card.ts'
import { Discipline, DisciplineLevel, TurnPhase, TurnSequence } from '@/shared/const/model.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import {
    BEHIND_YOU_ID,
    BLOOD_DOLL_ID,
    DEFLECTION_ID,
    ELDER_LIBRARY_ID,
    VILLEIN_ID,
} from '@/shared/cardImpl/cardIds.ts'
import { chooseThroughView, createPlayerView } from '@/shared/bot/playerView.ts'
import { getDecisionPoint } from '@/shared/bot/referee.ts'
import { UtilityAgent } from '@/shared/bot/agents/utilityAgent.ts'
import { BotOption, DecisionPoint } from '@/shared/bot/types.ts'
import { BotProfile, DEFAULT_PROFILE } from '@/shared/bot/utility/profile.ts'
import { assess } from '@/shared/bot/utility/assessment.ts'
import { HandEvaluator } from '@/shared/bot/utility/hand.ts'
import { Ring, MinionSetup, addMinions, createRing, holdOnly } from './assessment.ts'
import { sealLibrary } from './bounce.ts'
import {
    BARRENS_ID,
    CLOAK_ID,
    CONDITIONING_ID,
    LIFE_IN_THE_CITY_ID,
    WIDER_VIEW_ID,
    attemptBlock,
    createCatalogBleed,
} from './catalog.ts'
import { findAnyCard } from './attachment.ts'
import { LABYRINTH_DECK, LABYRINTH_ID } from './labyrinth.ts'
import { LENNY_ID, NOSFERATU_DECK } from './nosferatu.ts'
import { Scenario, ScenarioFailure, expectEqual, findCard } from './helpers.ts'

/**
 * The hand of the utility agent: which card is cycled in the discard phase, which one goes when the hand is too
 * big, what a draw is worth. Four Methuselahs unless said otherwise, the others with the minions the scenario gives
 * them, so that what each shows can be read.
 */

export const HAND_DECK = <DeckList>{
    ...NOSFERATU_DECK,
    [CLOAK_ID]: 4,
    [CONDITIONING_ID]: 4,
    [DEFLECTION_ID]: 3,
    [BEHIND_YOU_ID]: 3,
    [LIFE_IN_THE_CITY_ID]: 2,
    [VILLEIN_ID]: 2,
    [BLOOD_DOLL_ID]: 2,
    [ELDER_LIBRARY_ID]: 1,
    [BARRENS_ID]: 1,
    [WIDER_VIEW_ID]: 1,
    [LABYRINTH_ID]: 1,
}

export const BLEEDER: MinionSetup = {
    blood: 6,
    bleed: 2,
    disciplines: {
        [Discipline.Obfuscate]: DisciplineLevel.SUPERIOR,
        [Discipline.Dominate]: DisciplineLevel.SUPERIOR,
        [Discipline.Auspex]: DisciplineLevel.SUPERIOR,
    },
}

export const PLAIN: MinionSetup = { blood: 5, bleed: 1, intercept: 0 }

export type HandSetup = {
    hand: string[]
    ready?: MinionSetup[]
    prey?: MinionSetup[]
    predator?: MinionSetup[]
    // Cards in play, not on a vampire
    inPlay?: string[]
    players?: number
    pool?: number
    phase?: TurnPhase
    // Discard phase actions left: 0 once the free discard is used
    dpa?: number
    // What another Methuselah holds, by its place in the ring ( the hand and the cards in play )
    others?: { seat: number; hand: string[]; inPlay: string[] }[]
}

export type HandTurn = { ring: Ring; me: Player; vampires: Vampire[] }

export function handTurn(setup: HandSetup): HandTurn {
    const players = setup.players ?? 4
    const ring = createRing(Array.from({ length: players }, () => HAND_DECK))
    const { gameState } = ring
    const me = ring.players[0]
    const vampires = addMinions(ring, me, setup.ready ?? [BLEEDER])
    for (const vampire of vampires) {
        vampire.minionAttrs.capacity = 8
    }
    addMinions(ring, ring.players[1], setup.prey ?? [])
    addMinions(ring, ring.players[players - 1], setup.predator ?? [])
    const others = (player: Player) =>
        setup.others?.find(other => ring.players[other.seat] == player)
    for (const player of ring.players) {
        holdOnly(ring, player, player == me ? setup.hand : (others(player)?.hand ?? []))
    }
    for (const id of setup.inPlay ?? []) {
        gameState.moveCardToRegion(findCard(me, id), me.ready)
    }
    for (const player of ring.players) {
        for (const id of others(player)?.inPlay ?? []) {
            gameState.moveCardToRegion(findCard(player, id), player.ready)
        }
    }
    for (const player of ring.players) {
        sealLibrary(gameState, player)
    }
    me.pool = setup.pool ?? 20
    gameState.turnNumber = 5
    gameState.turnPhaseIndex = TurnSequence.indexOf(setup.phase ?? TurnPhase.Discard)
    gameState.turnResources.unlocked = true
    gameState.turnResources.dpa = setup.dpa ?? 1
    gameState.activePlayerIndex = gameState.competingPlayers.indexOf(me)
    return { ring, me, vampires }
}

export function decisionOf(turn: HandTurn): DecisionPoint {
    const decision = getDecisionPoint(turn.ring.gameState, turn.me)
    if (!decision) {
        throw new ScenarioFailure('No decision point')
    }
    return decision
}

// What the agent does in the discard phase: the card it throws away, or null when it ends the turn
function discardedOf(turn: HandTurn, profile: BotProfile = DEFAULT_PROFILE): string | null {
    const agent = new UtilityAgent(HAND_DECK, profile)
    const option = chooseThroughView(decisionOf(turn), agent)
    return nameOf(option)
}

export function nameOf(option: BotOption): string | null {
    switch (option.type) {
        case 'discard':
        case 'discardExcess':
            return option.card.name
        case 'lockEffect':
            return `${option.card.name}: ${option.discard.name}`
        case 'playModifier':
            return option.modifier.card.name
        case 'lockForAction':
            return `lock ${option.card.name}`
        default:
            return null
    }
}

// What each card of the hand is worth to keep, and a draw, for the message of a failure
export function worths(turn: HandTurn, profile: BotProfile = DEFAULT_PROFILE): string {
    const view = createPlayerView(turn.ring.gameState, turn.me)
    try {
        const assessment = assess(view.gameState, view.player, profile)
        const evaluator = new HandEvaluator(assessment, HAND_DECK, view.player)
        const keeps = view.player.hand.cards
            .map(card => `${card.name} ${(evaluator.keeps.get(card.oid) ?? 0).toFixed(2)}`)
            .join(', ')
        const first = view.player.hand.cards[0]
        const needs = Object.entries(evaluator.needs)
            .map(([kind, need]) => `${kind} ${need.rate.toFixed(2)}x${need.worth.toFixed(2)}`)
            .join(', ')
        const threats = Object.values(assessment.threat)
            .map(threat => `bleed ${threat.bleed.toFixed(2)} combat ${threat.combat.toFixed(2)}`)
            .join(' | ')
        return `${keeps}; draw ${first ? evaluator.draw(first.oid).toFixed(2) : '-'}; ${needs}; ${threats}`
    } finally {
        view.dispose()
    }
}

// What keeping the first card of this name is worth
function keepOf(turn: HandTurn, name: string): number {
    const view = createPlayerView(turn.ring.gameState, turn.me)
    try {
        const evaluator = new HandEvaluator(
            assess(view.gameState, view.player),
            HAND_DECK,
            view.player,
        )
        const card = view.player.hand.cards.find(candidate => candidate.name == name)
        if (!card) {
            throw new ScenarioFailure(`${name} is not in the hand`)
        }
        return evaluator.keeps.get(card.oid) ?? 0
    } finally {
        view.dispose()
    }
}

// What keeping each card of this name is worth, in the order of the hand
function keepsOf(turn: HandTurn, name: string): number[] {
    const view = createPlayerView(turn.ring.gameState, turn.me)
    try {
        const evaluator = new HandEvaluator(
            assess(view.gameState, view.player),
            HAND_DECK,
            view.player,
        )
        return view.player.hand.cards
            .filter(card => card.name == name)
            .map(card => evaluator.keeps.get(card.oid) ?? 0)
    } finally {
        view.dispose()
    }
}

function expectDiscard(turn: HandTurn, expected: string | null, what: string): void {
    const actual = discardedOf(turn)
    if (actual != expected) {
        throw new ScenarioFailure(
            `${what}: expected ${expected ?? 'no discard'}, got ${actual ?? 'no discard'} (${worths(turn)})`,
        )
    }
}

export const STEALTH_HAND = [
    CLOAK_ID,
    CLOAK_ID,
    CLOAK_ID,
    CONDITIONING_ID,
    CONDITIONING_ID,
    DEFLECTION_ID,
]

export const HAND_SCENARIOS: Scenario[] = [
    {
        name: 'Hand: a jammed stealth hand against a prey with no intercept cycles a stealth card',
        run() {
            const turn = handTurn({
                hand: STEALTH_HAND,
                prey: [PLAIN, PLAIN, PLAIN],
                predator: [PLAIN, PLAIN, PLAIN],
            })
            expectDiscard(turn, 'Cloak the Gathering', 'the weakest')
        },
    },
    {
        name: 'Hand: the same stealth is kept against a prey that has the intercept to block',
        run() {
            const blocker: MinionSetup = { blood: 5, bleed: 0, intercept: 2 }
            const turn = handTurn({
                hand: STEALTH_HAND,
                prey: [blocker, blocker, blocker],
                predator: [PLAIN, PLAIN, PLAIN],
            })
            const discarded = discardedOf(turn)
            if (discarded == 'Cloak the Gathering') {
                throw new ScenarioFailure(`A stealth card goes (${worths(turn)})`)
            }
            const keeps = keepsOf(turn, 'Cloak the Gathering')
            if (keeps.some(keep => !(keep > 0))) {
                throw new ScenarioFailure(
                    `Three stealth cards are needed to beat 2 intercept (${keeps.join()})`,
                )
            }
        },
    },
    {
        name: 'Hand: the only bounce card is kept although it is one card of a hand with few roles',
        run() {
            const turn = handTurn({
                hand: [CLOAK_ID, CLOAK_ID, CLOAK_ID, DEFLECTION_ID],
                prey: [PLAIN, PLAIN, PLAIN],
                predator: [{ ...BLEEDER }, { ...BLEEDER }, { ...BLEEDER }],
            })
            const discarded = discardedOf(turn)
            if (discarded == 'Deflection') {
                throw new ScenarioFailure(`The bounce goes (${worths(turn)})`)
            }
        },
    },
    {
        name: 'Hand: a bounce is worth most against a predator that bleeds hard, a hedge with no evidence, least against one that hardly bleeds',
        run() {
            const hand = [DEFLECTION_ID, CONDITIONING_ID, CONDITIONING_ID, VILLEIN_ID]
            const keeps = [
                { predator: [BLEEDER, BLEEDER, BLEEDER] },
                {},
                { predator: [PLAIN, PLAIN, PLAIN] },
            ].map(table =>
                keepOf(handTurn({ hand, prey: [PLAIN, PLAIN, PLAIN], ...table }), 'Deflection'),
            )
            if (!(keeps[0] > keeps[1] && keeps[1] > keeps[2] && keeps[2] > 0)) {
                throw new ScenarioFailure(
                    `Expected hard > no evidence > hardly > 0, got ${keeps.map(keep => keep.toFixed(2)).join(' / ')}`,
                )
            }
        },
    },
    {
        name: 'Hand: with two Methuselahs left every bounce card is dead and goes',
        run() {
            const turn = handTurn({
                players: 2,
                hand: [DEFLECTION_ID, CONDITIONING_ID, CONDITIONING_ID, VILLEIN_ID],
                prey: [BLEEDER, BLEEDER, BLEEDER],
            })
            expectDiscard(turn, 'Deflection', 'the dead bounce')
        },
    },
    {
        name: 'Hand: a dodge goes when the neighbours show minions that cannot hurt mine, and stays when they show nothing',
        run() {
            const hand = [BEHIND_YOU_ID, CONDITIONING_ID, CONDITIONING_ID, VILLEIN_ID]
            const weak: MinionSetup = { blood: 5, bleed: 1, strength: 1 }
            const safe = handTurn({
                players: 2,
                ready: [{ ...BLEEDER, strength: 6 }],
                hand,
                prey: [weak, weak, weak],
            })
            expectDiscard(safe, 'Behind You!', 'no neighbour fights')
            const unknown = handTurn({
                players: 2,
                ready: [{ ...BLEEDER, strength: 6 }],
                hand,
            })
            if (keepOf(unknown, 'Behind You!') <= keepOf(safe, 'Behind You!')) {
                throw new ScenarioFailure(
                    `The dodge is not worth more with no evidence (${worths(unknown)})`,
                )
            }
        },
    },
    {
        name: 'Hand: the third master card goes, the first two wait for the master phases',
        run() {
            const turn = handTurn({
                hand: [VILLEIN_ID, VILLEIN_ID, BLOOD_DOLL_ID, CONDITIONING_ID, CONDITIONING_ID],
                prey: [PLAIN, PLAIN, PLAIN],
                predator: [PLAIN, PLAIN, PLAIN],
            })
            const discarded = discardedOf(turn)
            if (discarded != 'Villein' && discarded != 'Blood Doll') {
                throw new ScenarioFailure(
                    `Expected a master to go, got ${discarded} (${worths(turn)})`,
                )
            }
        },
    },
    {
        name: 'Hand: a master that no play pays yet is held for the vampire that needs it, one that does nothing goes',
        run() {
            const turn = handTurn({
                pool: 1,
                hand: [ELDER_LIBRARY_ID, WIDER_VIEW_ID, CONDITIONING_ID, CONDITIONING_ID],
                prey: [PLAIN, PLAIN, PLAIN],
                predator: [PLAIN, PLAIN, PLAIN],
            })
            expectDiscard(turn, 'Wider View', 'the master with no use')
            const worth = keepOf(turn, 'Elder Library')
            if (worth <= 0.5) {
                throw new ScenarioFailure(`Elder Library is not held (${worth.toFixed(2)})`)
            }
        },
    },
    {
        name: 'Hand: the free discard goes first, the Barrens waits for a later window',
        run() {
            const setup = {
                hand: STEALTH_HAND,
                prey: [PLAIN, PLAIN, PLAIN],
                predator: [PLAIN, PLAIN, PLAIN],
                inPlay: [BARRENS_ID],
            }
            const free = discardedOf(handTurn(setup))
            if (!free || free.includes(': ')) {
                throw new ScenarioFailure(`Expected the free discard first, got ${free}`)
            }
            const waits = discardedOf(handTurn({ ...setup, dpa: 0 }))
            if (waits !== null) {
                throw new ScenarioFailure(
                    `Expected the Barrens to wait for the end of the turn of my predator, got ${waits}`,
                )
            }
        },
    },
    {
        name: 'Hand: a hand over its size loses its weakest card',
        run() {
            const hand = [
                VILLEIN_ID,
                CONDITIONING_ID,
                CONDITIONING_ID,
                DEFLECTION_ID,
                DEFLECTION_ID,
                CLOAK_ID,
                CLOAK_ID,
                CLOAK_ID,
            ]
            for (const order of [hand, hand.toReversed()]) {
                const turn = handTurn({
                    hand: order,
                    prey: [PLAIN, PLAIN, PLAIN],
                    predator: [PLAIN, PLAIN, PLAIN],
                    phase: TurnPhase.Master,
                })
                const discarded = discardedOf(turn)
                expectEqual(
                    discarded,
                    'Cloak the Gathering',
                    `the card that goes (${worths(turn)})`,
                )
            }
        },
    },
    {
        name: 'Hand: a stealth card the hand has too many of is played before the Labyrinth is locked, a single one is not',
        run() {
            const deck = <DeckList>{ ...LABYRINTH_DECK, [CLOAK_ID]: 4 }
            const played = (cards: string[]) => {
                const game = createCatalogBleed({
                    deck,
                    discipline: Discipline.Presence,
                    level: DisciplineLevel.SUPERIOR,
                    cards,
                    bleederId: LENNY_ID,
                })
                game.gameState.moveCardToRegion(
                    findAnyCard(game.bleeder, LABYRINTH_ID),
                    game.bleeder.ready,
                )
                attemptBlock(game, true)
                const decision = getDecisionPoint(game.gameState, game.bleeder)
                if (!decision) {
                    throw new ScenarioFailure('The acting player has no decision')
                }
                return nameOf(chooseThroughView(decision, new UtilityAgent(deck)))
            }
            expectEqual(
                played([CLOAK_ID, CLOAK_ID, CLOAK_ID, CLOAK_ID]),
                'Cloak the Gathering',
                'jammed',
            )
            expectEqual(played([CLOAK_ID]), 'lock Labyrinth, The', 'a single card')
        },
    },
    {
        name: 'Hand: with no card left in the library nothing is cycled',
        run() {
            const turn = handTurn({
                hand: STEALTH_HAND,
                prey: [PLAIN, PLAIN, PLAIN],
                predator: [PLAIN, PLAIN, PLAIN],
            })
            const agent = new UtilityAgent({
                [CLOAK_ID]: 3,
                [CONDITIONING_ID]: 2,
                [DEFLECTION_ID]: 1,
            })
            const option = chooseThroughView(decisionOf(turn), agent)
            expectEqual(nameOf(option), null, 'a deck that is all in the hand')

            const seen = handTurn({
                hand: STEALTH_HAND,
                prey: [PLAIN, PLAIN, PLAIN],
                predator: [PLAIN, PLAIN, PLAIN],
            })
            const copies = seen.me.removed.cards.filter(card => card.krcgId == VILLEIN_ID)
            for (const copy of copies.slice(0, 2)) {
                seen.ring.gameState.moveCardToRegion(copy, seen.me.ashHeap)
            }
            const rest = new UtilityAgent({
                [CLOAK_ID]: 3,
                [CONDITIONING_ID]: 2,
                [DEFLECTION_ID]: 1,
                [VILLEIN_ID]: 2,
            })
            expectEqual(
                nameOf(chooseThroughView(decisionOf(seen), rest)),
                null,
                'the copies of a card on the ash heap are not left in the library',
            )
        },
    },
]
