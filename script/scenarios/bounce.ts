import { Vampire, LibraryCard } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { botMutations } from '@/shared/state/botMutations.ts'
import { MinionActionType } from '@/shared/types/state.ts'
import { DisciplineLevel, TurnSequence, TurnPhase, Discipline } from '@/shared/const/model.ts'
import { DEFLECTION_ID, GOVERN_ID } from '@/shared/cardImpl/cardIds.ts'
import { findOption } from '@/shared/bot/helpers.ts'
import { GovernAgent } from '../governAgent.ts'
import { createHeadlessGame } from '../harness.ts'
import { GovernDeck } from '@/shared/bot/decks.ts'
import { getDecisionPoint, applyOption, getDecidingPlayer } from '@/shared/bot/referee.ts'
import { stepBot } from '@/shared/bot/driver.ts'
import { optionsOfType, BotOption, DecisionPoint } from '@/shared/bot/types.ts'
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

/**
 * Bounce cards (Deflection): the bled player declines to block, then changes the target of
 * the bleed. The new target gets a fresh chance to block. Also the Govern agent's behaviour
 * when bled, and its habit of keeping the youngest minion unlocked.
 */

type Bounce = {
    gameState: GameState
    bleeder: Player
    bled: Player
    // The bled player's prey: the only valid new target of a bounce (3 players)
    third: Player | undefined
    reactor: Vampire
    deflection: LibraryCard
}

export function emptyHand(gameState: GameState, player: Player): void {
    for (const card of [...player.hand.cards]) {
        gameState.moveCardToRegion(card, player.library)
    }
}

// A bot always draws back up to its hand size: a scenario that wants a controlled hand takes
// the rest of the library out of reach once the cards it needs are in hand
export function sealLibrary(gameState: GameState, player: Player): void {
    for (const card of [...player.library.cards]) {
        gameState.moveCardToRegion(card, player.removed)
    }
}

// The first player declares a bleed (or a hunt) against its prey. The prey has one ready
// vampire with the Dominate level, and Deflection as its only card.
export function createBounce(
    level: DisciplineLevel,
    nbPlayers = 3,
    actionType = MinionActionType.Bleed,
    copies = 1,
): Bounce {
    const { gameState, players } = createHeadlessGame(
        Array.from({ length: nbPlayers }, () => GovernDeck),
    )
    createdGames.push(gameState)
    const bleeder = gameState.activePlayer
    const bled = bleeder?.prey
    if (!bleeder || !bled || !players.includes(bleeder)) {
        throw new ScenarioFailure('No active player or no prey')
    }
    const third = nbPlayers >= 3 ? bled.prey : undefined
    for (const player of players) {
        emptyHand(gameState, player)
    }
    gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Minion)
    gameState.turnResources.unlocked = true

    // The bleeder is the stronger one: the Govern agent would lose the combat of a block, so it
    // does not block and falls back on Deflection
    const bleeding = readyVampire(gameState, bleeder, 5)
    bleeding.minionAttrs.strength = 2
    const reactor = readyVampire(gameState, bled, 3)
    if (third) {
        readyVampire(gameState, third, 3)
    }
    reactor.minionAttrs.disciplines[Discipline.Dominate] = level
    const deflection = giveCard(gameState, bled, DEFLECTION_ID)
    for (let copy = 1; copy < copies; copy++) {
        giveCard(gameState, bled, DEFLECTION_ID)
    }
    for (const player of players) {
        sealLibrary(gameState, player)
    }

    const decision = getDecisionPoint(gameState, bleeder)
    const declare =
        decision ?
            optionsOfType(decision.options, 'declareAction').find(
                option =>
                    option.action.type == actionType && option.action.actingMinion == bleeding,
            )
        :   undefined
    if (!decision || !declare) {
        throw new ScenarioFailure(`The ${actionType} is not offered`)
    }
    applyOption(decision, declare)
    return { gameState, bleeder, bled, third, reactor, deflection }
}

export function decideWith(gameState: GameState, player: Player, type: BotOption['type']) {
    const decision = getDecisionPoint(gameState, player)
    if (!decision) {
        throw new ScenarioFailure(`${player.name} has no decision`)
    }
    applyOption(decision, findOption(decision.options, type))
}

