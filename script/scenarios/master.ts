import { LibraryCard, Vampire } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { botMutations } from '@/shared/state/botMutations.ts'
import { TurnSequence, TurnPhase } from '@/shared/const/model.ts'
import { MasterCardImplementation } from '@/shared/cardImpl/base.ts'
import { MASTER_CARD_IMPLEMENTATIONS } from '@/shared/cardImpl/index.ts'
import { getUnlockEffectOptions } from '@/shared/bot/cardOptions.ts'
import { createPlayerView } from '@/shared/bot/playerView.ts'
import { findOption } from '@/shared/bot/helpers.ts'
import { GovernAgent } from '../governAgent.ts'
import {
    createHeadlessGame,
    registerQueuedMutationTrigger,
    registerSyncMutationTrigger,
} from '../harness.ts'
import { GovernDeck } from '@/shared/bot/decks.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { getDecisionPoint, applyOption, getDecidingPlayer } from '@/shared/bot/referee.ts'
import { stepBot } from '@/shared/bot/driver.ts'
import { DecisionPoint, optionsOfType, DecisionKind } from '@/shared/bot/types.ts'
import {
    Scenario,
    ScenarioFailure,
    createdGames,
    expectEqual,
    giveCard,
    must,
    mustRefuse,
    readyVampire,
} from './helpers.ts'
import { emptyHand } from './bounce.ts'
import {
    ABRAHAM_MELLON_ID,
    ASYLUM_HUNTING_GROUND_ID,
    DEFLECTION_ID,
    ELDER_LIBRARY_ID,
    FORGERS_HAMMER_ID,
    GOVERN_ID,
    SLUM_HUNTING_GROUND_ID,
} from '../cardIds.ts'

/**
 * Master cards: Elder Library (cost 1 pool, location, +1 hand size), played in the
 * master phase with the master phase action of the turn.
 */

export type MasterTurn = { gameState: GameState; player: Player; library: LibraryCard }

// The active player is in the master phase with Elder Library and 6 other cards in hand
function createMasterPhase(deck: DeckList = GovernDeck): MasterTurn {
    const { gameState, players } = createHeadlessGame([deck, deck])
    createdGames.push(gameState)
    const player = gameState.activePlayer
    if (!player || !players.includes(player)) {
        throw new ScenarioFailure('No active player')
    }
    emptyHand(gameState, player)
    const library = giveCard(gameState, player, ELDER_LIBRARY_ID)
    const others = player.library.cards.filter(card => card.krcgId != ELDER_LIBRARY_ID)
    for (const card of others.slice(0, 6)) {
        gameState.moveCardToRegion(card, player.hand)
    }
    gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Master)
    gameState.turnResources.unlocked = true
    return { gameState, player, library }
}

export function getMasterDecision(turn: MasterTurn): DecisionPoint {
    const decision = getDecisionPoint(turn.gameState, turn.player)
    if (!decision) {
        throw new ScenarioFailure('No decision point')
    }
    return decision
}

export const countMasterOptions = (turn: MasterTurn) =>
    optionsOfType(getMasterDecision(turn).options, 'playMaster').length

// Abraham Mellon is in the crypt or among the uncontrolled vampires, depending on the draw
function getAbraham(player: Player) {
    const abraham = [...player.crypt.cards, ...player.uncontrolled.cards].find(
        card => card.krcgId == ABRAHAM_MELLON_ID,
    )
    if (!abraham) {
        throw new ScenarioFailure('Abraham Mellon is not in the crypt')
    }
    return abraham
}

type AsylumTurn = MasterTurn & { asylum: LibraryCard }

// The master phase of a player with Asylum Hunting Ground ( or another card ) as their only card in hand
function createAsylumTurn(
    cardId = ASYLUM_HUNTING_GROUND_ID,
    deck: DeckList = GovernDeck,
): AsylumTurn {
    const { gameState, player } = createMasterPhase(deck)
    emptyHand(gameState, player)
    const asylum = giveCard(gameState, player, cardId)
    return { gameState, player, library: asylum, asylum }
}

