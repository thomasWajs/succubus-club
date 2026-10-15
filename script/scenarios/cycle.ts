import { Player } from '@/shared/model/Player.ts'
import { Discipline, DisciplineLevel, TurnPhase, TurnSequence } from '@/shared/const/model.ts'
import { chooseThroughView, createPlayerView } from '@/shared/bot/playerView.ts'
import { applyOption, getDecidingPlayer, getDecisionPoint } from '@/shared/bot/referee.ts'
import { UtilityAgent } from '@/shared/bot/agents/utilityAgent.ts'
import { BotOption, DecisionKind, DecisionPoint, optionsOfType } from '@/shared/bot/types.ts'
import { findOption } from '@/shared/bot/helpers.ts'
import { BotProfile, DEFAULT_PROFILE } from '@/shared/bot/utility/profile.ts'
import { HandEvaluator } from '@/shared/bot/utility/hand.ts'
import { cycleWorthOf, windowsOf } from '@/shared/bot/utility/cycle.ts'
import { Assessment, assess } from '@/shared/bot/utility/assessment.ts'
import { assessAs } from './assessment.ts'
import {
    BARRENS_ID,
    CLOAK_ID,
    WIDER_VIEW_ID,
    CONDITIONING_ID,
    createCatalogBleed,
    passUntilDecides,
} from './catalog.ts'
import { BEHIND_YOU_ID, DEFLECTION_ID } from '@/shared/cardImpl/cardIds.ts'
import { emptyHand, sealLibrary } from './bounce.ts'
import { getCombatDecision } from './combatCards.ts'
import {
    Scenario,
    ScenarioFailure,
    createFight,
    expectEqual,
    findCard,
    giveCard,
    readyVampire,
} from './helpers.ts'
import {
    HAND_DECK,
    HandSetup,
    HandTurn,
    PLAIN,
    STEALTH_HAND,
    decisionOf,
    handTurn,
    nameOf,
} from './hand.ts'

/**
 * The charge of a card in play that throws a card away ( The Barrens ): the windows it is offered in, the end of
 * the turn of another Methuselah, and the moment the utility agent picks. Four Methuselahs, the others with the
 * minions the scenario gives them.
 */

const BARRENS_TURN: HandSetup = {
    hand: STEALTH_HAND,
    prey: [PLAIN, PLAIN, PLAIN],
    predator: [PLAIN, PLAIN, PLAIN],
    inPlay: [BARRENS_ID],
}

// The turn of another Methuselah is over and has not passed: I am the one that is asked
function endOfTurnOf(turn: HandTurn, owner: Player): DecisionPoint {
    const { gameState } = turn.ring
    gameState.activePlayerIndex = gameState.competingPlayers.indexOf(owner)
    gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Discard)
    gameState.turnEndWaiting = [turn.me.oid]
    const decision = decisionOf(turn)
    expectEqual(decision.kind, DecisionKind.TurnEnd, 'the decision at the end of the turn')
    return decision
}

function chooseOf(
    decision: DecisionPoint,
    deck = HAND_DECK,
    profile: BotProfile = DEFAULT_PROFILE,
): BotOption {
    return chooseThroughView(decision, new UtilityAgent(deck, profile))
}

const predatorOf = (turn: HandTurn): Player => turn.ring.players[turn.ring.players.length - 1]