// The bleeder passes, the bled player declines to block, the bleeder passes again:
// the bled player is back with a decision to make
export function declineBlock(bounce: Bounce): DecisionPoint {
    const { gameState, bleeder, bled } = bounce
    decideWith(gameState, bleeder, 'noModifier')
    const first = getDecisionPoint(gameState, bled)
    if (!first) {
        throw new ScenarioFailure('The bled player has no decision')
    }
    expectEqual(
        optionsOfType(first.options, 'playReaction').length,
        0,
        'reaction offered before the block was declined',
    )
    applyOption(first, findOption(first.options, 'noBlock'))
    decideWith(gameState, bleeder, 'noModifier')

    const decision = getDecisionPoint(gameState, bled)
    if (!decision) {
        throw new ScenarioFailure('The bled player has no decision after declining')
    }
    return decision
}

export function getBounceOption(decision: DecisionPoint, level: DisciplineLevel) {
    const option = optionsOfType(decision.options, 'playReaction').find(
        candidate => candidate.usage.disciplines?.[0]?.level == level,
    )
    if (!option) {
        throw new ScenarioFailure(`Deflection at ${level} is not offered`)
    }
    return option
}

export const BOUNCE_SCENARIOS: Scenario[] = [
    {
        name: 'Deflection is offered after the block is declined, to the prey of the bled player only',
        run() {
            const bounce = createBounce(DisciplineLevel.SUPERIOR)
            const decision = declineBlock(bounce)
            const options = optionsOfType(decision.options, 'playReaction')
            // Superior and inferior, one new target each: never the bleeder, never the bled player
            expectEqual(options.length, 2, 'Deflection options')
            for (const option of options) {
                expectEqual(
                    option.effect.type == 'changeTarget' ? option.effect.target : null,
                    bounce.third,
                    'new target',
                )
            }
            expectEqual(optionsOfType(decision.options, 'noBlock').length, 0, 'noBlock again')
        },
    },
    {
        name: 'Deflection is never offered in a 2-player game, nor against an action that is not a bleed',
        run() {
            const duel = createBounce(DisciplineLevel.SUPERIOR, 2)
            expectEqual(
                optionsOfType(declineBlock(duel).options, 'playReaction').length,
                0,
                'Deflection offered with 2 players',
            )

            const hunt = createBounce(DisciplineLevel.SUPERIOR, 3, MinionActionType.Hunt)
            expectEqual(
                optionsOfType(declineBlock(hunt).options, 'playReaction').length,
                0,
                'Deflection offered against a hunt',
            )
        },
    },
    {
        name: 'Deflection at superior bounces the bleed without locking, the new target can block',
        run() {
            const bounce = createBounce(DisciplineLevel.SUPERIOR)
            const { gameState, bleeder, bled, third, reactor, deflection } = bounce
            if (!third) {
                throw new ScenarioFailure('No third player')
            }
            const bloodBefore = reactor.blood
            const pools = { bleeder: bleeder.pool, bled: bled.pool, third: third.pool }
            const decision = declineBlock(bounce)

            applyOption(decision, getBounceOption(decision, DisciplineLevel.SUPERIOR))
            expectEqual(gameState.action?.minionAction.target, third, 'new target')
            expectEqual(reactor.isLocked, false, 'reacting vampire locked')
            expectEqual(reactor.blood, bloodBefore - 1, 'Deflection costs 1 blood')
            expectEqual(deflection.isIn.ready, true, 'Deflection played')
            expectEqual(gameState.action?.blockingDecisions.length, 0, 'block decisions reset')
            expectEqual(getDecidingPlayer(gameState), bleeder, 'impulse back to the bleeder')

            // The bleeder passes, the new target may block even if nobody else could
            decideWith(gameState, bleeder, 'noModifier')
            const thirdDecision = getDecisionPoint(gameState, third)
            expectEqual(
                optionsOfType(thirdDecision?.options ?? [], 'block').length > 0,
                true,
                'new target can block',
            )
            expectEqual(
                optionsOfType(thirdDecision?.options ?? [], 'noReaction').length,
                0,
                'no pass before the block is decided',
            )
            decideWith(gameState, third, 'noBlock')
            decideWith(gameState, bleeder, 'noModifier')
            decideWith(gameState, third, 'noReaction')

            expectEqual(gameState.action, null, 'action in progress')
            expectEqual(third.pool < pools.third, true, 'the new target is bled')
            expectEqual(bled.pool, pools.bled, 'the previous target is not bled')
            expectEqual(bleeder.pool, pools.bleeder, 'the bleeder pool')
            applyPendingCleanup(gameState, bled)
            expectEqual(deflection.isIn.ashHeap, true, 'Deflection put away')
        },
    },
    {
        name: 'a minion plays a reaction card once per action, whatever the copies in hand; another minion still can',
        run() {
            const bounce = createBounce(DisciplineLevel.SUPERIOR, 3, MinionActionType.Bleed, 2)
            const { gameState, bled, third, reactor } = bounce
            if (!third) {
                throw new ScenarioFailure('No third player')
            }
            const other = readyVampire(gameState, bled, 3)
            other.minionAttrs.disciplines[Discipline.Dominate] = DisciplineLevel.SUPERIOR
            const decision = declineBlock(bounce)
            applyOption(
                decision,
                optionsOfType(decision.options, 'playReaction').find(
                    option =>
                        option.minion == reactor &&
                        option.usage.disciplines?.[0]?.level == DisciplineLevel.SUPERIOR,
                ) ?? getBounceOption(decision, DisciplineLevel.SUPERIOR),
            )

            // The bleed comes back to the first target, which still holds a Deflection
            must(botMutations.ACTION_changeTarget.act(third, { target: bled }), 'back to the bled')
            const minions = optionsOfType(declineBlock(bounce).options, 'playReaction').map(
                option => option.minion,
            )
            expectEqual(minions.includes(reactor), false, 'the same minion played it twice')
            expectEqual(minions.includes(other), true, 'another minion cannot play it')
        },
    },
    {
        name: 'Deflection at inferior locks the reacting vampire',
        run() {
            const bounce = createBounce(DisciplineLevel.INFERIOR)
            const decision = declineBlock(bounce)
            const options = optionsOfType(decision.options, 'playReaction')
            expectEqual(options.length, 1, 'only the inferior level')
            applyOption(decision, getBounceOption(decision, DisciplineLevel.INFERIOR))
            expectEqual(bounce.reactor.isLocked, true, 'reacting vampire locked')
            expectEqual(bounce.gameState.action?.minionAction.target, bounce.third, 'new target')
        },
    },
    {
        name: 'the new target is offered a block even after the first target declined',
        run() {
            const bounce = createBounce(DisciplineLevel.SUPERIOR)
            const { gameState, bleeder, third } = bounce
            if (!third) {
                throw new ScenarioFailure('No third player')
            }
            readyVampire(gameState, third, 3)
            const decision = declineBlock(bounce)
            applyOption(decision, getBounceOption(decision, DisciplineLevel.SUPERIOR))
            decideWith(gameState, bleeder, 'noModifier')
            // Every ready unlocked vampire of the new target may attempt the block
            const blocks = optionsOfType(getDecisionPoint(gameState, third)?.options ?? [], 'block')
            expectEqual(blocks.length, third.minionsReadyUnlocked.length, 'block options')
        },
    },
    {
        name: 'a bounce can only be applied on an action aimed at a Methuselah, away from the acting one',
        run() {
            const bounce = createBounce(DisciplineLevel.SUPERIOR)
            const { gameState, bleeder, bled, third } = bounce
            if (!third) {
                throw new ScenarioFailure('No third player')
            }
            mustRefuse(
                botMutations.ACTION_changeTarget.act(bled, { target: bleeder }),
                'to the bleeder',
            )
            mustRefuse(
                botMutations.ACTION_changeTarget.act(bled, { target: bled }),
                'to the same target',
            )
            must(botMutations.ACTION_changeTarget.act(bled, { target: third }), 'to a third player')
            expectEqual(gameState.action?.minionAction.target, third, 'new target')
        },
    },
    {
        name: 'the Govern agent declines to block, then bounces the bleed to its prey',
        run() {
            const bounce = createBounce(DisciplineLevel.SUPERIOR)
            const { gameState, bleeder, bled, third, reactor, deflection } = bounce
            if (!third) {
                throw new ScenarioFailure('No third player')
            }
            const pools = { bleeder: bleeder.pool, bled: bled.pool, third: third.pool }
            const agent = new GovernAgent()
            const steps: string[] = []
            for (let i = 0; i < 30 && gameState.action; i++) {
                const player = getDecidingPlayer(gameState)
                if (!player) {
                    throw new ScenarioFailure('Nobody has the impulse during the action')
                }
                const step = stepBot(player, agent)
                steps.push(`${player.name}:${step?.option.type}`)
            }
            expectEqual(gameState.action, null, 'action in progress')
            expectEqual(steps.includes(`${bled.name}:noBlock`), true, 'the bled agent declined')
            expectEqual(steps.includes(`${bled.name}:playReaction`), true, 'the bled agent bounced')
            expectEqual(third.pool < pools.third, true, 'the prey is bled')
            expectEqual(bled.pool, pools.bled, 'the bled agent is not bled')
            expectEqual(bleeder.pool, pools.bleeder, 'the bleeder pool')
            expectEqual(reactor.isLocked, false, 'superior does not lock')
            applyPendingCleanup(gameState, bled)
            expectEqual(deflection.isIn.ashHeap, true, 'Deflection put away')
        },
    },
    {
        name: 'a bot passing on the bleed of a human gives the impulse back to the human, the action stays',
        run() {
            const bounce = createBounce(DisciplineLevel.SUPERIOR)
            const { gameState, bleeder, bled } = bounce
            bleeder.permId = 'human'
            gameState.moveCardToRegion(bounce.deflection, bled.removed)
            const pool = bled.pool

            expectEqual(getDecidingPlayer(gameState), bleeder, 'the human holds the impulse')
            decideWith(gameState, bleeder, 'noModifier')
            expectEqual(getDecidingPlayer(gameState), bled, 'the bot holds the impulse')

            const agent = new GovernAgent()
            expectEqual(stepBot(bled, agent)?.option.type, 'noBlock', 'the bot declines to block')
            decideWith(gameState, bleeder, 'noModifier')
            expectEqual(stepBot(bled, agent)?.option.type, 'noReaction', 'the bot passes')
            expectEqual(getDecidingPlayer(gameState), bleeder, 'the human holds the impulse again')
            expectEqual(gameState.action !== null, true, 'the human ends the action by hand')
            expectEqual(bled.pool, pool, 'the bleed is not applied for the human')
        },
    },
    {
        name: 'the Govern agent bounces the bleed of a human once the human passes the impulse',
        run() {
            const bounce = createBounce(DisciplineLevel.SUPERIOR)
            const { gameState, bleeder, bled, third } = bounce
            bleeder.permId = 'human'
            const agent = new GovernAgent()

            // The bot declines the block, the human passes again, the bot bounces
            decideWith(gameState, bleeder, 'noModifier')
            expectEqual(stepBot(bled, agent)?.option.type, 'noBlock', 'the bot declines to block')
            expectEqual(getDecidingPlayer(gameState), bleeder, 'back to the human')
            decideWith(gameState, bleeder, 'noModifier')
            expectEqual(stepBot(bled, agent)?.option.type, 'playReaction', 'the bot bounces')
            expectEqual(gameState.action?.minionAction.target, third, 'new target')
            expectEqual(getDecidingPlayer(gameState), bleeder, 'back to the human')
        },
    },
    {
        name: 'the Govern agent keeps the youngest of more than 2 ready minions unlocked',
        run() {
            const { gameState, players } = createHeadlessGame([GovernDeck, GovernDeck])
            createdGames.push(gameState)
            const player = gameState.activePlayer
            if (!player || !players.includes(player)) {
                throw new ScenarioFailure('No active player')
            }
            emptyHand(gameState, player)
            giveCard(gameState, player, GOVERN_ID)
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Minion)
            gameState.turnResources.unlocked = true

            const [youngest, middle, oldest] = [4, 6, 8].map(capacity => {
                const vampire = readyVampire(gameState, player, 3)
                vampire.minionAttrs.capacity = capacity
                vampire.minionAttrs.disciplines[Discipline.Dominate] = DisciplineLevel.SUPERIOR
                return vampire
            })
            const agent = new GovernAgent()
            const actingMinion = () => {
                const decision = getDecisionPoint(gameState, player)
                const option = decision ? agent.choose(decision) : null
                return option?.type == 'declareAction' ? option.action.actingMinion : null
            }

            expectEqual(actingMinion(), oldest, 'the oldest acts first')
            oldest.isLocked = true
            expectEqual(actingMinion(), middle, 'then the next one')
            middle.isLocked = true
            expectEqual(actingMinion(), null, 'the youngest stays unlocked, the phase ends')
            expectEqual(youngest.isLocked, false, 'the youngest is unlocked')

            // With 2 ready minions only, nothing is reserved
            gameState.moveCardToRegion(oldest, player.torpor)
            expectEqual(actingMinion(), youngest, 'with 2 ready minions the youngest acts')
        },
    },
]