// A vampire of the clan still in the crypt or among the uncontrolled ones ( never Abraham
// Mellon, whose hand size bonus would skew the scenarios )
function getVampireOfClan(player: Player, clan: string): Vampire {
    const vampire = [...player.crypt.cards, ...player.uncontrolled.cards].find(
        card =>
            card.isVampire() && card.vampireAttrs.clan == clan && card.krcgId != ABRAHAM_MELLON_ID,
    )
    if (!vampire?.isVampire()) {
        throw new ScenarioFailure(`No ${clan} vampire left`)
    }
    return vampire
}

export const countUnlockEffects = (turn: MasterTurn) =>
    optionsOfType(getMasterDecision(turn).options, 'unlockEffect').length

// A card of the player that is not in play yet ( hand or library )
export function findHeldCard(player: Player, krcgId: string): LibraryCard {
    const card = [...player.hand.cards, ...player.library.cards].find(
        candidate => candidate.krcgId == krcgId,
    )
    if (!(card instanceof LibraryCard)) {
        throw new ScenarioFailure(`Card ${krcgId} is not in hand or library`)
    }
    return card
}

type UniqueTurn = MasterTurn & { other: Player; theirs: LibraryCard }

// The master phase of a player holding Elder Library, while the other player has theirs in play
function createUniqueTurn(): UniqueTurn {
    const turn = createMasterPhase()
    const other = turn.gameState.orderedPlayers.find(candidate => candidate != turn.player)
    if (!other) {
        throw new ScenarioFailure('No other player')
    }
    const theirs = findHeldCard(other, ELDER_LIBRARY_ID)
    turn.gameState.moveCardToRegion(theirs, other.ready)
    return { ...turn, other, theirs }
}