export const CYCLE_SCENARIOS: Scenario[] = [
    {
        name: 'Cycle: the Barrens throws the weakest card at the end of the turn of my predator, its last window',
        run() {
            const turn = handTurn(BARRENS_TURN)
            const option = chooseOf(endOfTurnOf(turn, predatorOf(turn)))
            const name = nameOf(option)
            if (!name?.startsWith('Barrens, The: Cloak')) {
                throw new ScenarioFailure(`Expected a Cloak thrown, got ${name}`)
            }
        },
    },
    {
        name: 'Cycle: the Barrens waits at the end of the turn of my prey, my predator has one to come',
        run() {
            const turn = handTurn(BARRENS_TURN)
            const option = chooseOf(endOfTurnOf(turn, turn.ring.players[1]))
            expectEqual(option.type, 'passTurnEnd', 'the end of the turn of my prey')
        },
    },
    {
        name: 'Cycle: with only a human left to play after me my own discard phase is the last window',
        run() {
            const turn = handTurn({ ...BARRENS_TURN, players: 2, predator: [], dpa: 0 })
            const human = predatorOf(turn) as { permId: string }
            human.permId = 'human'
            const name = nameOf(chooseOf(decisionOf(turn)))
            if (!name?.startsWith('Barrens, The: ')) {
                throw new ScenarioFailure(`Expected a card thrown, got ${name}`)
            }
            const first = handTurn({ ...BARRENS_TURN, players: 2, predator: [] })
            const other = predatorOf(first) as { permId: string }
            other.permId = 'human'
            const free = nameOf(chooseOf(decisionOf(first)))
            if (!free || free.includes(': ')) {
                throw new ScenarioFailure(`Expected the free discard first, got ${free}`)
            }
        },
    },
    {
        name: 'Cycle: nothing is thrown when no card of the library would add to the hand',
        run() {
            const turn = handTurn(BARRENS_TURN)
            const deck = {
                [CLOAK_ID]: 3,
                [CONDITIONING_ID]: 2,
                [DEFLECTION_ID]: 1,
                [BARRENS_ID]: 1,
            }
            const option = chooseOf(endOfTurnOf(turn, predatorOf(turn)), deck)
            expectEqual(option.type, 'passTurnEnd', 'a deck that is all seen')
        },
    },
    {
        name: 'Cycle: a bleed against me is a window used when no card of my hand answers it',
        run() {
            const answers = (cards: string[]) => {
                const bleed = createCatalogBleed({
                    discipline: Discipline.Dominate,
                    level: DisciplineLevel.SUPERIOR,
                    cards: [],
                    deck: HAND_DECK,
                    preyCards: [BARRENS_ID, ...cards],
                    preyDiscipline: [Discipline.Dominate, DisciplineLevel.SUPERIOR],
                })
                const { gameState, bled, bleeder } = bleed
                gameState.moveCardToRegion(findCard(bled, BARRENS_ID), bled.ready)
                bleed.bleeding.minionAttrs.bleed = 3
                for (let extra = 0; extra < 2; extra++) {
                    readyVampire(gameState, bleeder, 5).minionAttrs.bleed = 3
                }
                const decision = passUntilDecides(gameState, bled)
                return nameOf(chooseOf(decision))
            }
            const open = answers([WIDER_VIEW_ID, CLOAK_ID])
            if (!open?.startsWith('Barrens, The: ')) {
                throw new ScenarioFailure(
                    `Expected the Barrens used against the bleed, got ${open}`,
                )
            }
            const held = answers([DEFLECTION_ID, WIDER_VIEW_ID, CLOAK_ID])
            if (held?.startsWith('Barrens, The: ')) {
                throw new ScenarioFailure(`The Barrens is used with a bounce in hand: ${held}`)
            }
        },
    },
    {
        name: 'Cycle: a fight I am in is a window used when no card of my hand answers it',
        run() {
            const answers = (cards: string[]) => {
                const fight = createFight(5, 5, HAND_DECK)
                const { gameState, actingPlayer: me, acting } = fight
                gameState.activePlayerIndex = gameState.competingPlayers.indexOf(me)
                gameState.moveCardToRegion(findCard(me, BARRENS_ID), me.ready)
                for (const discipline of [
                    Discipline.Obfuscate,
                    Discipline.Dominate,
                    Discipline.Auspex,
                ]) {
                    acting.minionAttrs.disciplines[discipline] = DisciplineLevel.SUPERIOR
                }
                emptyHand(gameState, me)
                for (const id of cards) {
                    giveCard(gameState, me, id)
                }
                sealLibrary(gameState, me)
                const deciding = getDecidingPlayer(gameState)
                if (deciding != me) {
                    throw new ScenarioFailure('The defender has not the impulse')
                }
                // A fight is worth little to a card of the hand at the default weights: it is made to cost a lot
                const deadly = { ...DEFAULT_PROFILE, hand: { ...DEFAULT_PROFILE.hand, cover: 10 } }
                return nameOf(chooseOf(getCombatDecision(fight, me), HAND_DECK, deadly))
            }
            const open = answers([WIDER_VIEW_ID, CLOAK_ID])
            if (!open?.startsWith('Barrens, The: ')) {
                throw new ScenarioFailure(`Expected the Barrens used in the fight, got ${open}`)
            }
            const held = answers([BEHIND_YOU_ID, WIDER_VIEW_ID, CLOAK_ID])
            if (held?.startsWith('Barrens, The: ')) {
                throw new ScenarioFailure(`The Barrens is used with a combat card in hand: ${held}`)
            }
        },
    },
    {
        name: 'Cycle: the windows to come follow the turn: my phases, the turn of each Methuselah, a bleed of my predator',
        run() {
            const windowsAt = (setup: HandSetup, change?: (turn: HandTurn) => void) => {
                const turn = handTurn(setup)
                change?.(turn)
                const decision = decisionOf(turn)
                const assessment = assessAs(turn.ring, turn.me)
                return windowsOf(decision, assessment, HAND_DECK).map(window => window.kind)
            }
            const rest = ['plain', 'plain', 'bleed', 'plain']
            expectEqual(
                windowsAt({ ...BARRENS_TURN, phase: TurnPhase.Discard }).join(),
                rest.join(),
                'the discard phase',
            )
            expectEqual(
                windowsAt({ ...BARRENS_TURN, phase: TurnPhase.Minion }).join(),
                ['fight', 'plain', 'plain', ...rest].join(),
                'the minion phase',
            )
            expectEqual(
                windowsAt({ ...BARRENS_TURN, phase: TurnPhase.Master }).join(),
                ['plain', 'fight', 'plain', 'plain', ...rest].join(),
                'the master phase',
            )
            expectEqual(
                windowsAt(BARRENS_TURN, turn => {
                    const { gameState } = turn.ring
                    gameState.activePlayerIndex = 1
                    gameState.turnEndWaiting = [turn.me.oid]
                }).join(),
                ['plain', 'bleed', 'plain'].join(),
                'the end of the turn of my prey',
            )
            expectEqual(
                windowsAt(BARRENS_TURN, turn => {
                    const { gameState } = turn.ring
                    gameState.activePlayerIndex = turn.ring.players.length - 1
                    gameState.turnEndWaiting = [turn.me.oid]
                }).join(),
                '',
                'the end of the turn of my predator',
            )
        },
    },
    {
        name: 'Cycle: a bleed is likely against a predator that shows nothing, a fight is half a chance a turn with one neighbour',
        run() {
            const turn = handTurn({
                ...BARRENS_TURN,
                players: 2,
                predator: [],
                phase: TurnPhase.Minion,
            })
            const windows = windowsOf(decisionOf(turn), assessAs(turn.ring, turn.me), HAND_DECK)
            const fight = windows.find(window => window.kind == 'fight')
            const bleed = windows.find(window => window.kind == 'bleed')
            expectEqual(fight?.chance, 0.5, 'the chance of a fight')
            if (!bleed || !(bleed.chance > 0.5 && bleed.chance < 1)) {
                throw new ScenarioFailure(
                    `Expected a bleed more likely than not, got ${bleed?.chance}`,
                )
            }
        },
    },
    {
        name: 'Cycle: a margin on the gain keeps the card',
        run() {
            const turn = handTurn(BARRENS_TURN)
            const careful = {
                ...DEFAULT_PROFILE,
                hand: { ...DEFAULT_PROFILE.hand, chargeMargin: 10 },
            }
            const option = chooseOf(endOfTurnOf(turn, predatorOf(turn)), HAND_DECK, careful)
            expectEqual(option.type, 'passTurnEnd', 'a gain below the margin')
        },
    },
    {
        name: 'Cycle: a draw that serves the window is worth more than a plain draw, unless the hand already serves it',
        run() {
            const deadlyProfile = {
                ...DEFAULT_PROFILE,
                hand: { ...DEFAULT_PROFILE.hand, cover: 10 },
            }
            const drawsFor = (hand: string[], profile: BotProfile = deadlyProfile) => {
                const turn = handTurn({ hand, inPlay: [] })
                const view = createPlayerView(turn.ring.gameState, turn.me)
                try {
                    const evaluator = new HandEvaluator(
                        assessAs(turn.ring, turn.me, profile),
                        HAND_DECK,
                        view.player,
                    )
                    const [first] = view.player.hand.cards
                    return {
                        plain: evaluator.draw(first.oid),
                        fight: evaluator.drawFor(first.oid, ['combat']),
                    }
                } finally {
                    view.dispose()
                }
            }
            const alone = drawsFor([BEHIND_YOU_ID])
            if (!(alone.fight > alone.plain)) {
                throw new ScenarioFailure(
                    `A fight does not ask more: ${alone.fight} against ${alone.plain}`,
                )
            }
            const served = drawsFor([BEHIND_YOU_ID, BEHIND_YOU_ID])
            expectEqual(served.fight, served.plain, 'a hand that serves the fight already')
            const plainProfile = drawsFor([BEHIND_YOU_ID], DEFAULT_PROFILE)
            if (!(plainProfile.fight >= plainProfile.plain)) {
                throw new ScenarioFailure(
                    `A window never asks less than a plain draw: ${plainProfile.fight} against ${plainProfile.plain}`,
                )
            }
        },
    },
    {
        name: 'Cycle: the end of the turn asks the bots that hold a card to use, not the active one nor a human',
        run() {
            const holds = { hand: [CLOAK_ID], inPlay: [BARRENS_ID] }
            const turn = handTurn({
                ...BARRENS_TURN,
                others: [
                    { seat: 3, ...holds },
                    { seat: 1, ...holds },
                ],
            })
            const { gameState } = turn.ring
            const human = turn.ring.players[1] as { permId: string }
            human.permId = 'human'
            const predator = predatorOf(turn)
            gameState.activePlayerIndex = gameState.competingPlayers.indexOf(predator)
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Discard)
            const ending = getDecisionPoint(gameState, predator)
            if (!ending) {
                throw new ScenarioFailure('The active bot has no decision')
            }
            applyOption(ending, findOption(ending.options, 'endTurn'))
            expectEqual(
                (gameState.turnEndWaiting ?? []).join(),
                [turn.me.oid].join(),
                'who waits at the end of the turn',
            )
        },
    },
    {
        name: 'Cycle: a charge that gains nothing is worth nothing',
        run() {
            const turn = handTurn({
                ...BARRENS_TURN,
                hand: [BARRENS_ID, ...STEALTH_HAND],
                inPlay: [],
                phase: TurnPhase.Master,
            })
            const deck = {
                [CLOAK_ID]: 3,
                [CONDITIONING_ID]: 2,
                [DEFLECTION_ID]: 1,
                [BARRENS_ID]: 1,
            }
            const worth = cycleWorthOf(decisionOf(turn), assessAs(turn.ring, turn.me), deck)
            expectEqual(worth, 0, 'the worth of a charge when nothing is left to draw')
        },
    },
    {
        name: 'Cycle: the windows of a bleed against me leave out the bleed, those of a fight on the turn of my predator keep it',
        run() {
            const bleed = createCatalogBleed({
                discipline: Discipline.Dominate,
                level: DisciplineLevel.SUPERIOR,
                cards: [],
                deck: HAND_DECK,
                preyCards: [BARRENS_ID, CLOAK_ID],
            })
            bleed.gameState.moveCardToRegion(findCard(bleed.bled, BARRENS_ID), bleed.bled.ready)
            const decision = passUntilDecides(bleed.gameState, bleed.bled)
            const view = createPlayerView(bleed.gameState, bleed.bled)
            try {
                const kinds = (turn: DecisionPoint, assessment: Assessment) =>
                    windowsOf(turn, assessment, HAND_DECK)
                        .map(window => window.kind)
                        .join()
                const assessment = assess(view.gameState, view.player, DEFAULT_PROFILE)
                expectEqual(kinds(decision, assessment), 'plain', 'a bleed against me')
            } finally {
                view.dispose()
            }

            const fight = createFight(5, 5, HAND_DECK)
            const { gameState, defendingPlayer: me } = fight
            gameState.activePlayerIndex = gameState.competingPlayers.indexOf(fight.actingPlayer)
            if (gameState.combat) {
                gameState.combat.impulsePlayer = me
            }
            const turn = getCombatDecision(fight, me)
            const seen = createPlayerView(gameState, me)
            try {
                const assessment = assess(seen.gameState, seen.player, DEFAULT_PROFILE)
                expectEqual(
                    windowsOf(turn, assessment, HAND_DECK)
                        .map(window => window.kind)
                        .join(),
                    'bleed,plain',
                    'a fight on the turn of my predator',
                )
            } finally {
                seen.dispose()
            }
        },
    },
    {
        name: 'Cycle: a Barrens in hand is played when cycling pays, and held when nothing is left to draw',
        run() {
            const played = (deck: Record<string, number>) => {
                const turn = handTurn({
                    ...BARRENS_TURN,
                    hand: [BARRENS_ID, ...STEALTH_HAND],
                    inPlay: [],
                    phase: TurnPhase.Master,
                })
                const option = chooseThroughView(decisionOf(turn), new UtilityAgent(deck))
                return option.type == 'playMaster' ? option.card.name : null
            }
            expectEqual(played(HAND_DECK), 'Barrens, The', 'a deck with cards to draw')
            for (const hand of [
                [BARRENS_ID, ...STEALTH_HAND],
                [...STEALTH_HAND, BARRENS_ID],
            ]) {
                const kept = handTurn({ ...BARRENS_TURN, hand, inPlay: [] })
                const thrown = nameOf(chooseOf(decisionOf(kept)))
                if (!thrown || thrown == 'Barrens, The') {
                    throw new ScenarioFailure(`The Barrens in hand is thrown away: ${thrown}`)
                }
            }
            expectEqual(
                played({
                    [CLOAK_ID]: 3,
                    [CONDITIONING_ID]: 2,
                    [DEFLECTION_ID]: 1,
                    [BARRENS_ID]: 1,
                }),
                null,
                'a deck that is all seen',
            )
        },
    },
    {
        name: 'Cycle: the lock effect is offered in every phase of my turn, declining is normal',
        run() {
            const phases = [
                TurnPhase.Unlock,
                TurnPhase.Master,
                TurnPhase.Minion,
                TurnPhase.Influence,
                TurnPhase.Discard,
            ]
            for (const phase of phases) {
                const turn = handTurn({ ...BARRENS_TURN, phase })
                const decision = decisionOf(turn)
                expectEqual(
                    optionsOfType(decision.options, 'lockEffect').length > 0,
                    true,
                    `the Barrens in the ${phase} phase (${decision.kind})`,
                )
            }
        },
    },
    {
        name: 'Cycle: the end of the turn waits for the bots that hold a card to use, then the turn passes',
        run() {
            const turn = handTurn({ ...BARRENS_TURN, hand: STEALTH_HAND })
            const { gameState } = turn.ring
            const predator = predatorOf(turn)
            gameState.activePlayerIndex = gameState.competingPlayers.indexOf(predator)
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Discard)
            const before = gameState.turnNumber
            const ending = getDecisionPoint(gameState, predator)
            if (!ending) {
                throw new ScenarioFailure('The active bot has no decision')
            }
            applyOption(ending, findOption(ending.options, 'endTurn'))
            expectEqual(gameState.turnNumber, before, 'the turn waits for the Barrens')
            expectEqual(getDecidingPlayer(gameState), turn.me, 'who is asked')
            const asked = decisionOf(turn)
            applyOption(asked, findOption(asked.options, 'passTurnEnd'))
            expectEqual(getDecidingPlayer(gameState), predator, 'who ends the turn')
            const last = getDecisionPoint(gameState, predator)
            if (!last) {
                throw new ScenarioFailure('The active bot has no decision')
            }
            applyOption(last, findOption(last.options, 'endTurn'))
            expectEqual(gameState.turnNumber, before + 1, 'the turn passed')
            expectEqual(gameState.turnEndWaiting, null, 'the end of the turn is closed')
        },
    },
    {
        name: 'Cycle: a Methuselah with nothing to use does not stop the turn from passing',
        run() {
            const turn = handTurn({ ...BARRENS_TURN, inPlay: [] })
            const { gameState } = turn.ring
            const predator = predatorOf(turn)
            gameState.activePlayerIndex = gameState.competingPlayers.indexOf(predator)
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Discard)
            const before = gameState.turnNumber
            const ending = getDecisionPoint(gameState, predator)
            if (!ending) {
                throw new ScenarioFailure('The active bot has no decision')
            }
            applyOption(ending, findOption(ending.options, 'endTurn'))
            expectEqual(gameState.turnNumber, before + 1, 'the turn passed at once')
        },
    },
    {
        name: 'Cycle: the Barrens used at the end of the turn throws the card and locks',
        run() {
            const turn = handTurn(BARRENS_TURN)
            const decision = endOfTurnOf(turn, predatorOf(turn))
            const use = optionsOfType(decision.options, 'lockEffect')[0]
            applyOption(decision, use)
            expectEqual(turn.me.ashHeap.cards.includes(use.discard), true, 'the card is thrown')
            expectEqual(use.card.isLocked, true, 'the Barrens is locked')
            expectEqual(
                getDecidingPlayer(turn.ring.gameState),
                predatorOf(turn),
                'nobody is asked again',
            )
        },
    },
]