export const MASTER_SCENARIOS: Scenario[] = [
    {
        name: 'Elder Library is offered with a master phase action and more pool than its cost',
        run() {
            const turn = createMasterPhase()
            const { gameState, player } = turn
            const decision = getMasterDecision(turn)
            expectEqual(decision.kind, DecisionKind.Master, 'decision kind')
            expectEqual(countMasterOptions(turn), 1, 'options in the master phase')
            findOption(decision.options, 'endPhase')

            gameState.turnResources.mpa = 0
            expectEqual(countMasterOptions(turn), 0, 'options without a master phase action')
            gameState.turnResources.mpa = 1

            player.pool = 1
            expectEqual(countMasterOptions(turn), 0, 'options when the pool would be emptied')
            player.pool = 2
            expectEqual(countMasterOptions(turn), 1, 'options with 2 pool')

            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Minion)
            const minionPhase = getMasterDecision(turn)
            expectEqual(
                optionsOfType(minionPhase.options, 'playMaster').length,
                0,
                'master options in the minion phase',
            )

            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Master)
            emptyHand(gameState, player)
            expectEqual(countMasterOptions(turn), 0, 'options when not in hand')
        },
    },
    {
        name: 'playing Elder Library: 1 pool, the action, +1 hand size, draws back to 8, stays in play',
        run() {
            const turn = createMasterPhase()
            const { gameState, player, library } = turn
            const pool = player.pool
            const libraryLength = player.library.length
            expectEqual(player.hand.length, 7, 'hand before')
            expectEqual(player.handSize, 7, 'hand size before')

            const decision = getMasterDecision(turn)
            applyOption(decision, findOption(decision.options, 'playMaster'))

            expectEqual(player.pool, pool - 1, 'pool')
            expectEqual(gameState.turnResources.mpa, 0, 'master phase action')
            expectEqual(player.handSize, 8, 'hand size')
            expectEqual(player.hand.length, 8, 'hand after the draw')
            expectEqual(player.library.length, libraryLength - 2, 'library after two draws')
            expectEqual(library.isIn.ready, true, 'in play')
            expectEqual(player.ashHeap.length, 0, 'ash heap')

            const next = getMasterDecision(turn)
            expectEqual(next.kind, DecisionKind.Master, 'no cleanup for a location')
            expectEqual(next.options.length, 1, 'only the way out is left')
        },
    },
    {
        name: 'the Govern agent plays Elder Library as soon as it is in hand, then ends the phase',
        run() {
            const turn = createMasterPhase()
            const { gameState, player } = turn
            const agent = new GovernAgent()
            expectEqual(stepBot(player, agent)?.option.type, 'playMaster', 'first step')
            expectEqual(stepBot(player, agent)?.option.type, 'endPhase', 'second step')
            expectEqual(gameState.turnPhase, TurnPhase.Minion, 'next phase')
        },
    },
    {
        name: 'a master card that does not stay in play goes to the ash heap at the cleanup',
        run() {
            class Discarded extends MasterCardImplementation {
                get staysInPlay() {
                    return false
                }
            }
            const original = MASTER_CARD_IMPLEMENTATIONS[ELDER_LIBRARY_ID]
            MASTER_CARD_IMPLEMENTATIONS[ELDER_LIBRARY_ID] = Discarded
            try {
                const turn = createMasterPhase()
                const { player, library } = turn
                const decision = getMasterDecision(turn)
                applyOption(decision, findOption(decision.options, 'playMaster'))
                expectEqual(library.isIn.ready, true, 'visible after the play')

                const cleanup = getMasterDecision(turn)
                expectEqual(cleanup.kind, DecisionKind.Cleanup, 'cleanup decision')
                applyOption(cleanup, findOption(cleanup.options, 'cleanup'))
                expectEqual(library.isIn.ashHeap, true, 'in the ash heap')
                expectEqual(player.ready.length, 0, 'nothing left in play')
            } finally {
                MASTER_CARD_IMPLEMENTATIONS[ELDER_LIBRARY_ID] = original
            }
        },
    },
    {
        name: 'the master phase action refuses to be spent when there is none',
        run() {
            const { gameState, player } = createMasterPhase()
            gameState.turnResources.mpa = 0
            mustRefuse(botMutations.spendMasterPhaseAction.act(player, { player }), 'spend (none)')
        },
    },
    {
        name: 'the hand size follows Elder Library: burned or stolen, the bonus is gone or goes with it',
        run() {
            const turn = createMasterPhase()
            const { gameState, player, library } = turn
            const other = gameState.orderedPlayers.find(candidate => candidate != player)
            if (!other) {
                throw new ScenarioFailure('No other player')
            }
            expectEqual(player.handSize, 7, 'before')
            const decision = getMasterDecision(turn)
            applyOption(decision, findOption(decision.options, 'playMaster'))
            expectEqual(player.handSize, 8, 'in play')

            must(
                gameMutations.takeControl.act(other, { card: library, controller: other }),
                'steal',
            )
            expectEqual(player.handSize, 7, 'stolen: the owner loses it')
            expectEqual(other.handSize, 8, 'stolen: the thief gets it')

            must(
                gameMutations.takeControl.act(other, { card: library, controller: undefined }),
                'back',
            )
            expectEqual(player.handSize, 8, 'control reverted')
            expectEqual(other.handSize, 7, 'control reverted: the thief loses it')

            gameState.moveCardToRegion(library, player.ashHeap)
            expectEqual(player.handSize, 7, 'burned')
            // Humans discard by hand: only a bot is made to
            player.permId = 'human'
            expectEqual(
                getDecisionPoint(gameState, player)?.kind,
                DecisionKind.Master,
                'a human is not asked',
            )
        },
    },
    {
        name: 'Abraham Mellon gives +1 hand size only while he is in the ready region',
        run() {
            const { gameState, player } = createMasterPhase()
            const abraham = getAbraham(player)
            expectEqual(player.handSize, 7, 'not in play')
            gameState.moveCardToRegion(abraham, player.ready)
            expectEqual(player.handSize, 8, 'ready')
            gameState.moveCardToRegion(abraham, player.torpor)
            expectEqual(player.handSize, 7, 'torpor')
            gameState.moveCardToRegion(abraham, player.ready)
            expectEqual(player.handSize, 8, 'out of torpor')
            gameState.moveCardToRegion(abraham, player.ashHeap)
            expectEqual(player.handSize, 7, 'dead')
        },
    },
    {
        name: 'Elder Library and Abraham Mellon stack, and a bot draws when a vampire gets out of torpor',
        run() {
            const turn = createMasterPhase()
            const { gameState, player } = turn
            const abraham = getAbraham(player)
            gameState.moveCardToRegion(abraham, player.torpor)
            const decision = getMasterDecision(turn)
            applyOption(decision, findOption(decision.options, 'playMaster'))
            expectEqual(player.handSize, 8, 'library only')
            expectEqual(player.hand.length, 8, 'hand after the library')

            gameState.moveCardToRegion(abraham, player.ready)
            expectEqual(player.handSize, 9, 'both')
            // The next decision of any bot ends with the draw
            const next = getMasterDecision(turn)
            applyOption(next, findOption(next.options, 'endPhase'))
            expectEqual(player.hand.length, 9, 'drawn after the vampire came back')
        },
    },
    {
        name: 'a bot over its hand size discards at once, even out of its turn, without using the discard action',
        run() {
            const turn = createMasterPhase()
            const { gameState, player } = turn
            const abraham = getAbraham(player)
            gameState.moveCardToRegion(abraham, player.ready)
            const draw = player.library.cards[0]
            gameState.moveCardToRegion(draw, player.hand)
            expectEqual(player.hand.length, 8, 'hand')

            // Abraham goes to torpor during the turn of the OTHER player
            const other = gameState.orderedPlayers.find(candidate => candidate != player)
            if (!other) {
                throw new ScenarioFailure('No other player')
            }
            gameState.activePlayerIndex = gameState.competingPlayers.indexOf(other)
            gameState.moveCardToRegion(abraham, player.torpor)
            expectEqual(player.handSize, 7, 'hand size')
            expectEqual(getDecidingPlayer(gameState), player, 'the bot decides first')

            const decision = getMasterDecision({ ...turn, player })
            expectEqual(decision.kind, DecisionKind.DiscardExcess, 'decision kind')
            expectEqual(decision.options.length, 8, 'one option per card')
            const ash = player.ashHeap.length
            const dpa = gameState.turnResources.dpa
            applyOption(decision, decision.options[0])
            expectEqual(player.hand.length, 7, 'hand after')
            expectEqual(player.ashHeap.length, ash + 1, 'ash heap')
            expectEqual(gameState.turnResources.dpa, dpa, 'discard phase action untouched')
            expectEqual(getDecidingPlayer(gameState), other, 'the game goes on')
        },
    },
    {
        name: 'the Govern agent discards the excess but keeps its Govern cards',
        run() {
            const { gameState, player } = createMasterPhase()
            emptyHand(gameState, player)
            const govern = giveCard(gameState, player, GOVERN_ID)
            const others = player.library.cards.filter(card => card.krcgId != GOVERN_ID)
            for (const card of others.slice(0, 7)) {
                gameState.moveCardToRegion(card, player.hand)
            }
            expectEqual(player.hand.length, 8, 'hand')
            const step = stepBot(player, new GovernAgent())
            expectEqual(step?.option.type, 'discardExcess', 'step')
            expectEqual(govern.isIn.hand, true, 'Govern kept')
            expectEqual(player.hand.length, 7, 'hand after')
        },
    },
    {
        name: 'the hand size is part of the player view',
        run() {
            const { gameState, player } = createMasterPhase()
            const abraham = getAbraham(player)
            gameState.moveCardToRegion(abraham, player.ready)
            const view = createPlayerView(gameState, player)
            try {
                expectEqual(view.player.handSize, 8, 'hand size in the view')
            } finally {
                view.dispose()
            }
        },
    },
    {
        name: 'Asylum Hunting Ground requires a ready Malkavian vampire',
        run() {
            const turn = createAsylumTurn()
            const { gameState, player } = turn
            expectEqual(countMasterOptions(turn), 0, 'no ready vampire')

            const nosferatu = getVampireOfClan(player, 'Nosferatu')
            gameState.moveCardToRegion(nosferatu, player.ready)
            expectEqual(countMasterOptions(turn), 0, 'a ready Nosferatu')

            const malkavian = getVampireOfClan(player, 'Malkavian')
            gameState.moveCardToRegion(malkavian, player.torpor)
            expectEqual(countMasterOptions(turn), 0, 'a Malkavian in torpor')

            gameState.moveCardToRegion(malkavian, player.ready)
            expectEqual(countMasterOptions(turn), 1, 'a ready Malkavian')

            player.pool = 2
            expectEqual(countMasterOptions(turn), 0, 'pool of 2 would be emptied')
        },
    },
    {
        name: 'playing Asylum Hunting Ground: 2 pool, the action, stays in play',
        run() {
            const turn = createAsylumTurn()
            const { gameState, player, asylum } = turn
            gameState.moveCardToRegion(getVampireOfClan(player, 'Malkavian'), player.ready)
            const pool = player.pool

            const decision = getMasterDecision(turn)
            applyOption(decision, findOption(decision.options, 'playMaster'))
            expectEqual(player.pool, pool - 2, 'pool')
            expectEqual(gameState.turnResources.mpa, 0, 'master phase action')
            expectEqual(asylum.isIn.ready, true, 'in play')
            expectEqual(player.handSize, 7, 'no hand size bonus')
            expectEqual(getMasterDecision(turn).kind, DecisionKind.Master, 'no cleanup')
        },
    },
    {
        name: 'Asylum Hunting Ground gives 1 blood once per turn, never above the capacity',
        run() {
            const turn = createAsylumTurn()
            const { gameState, player, asylum } = turn
            gameState.moveCardToRegion(asylum, player.ready)
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Unlock)

            const [low, high, full] = [1, 3, 5].map(blood => {
                const vampire = readyVampire(gameState, player, blood)
                vampire.minionAttrs.capacity = 5
                return vampire
            })
            gameState.turnResources.unlocked = false
            expectEqual(countUnlockEffects(turn), 0, 'nothing before the unlock')
            gameState.turnResources.unlocked = true
            expectEqual(countUnlockEffects(turn), 2, 'the full vampire is not a target')

            // A vampire in torpor is not ready
            gameState.moveCardToRegion(getVampireOfClan(player, 'Malkavian'), player.torpor)
            expectEqual(countUnlockEffects(turn), 2, 'a torpid vampire is not a target')

            const decision = getMasterDecision(turn)
            const option = optionsOfType(decision.options, 'unlockEffect').find(
                candidate => candidate.vampire == high,
            )
            if (!option) {
                throw new ScenarioFailure('No unlock effect on the vampire')
            }
            applyOption(decision, option)
            expectEqual(high.blood, 4, 'blood gained')
            expectEqual(low.blood, 1, 'the other vampire is untouched')
            expectEqual(full.blood, 5, 'the full vampire is untouched')
            expectEqual(countUnlockEffects(turn), 0, 'once per turn')
            mustRefuse(
                botMutations.markCardUsed.act(player, { player, card: asylum }),
                'used twice',
            )

            gameState.setNewTurnResources()
            gameState.turnResources.unlocked = true
            expectEqual(countUnlockEffects(turn), 2, 'available again the next turn')
        },
    },
    {
        name: 'Slum Hunting Ground requires a ready Nosferatu, costs 2 pool and gives 1 blood once per turn in the unlock phase',
        run() {
            const turn = createAsylumTurn(SLUM_HUNTING_GROUND_ID, {
                ...GovernDeck,
                [SLUM_HUNTING_GROUND_ID]: 2,
            })
            const { gameState, player, asylum: slum } = turn
            expectEqual(countMasterOptions(turn), 0, 'no ready vampire')

            gameState.moveCardToRegion(getVampireOfClan(player, 'Malkavian'), player.ready)
            expectEqual(countMasterOptions(turn), 0, 'a ready Malkavian')

            const nosferatu = getVampireOfClan(player, 'Nosferatu')
            gameState.moveCardToRegion(nosferatu, player.torpor)
            expectEqual(countMasterOptions(turn), 0, 'a Nosferatu in torpor')
            gameState.moveCardToRegion(nosferatu, player.ready)
            expectEqual(countMasterOptions(turn), 1, 'a ready Nosferatu')

            const pool = player.pool
            const decision = getMasterDecision(turn)
            applyOption(decision, findOption(decision.options, 'playMaster'))
            expectEqual(player.pool, pool - 2, 'pool')
            expectEqual(slum.isIn.ready, true, 'in play')

            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Unlock)
            nosferatu.blood = 2
            nosferatu.minionAttrs.capacity = 4
            const feed = getMasterDecision(turn)
            const option = optionsOfType(feed.options, 'unlockEffect').find(
                candidate => candidate.vampire == nosferatu,
            )
            if (!option) {
                throw new ScenarioFailure('No unlock effect on the Nosferatu')
            }
            applyOption(feed, option)
            expectEqual(nosferatu.blood, 3, 'blood gained')
            expectEqual(countUnlockEffects(turn), 0, 'once per turn')
        },
    },
    {
        name: 'Asylum Hunting Ground effect is only for the controller, in play and in the unlock phase',
        run() {
            const turn = createAsylumTurn()
            const { gameState, player, asylum } = turn
            const other = gameState.orderedPlayers.find(candidate => candidate != player)
            if (!other) {
                throw new ScenarioFailure('No other player')
            }
            readyVampire(gameState, player, 1)
            readyVampire(gameState, other, 1)
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Unlock)
            gameState.turnResources.unlocked = true
            expectEqual(countUnlockEffects(turn), 0, 'in hand')

            gameState.moveCardToRegion(asylum, player.ready)
            expectEqual(countUnlockEffects(turn), 1, 'in play')
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Minion)
            expectEqual(countUnlockEffects(turn), 0, 'not in the unlock phase')

            // Stolen: the thief unlocks it, on their own vampires
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Unlock)
            must(gameMutations.takeControl.act(other, { card: asylum, controller: other }), 'steal')
            expectEqual(countUnlockEffects(turn), 0, 'stolen: the owner loses it')
            const targets = getUnlockEffectOptions(other)
            expectEqual(targets.length, 1, 'stolen: the thief gets it')
            expectEqual(targets[0].vampire.controller, other, 'on a vampire of the thief')
        },
    },
    {
        name: 'the Govern agent plays Asylum Hunting Ground once it can, Elder Library first',
        run() {
            const turn = createAsylumTurn()
            const { gameState, player } = turn
            const agent = new GovernAgent()
            expectEqual(
                getMasterDecision(turn).options.length,
                1,
                'only the way out without a Malkavian',
            )
            gameState.moveCardToRegion(getVampireOfClan(player, 'Malkavian'), player.ready)
            expectEqual(stepBot(player, agent)?.option.type, 'playMaster', 'plays it')
            expectEqual(stepBot(player, agent)?.option.type, 'endPhase', 'then ends the phase')

            const both = createAsylumTurn()
            const malkavian = getVampireOfClan(both.player, 'Malkavian')
            both.gameState.moveCardToRegion(malkavian, both.player.ready)
            const library = giveCard(both.gameState, both.player, ELDER_LIBRARY_ID)
            const step = stepBot(both.player, agent)
            if (step?.option.type != 'playMaster') {
                throw new ScenarioFailure('The agent does not play a master card')
            }
            expectEqual(step.option.card, library, 'Elder Library first')
        },
    },
    {
        name: 'the Govern agent unlocks first, then feeds the vampire with the least blood',
        run() {
            const turn = createAsylumTurn()
            const { gameState, player, asylum } = turn
            gameState.moveCardToRegion(asylum, player.ready)
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Unlock)
            gameState.turnResources.unlocked = false
            const [high, low] = [4, 2].map(blood => {
                const vampire = readyVampire(gameState, player, blood)
                vampire.minionAttrs.capacity = 5
                return vampire
            })
            const agent = new GovernAgent()

            expectEqual(stepBot(player, agent)?.option.type, 'unlockAll', 'unlocks first')
            expectEqual(stepBot(player, agent)?.option.type, 'unlockEffect', 'then the effect')
            expectEqual(low.blood, 3, 'the emptiest vampire gets the blood')
            expectEqual(high.blood, 4, 'the other one does not')
            expectEqual(stepBot(player, agent)?.option.type, 'endPhase', 'then ends the phase')

            // Everybody is full: no vampire is chosen
            const full = createAsylumTurn()
            full.gameState.moveCardToRegion(full.asylum, full.player.ready)
            full.gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Unlock)
            full.gameState.turnResources.unlocked = false
            const vampire = readyVampire(full.gameState, full.player, 5)
            vampire.minionAttrs.capacity = 5
            expectEqual(stepBot(full.player, agent)?.option.type, 'unlockAll', 'unlocks first')
            expectEqual(stepBot(full.player, agent)?.option.type, 'endPhase', 'no vampire to feed')
            expectEqual(vampire.blood, 5, 'never above the capacity')
        },
    },
    {
        name: 'with queued mutations ( the browser ) the draw to hand size ends and queues the right count',
        run() {
            const turn = createMasterPhase()
            const { player } = turn
            const queue = registerQueuedMutationTrigger()
            try {
                const decision = getMasterDecision(turn)
                applyOption(decision, findOption(decision.options, 'playMaster'))
                queue.flush()
                expectEqual(player.handSize, 8, 'hand size')
                expectEqual(player.hand.length, 6, 'hand before the draw')

                // The next decision draws back: it must not loop on the hand length
                const next = getMasterDecision(turn)
                applyOption(next, findOption(next.options, 'endPhase'))
                expectEqual(queue.queued() >= 2, true, 'draws queued')
                queue.flush()
                expectEqual(player.hand.length, 8, 'hand after the draw')
            } finally {
                registerSyncMutationTrigger()
            }
        },
    },
    {
        name: 'a card is unique when its first line says so, and not when it says non-unique',
        run() {
            const { gameState, players } = createHeadlessGame([
                { ...GovernDeck, [FORGERS_HAMMER_ID]: 1 },
                GovernDeck,
            ])
            createdGames.push(gameState)
            const [player] = players
            expectEqual(findHeldCard(player, ELDER_LIBRARY_ID).isUnique, true, 'Elder Library')
            expectEqual(findHeldCard(player, ASYLUM_HUNTING_GROUND_ID).isUnique, true, 'Asylum')
            expectEqual(findHeldCard(player, GOVERN_ID).isUnique, false, 'Govern')
            expectEqual(findHeldCard(player, DEFLECTION_ID).isUnique, false, 'Deflection')
            expectEqual(findHeldCard(player, FORGERS_HAMMER_ID).isUnique, false, 'non-unique text')
        },
    },
    {
        name: 'a unique master is not offered while another copy is in play, whoever has it',
        run() {
            const turn = createUniqueTurn()
            const { gameState, player, other, theirs, library } = turn
            expectEqual(countMasterOptions(turn), 0, 'a copy in another play area')

            gameState.moveCardToRegion(theirs, other.ashHeap)
            expectEqual(countMasterOptions(turn), 1, 'the other copy is burned')

            gameState.moveCardToRegion(theirs, other.library)
            expectEqual(countMasterOptions(turn), 1, 'the other copy is not in play')

            gameState.moveCardToRegion(theirs, player.ready)
            expectEqual(countMasterOptions(turn), 0, 'a copy in its own play area')
            expectEqual(library.isIn.hand, true, 'the card stays in hand')
        },
    },
    {
        name: 'the Govern agent does not play a dead unique master',
        run() {
            const turn = createUniqueTurn()
            const step = stepBot(turn.player, new GovernAgent())
            expectEqual(step?.option.type, 'endPhase', 'ends the master phase')
            expectEqual(turn.library.isIn.hand, true, 'still in hand')
        },
    },
    {
        name: 'the Govern agent discards a dead unique card in its discard phase, then draws back',
        run() {
            const turn = createUniqueTurn()
            const { gameState, player, library } = turn
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Discard)
            const dpa = gameState.turnResources.dpa
            const ash = player.ashHeap.length
            const libraryLength = player.library.length
            expectEqual(player.hand.length, 7, 'hand before')
            expectEqual(getMasterDecision(turn).kind, DecisionKind.Discard, 'decision kind')

            const step = stepBot(player, new GovernAgent())
            expectEqual(step?.option.type, 'discard', 'step')
            expectEqual(library.isIn.ashHeap, true, 'in the ash heap')
            expectEqual(player.ashHeap.length, ash + 1, 'ash heap')
            expectEqual(gameState.turnResources.dpa, dpa - 1, 'discard phase action spent')
            expectEqual(player.hand.length, 7, 'drawn back to the hand size')
            expectEqual(player.library.length, libraryLength - 1, 'one card drawn')

            const next = getMasterDecision(turn)
            expectEqual(next.options.length, 1, 'no discard left')
            findOption(next.options, 'endTurn')
        },
    },
    {
        name: 'the Govern agent discards the dead unique card even when it holds Govern',
        run() {
            const turn = createUniqueTurn()
            const { gameState, player, library } = turn
            const govern = giveCard(gameState, player, GOVERN_ID)
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Discard)
            const step = stepBot(player, new GovernAgent())
            if (step?.option.type != 'discard') {
                throw new ScenarioFailure('The agent does not discard')
            }
            expectEqual(step.option.card, library, 'the dead card')
            expectEqual(govern.isIn.hand, true, 'Govern kept')
        },
    },
    {
        name: 'the Govern agent keeps a unique card that can still be played',
        run() {
            const turn = createUniqueTurn()
            const { gameState, player, other, theirs, library } = turn
            gameState.moveCardToRegion(theirs, other.ashHeap)
            giveCard(gameState, player, GOVERN_ID)
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Discard)
            const step = stepBot(player, new GovernAgent())
            expectEqual(step?.option.type, 'endTurn', 'discards nothing')
            expectEqual(library.isIn.hand, true, 'still in hand')
        },
    },
    {
        name: 'a bot over its hand size discards the dead unique card first',
        run() {
            const turn = createUniqueTurn()
            const { gameState, player, library } = turn
            giveCard(gameState, player, GOVERN_ID)
            const extra = player.library.cards.find(
                card => card.krcgId != GOVERN_ID && card.krcgId != ELDER_LIBRARY_ID,
            )
            if (!extra) {
                throw new ScenarioFailure('No card left to draw')
            }
            gameState.moveCardToRegion(extra, player.hand)
            expectEqual(player.hand.length, 8, 'hand')
            const step = stepBot(player, new GovernAgent())
            if (step?.option.type != 'discardExcess') {
                throw new ScenarioFailure('The agent does not discard the excess')
            }
            expectEqual(step.option.card, library, 'the dead card')
        },
    },
]
