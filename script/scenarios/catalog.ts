import { LibraryCard, Vampire, Minion } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { botMutations } from '@/shared/state/botMutations.ts'
import { MinionActionType, CombatStep } from '@/shared/types/state.ts'
import { TurnSequence, TurnPhase, Discipline, DisciplineLevel } from '@/shared/const/model.ts'
import { getAttachedCards } from '@/shared/state/attachments.ts'
import {
    MINION_TAP_ID,
    VILLEIN_ID,
    LOST_IN_CROWDS_ID,
    ELDER_LIBRARY_ID,
} from '@/shared/cardImpl/cardIds.ts'
import { getMasterImplementation } from '@/shared/cardImpl/index.ts'
import { findOption } from '@/shared/bot/helpers.ts'
import { createHeadlessGame } from '../harness.ts'
import { MalkavDeck } from '@/shared/bot/decks.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { getDecisionPoint, applyOption, getDecidingPlayer } from '@/shared/bot/referee.ts'
import { optionsOfType, DecisionKind, DecisionPoint } from '@/shared/bot/types.ts'
import {
    Scenario,
    ScenarioFailure,
    attachInPlay,
    createFight,
    createdGames,
    expectEqual,
    findCard,
    giveCard,
    givenCards,
    mustRefuse,
    passUntil,
    readySpecific,
    readyVampire,
} from './helpers.ts'
import { decideWith, emptyHand, sealLibrary } from './bounce.ts'
import { MasterTurn, countMasterOptions, findHeldCard, getMasterDecision } from './master.ts'
import { getCombatDecision } from './combatCards.ts'

/**
 * Cards described in the catalog ( the Malkavian precon ): conditions, the limited rule, plays of
 * several kinds, per level plays.
 */

export const CONDITIONING_ID = '100401'

export const BONDING_ID = '100236'

const FORESHADOWING_ID = '100765'

const SWALLOWED_ID = '101913'

const TELEPATHIC_ID = '101949'

export const CLOAK_ID = '100362'

export const QUI_VIVE_ID = '101321'

export const BARRENS_ID = '100135'

export const WIDER_VIEW_ID = '102180'

export const FACELESS_NIGHT_ID = '100687'

export const EYES_OF_ARGUS_ID = '100680'

export const LIFE_IN_THE_CITY_ID = '101104'

// The influence phase of a player with Wider View in play and the transfers
function createWiderViewTurn(transfers: number) {
    const { gameState } = createHeadlessGame([MalkavDeck, MalkavDeck])
    createdGames.push(gameState)
    const player = gameState.activePlayer
    if (!player) {
        throw new ScenarioFailure('No active player')
    }
    const card = giveCard(gameState, player, WIDER_VIEW_ID)
    gameState.moveCardToRegion(card, player.ready)
    gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Influence)
    gameState.turnResources.unlocked = true
    gameState.turnResources.transfers = transfers
    const decision = getDecisionPoint(gameState, player)
    if (!decision) {
        throw new ScenarioFailure('No decision point')
    }
    return { gameState, player, card, decision }
}

export const MINION_TAP_DECK = <DeckList>{ ...MalkavDeck, [MINION_TAP_ID]: 4 }

export const VILLEIN_DECK = <DeckList>{ ...MINION_TAP_DECK, [VILLEIN_ID]: 4 }

// The master phase of a player holding Life in the City ( or another master card ), with two ready vampires
function createLifeInTheCityTurn(
    bloods: number[],
    cardId = LIFE_IN_THE_CITY_ID,
    deck: DeckList = MINION_TAP_DECK,
) {
    const { gameState } = createHeadlessGame([deck, deck])
    createdGames.push(gameState)
    const player = gameState.activePlayer
    if (!player) {
        throw new ScenarioFailure('No active player')
    }
    emptyHand(gameState, player)
    const card = giveCard(gameState, player, cardId)
    const vampires = bloods.map(blood => readyVampire(gameState, player, blood))
    gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Master)
    gameState.turnResources.unlocked = true
    const decision = getDecisionPoint(gameState, player)
    if (!decision) {
        throw new ScenarioFailure('No decision point')
    }
    return { gameState, player, card, vampires, decision }
}

// The master phase of a player holding the two Life in the City ( trifles ) and a Minion Tap ( not
// one ) of the Malkav deck, with two ready vampires that hold blood and can gain some
function createTrifleTurn() {
    const { gameState } = createHeadlessGame([MINION_TAP_DECK, MINION_TAP_DECK])
    createdGames.push(gameState)
    const player = gameState.activePlayer
    if (!player) {
        throw new ScenarioFailure('No active player')
    }
    emptyHand(gameState, player)
    const trifles = player.library.cards.filter(
        (card): card is LibraryCard =>
            card instanceof LibraryCard && card.krcgId == LIFE_IN_THE_CITY_ID,
    )
    const [first, second] = trifles
    if (!first || !second) {
        throw new ScenarioFailure('Two Life in the City are needed')
    }
    const tap = findCard(player, MINION_TAP_ID)
    for (const card of [first, second, tap]) {
        gameState.moveCardToRegion(card, player.hand)
        givenCards.add(card)
    }
    const vampires = [1, 1].map(blood => readyVampire(gameState, player, blood))
    gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Master)
    gameState.turnResources.unlocked = true
    return { gameState, player, library: first, trifles: [first, second], tap, vampires }
}

// Plays the card through the master phase decision, then its cleanup when it does not stay in play
function playMasterCard(turn: MasterTurn, card: LibraryCard): void {
    const decision = getMasterDecision(turn)
    const play = optionsOfType(decision.options, 'playMaster').find(option => option.card == card)
    if (!play) {
        throw new ScenarioFailure(`${card.name} is not offered`)
    }
    applyOption(decision, play)
    const next = getMasterDecision(turn)
    if (next.kind == DecisionKind.Cleanup) {
        applyOption(next, findOption(next.options, 'cleanup'))
    }
}

type CatalogBleedSetup = {
    discipline: Discipline
    level: DisciplineLevel
    // The hand of the acting player
    cards: string[]
    actionType?: MinionActionType
    // The hand of the prey and the discipline of its vampire
    preyCards?: string[]
    preyDiscipline?: [Discipline, DisciplineLevel]
    // Malkavian by default
    deck?: DeckList
    // The crypt cards to use instead of the first uncontrolled vampires
    bleederId?: string
    preyVampireId?: string
}

type CatalogBleed = {
    gameState: GameState
    bleeder: Player
    bled: Player
    third: Player
    bleeding: Vampire
    blocker: Vampire
}

// The first player declares an action ( a bleed ) against its prey, with a vampire that has the
// discipline at the level. The prey has one ready vampire. Three players.
export function createCatalogBleed(setup: CatalogBleedSetup): CatalogBleed {
    const deck = setup.deck ?? MalkavDeck
    const { gameState, players } = createHeadlessGame([deck, deck, deck])
    createdGames.push(gameState)
    const bleeder = gameState.activePlayer
    const bled = bleeder?.prey
    const third = bled?.prey
    if (!bleeder || !bled || !third) {
        throw new ScenarioFailure('No active player or no prey')
    }
    for (const player of players) {
        emptyHand(gameState, player)
    }
    gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Minion)
    gameState.turnResources.unlocked = true

    const bleeding =
        setup.bleederId ?
            readySpecific(gameState, bleeder, setup.bleederId, 5)
        :   readyVampire(gameState, bleeder, 5)
    bleeding.minionAttrs.disciplines[setup.discipline] = setup.level
    bleeding.minionAttrs.disciplines[Discipline.Obfuscate] ??= DisciplineLevel.INFERIOR
    const blocker =
        setup.preyVampireId ?
            readySpecific(gameState, bled, setup.preyVampireId, 3)
        :   readyVampire(gameState, bled, 3)
    if (setup.preyDiscipline) {
        blocker.minionAttrs.disciplines[setup.preyDiscipline[0]] = setup.preyDiscipline[1]
    }
    for (const id of setup.cards) {
        giveCard(gameState, bleeder, id)
    }
    for (const id of setup.preyCards ?? []) {
        giveCard(gameState, bled, id)
    }
    for (const player of players) {
        sealLibrary(gameState, player)
    }

    const actionType = setup.actionType ?? MinionActionType.Bleed
    const decision = getDecisionPoint(gameState, bleeder)
    const declare = decision?.options.find(
        option =>
            option.type == 'declareAction' &&
            option.action.type == actionType &&
            option.action.actingMinion == bleeding,
    )
    if (!decision || !declare) {
        throw new ScenarioFailure(`The ${actionType} is not offered`)
    }
    applyOption(decision, declare)
    return { gameState, bleeder, bled, third, bleeding, blocker }
}

// The players pass ( no block, no reaction ) until the player has a decision to make
export function passUntilDecides(gameState: GameState, who: Player): DecisionPoint {
    for (let i = 0; i < 8; i++) {
        const decider = getDecidingPlayer(gameState)
        const decision = decider && getDecisionPoint(gameState, decider)
        if (!decider || !decision) {
            throw new ScenarioFailure('Nobody has a decision')
        }
        if (decider == who) {
            return decision
        }
        const pass = decision.options.find(option =>
            ['noBlock', 'noReaction', 'noModifier'].includes(option.type),
        )
        if (!pass) {
            throw new ScenarioFailure(`${decider.name} cannot pass`)
        }
        applyOption(decision, pass)
    }
    throw new ScenarioFailure(`${who.name} never has a decision`)
}

// Rulebook: stealth is only added when a block attempt stands that would succeed, intercept when it
// would fail. The prey's vampire attempts the block, then the scenario settles which one it is
// ( the stealth and intercept of the action are set, whatever the vampires have ).
export function attemptBlock(
    game: { gameState: GameState; bled: Player; blocker: Vampire },
    wouldSucceed: boolean,
): void {
    const { gameState, bled, blocker } = game
    const first = passUntilDecides(gameState, bled)
    applyOption(
        first,
        optionsOfType(first.options, 'block').find(option => option.minion == blocker) ??
            findOption(first.options, 'block'),
    )
    const action = gameState.action
    if (!action) {
        throw new ScenarioFailure('The block attempt closed the action')
    }
    if (wouldSucceed) {
        action.intercept = Math.max(action.intercept, action.stealth)
    } else {
        action.stealth = action.intercept + 1
    }
}

export const modifierOptionsOf = (decision: DecisionPoint, krcgId: string) =>
    optionsOfType(decision.options, 'playModifier').filter(
        option => option.modifier.card.krcgId == krcgId,
    )

export const modifierLevel = (option: ReturnType<typeof modifierOptionsOf>[number]) =>
    option.modifier.usage.disciplines?.[0]?.level

export const CATALOG_SCENARIOS: Scenario[] = [
    {
        name: 'Conditioning is offered at both levels during a bleed, the superior one adds 3 bleed and costs a blood',
        run() {
            const game = createCatalogBleed({
                discipline: Discipline.Dominate,
                level: DisciplineLevel.SUPERIOR,
                cards: [CONDITIONING_ID],
            })
            const decision = passUntilDecides(game.gameState, game.bleeder)
            const options = modifierOptionsOf(decision, CONDITIONING_ID)
            expectEqual(options.length, 2, 'both levels')
            const superior = options.find(
                option => modifierLevel(option) == DisciplineLevel.SUPERIOR,
            )
            if (!superior) {
                throw new ScenarioFailure('The superior level is not offered')
            }
            const before = game.gameState.action?.bleed ?? 0
            applyOption(decision, superior)
            expectEqual(game.gameState.action?.bleed, before + 3, 'bleed')
            expectEqual(game.bleeding.blood, 4, 'blood paid')
        },
    },
    {
        name: 'a minion with the inferior level only is offered the inferior Conditioning, +2 bleed',
        run() {
            const game = createCatalogBleed({
                discipline: Discipline.Dominate,
                level: DisciplineLevel.INFERIOR,
                cards: [CONDITIONING_ID],
            })
            const decision = passUntilDecides(game.gameState, game.bleeder)
            const options = modifierOptionsOf(decision, CONDITIONING_ID)
            expectEqual(options.length, 1, 'one level')
            const before = game.gameState.action?.bleed ?? 0
            applyOption(decision, options[0])
            expectEqual(game.gameState.action?.bleed, before + 2, 'bleed')
        },
    },
    {
        name: 'Conditioning is not offered when the action is not a bleed, other modifiers still are',
        run() {
            const game = createCatalogBleed({
                discipline: Discipline.Dominate,
                level: DisciplineLevel.SUPERIOR,
                cards: [CONDITIONING_ID, LOST_IN_CROWDS_ID],
                actionType: MinionActionType.Hunt,
            })
            attemptBlock(game, true)
            const decision = passUntilDecides(game.gameState, game.bleeder)
            expectEqual(modifierOptionsOf(decision, CONDITIONING_ID).length, 0, 'Conditioning')
            expectEqual(
                modifierOptionsOf(decision, LOST_IN_CROWDS_ID).length > 0,
                true,
                'Lost in Crowds is the proof that modifiers were offered',
            )
        },
    },
    {
        name: 'only one limited bleed bonus per action: a second one is refused, other modifiers are not',
        run() {
            const game = createCatalogBleed({
                discipline: Discipline.Dominate,
                level: DisciplineLevel.SUPERIOR,
                cards: [CONDITIONING_ID, BONDING_ID, LOST_IN_CROWDS_ID],
            })
            attemptBlock(game, true)
            const decision = passUntilDecides(game.gameState, game.bleeder)
            expectEqual(modifierOptionsOf(decision, BONDING_ID).length, 2, 'Bonding before')
            applyOption(decision, modifierOptionsOf(decision, CONDITIONING_ID)[0])

            const next = getDecisionPoint(game.gameState, game.bleeder)
            if (!next) {
                throw new ScenarioFailure('The acting player lost the impulse')
            }
            expectEqual(modifierOptionsOf(next, BONDING_ID).length, 0, 'Bonding after')
            expectEqual(
                modifierOptionsOf(next, LOST_IN_CROWDS_ID).length > 0,
                true,
                'Lost in Crowds',
            )
        },
    },
    {
        name: 'Foreshadowing Destruction superior is only offered against a Methuselah with 9 pool or less',
        run() {
            for (const [pool, superiorOffered] of [
                [10, false],
                [9, true],
            ] as const) {
                const game = createCatalogBleed({
                    discipline: Discipline.Dominate,
                    level: DisciplineLevel.SUPERIOR,
                    cards: [FORESHADOWING_ID],
                })
                game.bled.pool = pool
                const decision = passUntilDecides(game.gameState, game.bleeder)
                const levels = modifierOptionsOf(decision, FORESHADOWING_ID).map(modifierLevel)
                expectEqual(levels.includes(DisciplineLevel.INFERIOR), true, `inferior at ${pool}`)
                expectEqual(
                    levels.includes(DisciplineLevel.SUPERIOR),
                    superiorOffered,
                    `superior at ${pool}`,
                )
            }
        },
    },
    {
        name: 'Swallowed by the Night is a stealth modifier at inferior only: no superior modifier',
        run() {
            const game = createCatalogBleed({
                discipline: Discipline.Obfuscate,
                level: DisciplineLevel.SUPERIOR,
                cards: [SWALLOWED_ID],
            })
            attemptBlock(game, true)
            const decision = passUntilDecides(game.gameState, game.bleeder)
            const options = modifierOptionsOf(decision, SWALLOWED_ID)
            expectEqual(options.length, 1, 'modifier options')
            expectEqual(modifierLevel(options[0]), DisciplineLevel.INFERIOR, 'level')
            const before = game.gameState.action?.stealth ?? 0
            applyOption(decision, options[0])
            expectEqual(game.gameState.action?.stealth, before + 1, 'stealth')
        },
    },
    {
        name: 'Stealth and intercept are only added when needed (rulebook): stealth while the block would succeed, intercept while it would fail',
        run() {
            const setup = () =>
                createCatalogBleed({
                    discipline: Discipline.Obfuscate,
                    level: DisciplineLevel.INFERIOR,
                    cards: [LOST_IN_CROWDS_ID],
                    preyCards: [TELEPATHIC_ID],
                    preyDiscipline: [Discipline.Auspex, DisciplineLevel.INFERIOR],
                })
            const stealthOffered = (game: ReturnType<typeof setup>) => {
                const decision = getDecisionPoint(game.gameState, game.bleeder)
                return decision ? modifierOptionsOf(decision, LOST_IN_CROWDS_ID).length : -1
            }
            const interceptOffered = (game: ReturnType<typeof setup>) => {
                const decision = getDecisionPoint(game.gameState, game.bled)
                return decision ? optionsOfType(decision.options, 'playReaction').length : -1
            }

            // No block attempt stands: neither is needed
            const none = setup()
            expectEqual(stealthOffered(none), 0, 'stealth before any block attempt')

            // The block attempt would fail: intercept is needed, stealth is not
            const failing = setup()
            attemptBlock(failing, false)
            expectEqual(stealthOffered(failing), 0, 'stealth while the block fails')
            decideWith(failing.gameState, failing.bleeder, 'noModifier')
            expectEqual(interceptOffered(failing), 1, 'intercept while the block fails')

            // The block attempt would succeed: stealth is needed, intercept is not
            const succeeding = setup()
            attemptBlock(succeeding, true)
            expectEqual(stealthOffered(succeeding) > 0, true, 'stealth while the block succeeds')
            decideWith(succeeding.gameState, succeeding.bleeder, 'noModifier')
            expectEqual(interceptOffered(succeeding), 0, 'intercept while the block succeeds')
        },
    },
    {
        name: 'Life in the City is offered once per ready vampire below capacity, and gives the chosen one 1 blood',
        run() {
            const turn = createLifeInTheCityTurn([1, 1])
            const [first, second] = turn.vampires
            expectEqual(optionsOfType(turn.decision.options, 'playMaster').length, 2, 'options')
            second.blood = second.minionAttrs.capacity
            const decision = getDecisionPoint(turn.gameState, turn.player)
            if (!decision) {
                throw new ScenarioFailure('No decision point')
            }
            const options = optionsOfType(decision.options, 'playMaster')
            expectEqual(options.length, 1, 'options: the full vampire is not a target')
            expectEqual(options[0].target, first, 'target')
            applyOption(decision, options[0])
            expectEqual(first.blood, 2, 'blood of the target')
            expectEqual(second.blood, second.minionAttrs.capacity, 'blood of the other')
            expectEqual(
                turn.gameState.turnResources.mpa,
                1,
                'master phase action: a trifle gives it back',
            )
        },
    },
    {
        name: 'Life in the City is not offered when no ready vampire can gain blood',
        run() {
            const turn = createLifeInTheCityTurn([1, 1])
            for (const vampire of turn.vampires) {
                vampire.blood = vampire.minionAttrs.capacity
            }
            const decision = getDecisionPoint(turn.gameState, turn.player)
            if (!decision) {
                throw new ScenarioFailure('No decision point')
            }
            expectEqual(optionsOfType(decision.options, 'playMaster').length, 0, 'options')
        },
    },
    {
        name: 'Trifle: a master card is one when its first line says so, "Master: unique trifle." included',
        run() {
            const deck = <DeckList>{ ...MINION_TAP_DECK, '102113': 1, '100691': 1 }
            const { gameState } = createHeadlessGame([deck, deck])
            createdGames.push(gameState)
            const player = gameState.activePlayer
            if (!player) {
                throw new ScenarioFailure('No active player')
            }
            const isTrifle = (krcgId: string) => findHeldCard(player, krcgId).isTrifle
            expectEqual(isTrifle(LIFE_IN_THE_CITY_ID), true, 'Life in the City ( Trifle. )')
            expectEqual(isTrifle(WIDER_VIEW_ID), true, 'Wider View')
            expectEqual(isTrifle('102113'), true, 'Vessel')
            expectEqual(isTrifle('100691'), true, 'Failsafe ( Master: unique trifle. )')
            expectEqual(isTrifle(ELDER_LIBRARY_ID), false, 'Elder Library')
            expectEqual(isTrifle(MINION_TAP_ID), false, 'Minion Tap')
            expectEqual(isTrifle('100199'), false, 'Blood Doll')
        },
    },
    {
        name: 'Trifle: the first one gives its master phase action back, a second one is a regular master card',
        run() {
            const turn = createTrifleTurn()
            const { gameState, trifles } = turn
            const [first, second] = trifles
            expectEqual(gameState.turnResources.mpa, 1, 'master phase action before')

            playMasterCard(turn, first)
            expectEqual(
                gameState.turnResources.mpa,
                1,
                'master phase action after the first trifle',
            )
            expectEqual(gameState.turnResources.trifleGained, true, 'the extra action is taken')
            expectEqual(countMasterOptions(turn) > 0, true, 'a master card can still be played')

            playMasterCard(turn, second)
            expectEqual(gameState.turnResources.mpa, 0, 'a second trifle uses the action')
            expectEqual(countMasterOptions(turn), 0, 'no master card is offered any more')
        },
    },
    {
        name: 'Trifle: played after a regular master card, it needs an action that is no longer there',
        run() {
            const turn = createTrifleTurn()
            const { gameState, tap } = turn
            playMasterCard(turn, tap)
            expectEqual(gameState.turnResources.mpa, 0, 'master phase action')
            expectEqual(gameState.turnResources.trifleGained, false, 'no trifle played')
            expectEqual(countMasterOptions(turn), 0, 'the trifles are not offered')
        },
    },
    {
        name: 'Trifle: a regular master card follows the first trifle, then nothing more',
        run() {
            const turn = createTrifleTurn()
            const { gameState, tap, trifles } = turn
            playMasterCard(turn, trifles[0])
            playMasterCard(turn, tap)
            expectEqual(gameState.turnResources.mpa, 0, 'master phase action')
            expectEqual(countMasterOptions(turn), 0, 'no master card is offered any more')
        },
    },
    {
        name: 'Trifle: the extra action is once per master phase, refused twice and given back on the next turn',
        run() {
            const turn = createTrifleTurn()
            const { gameState, player } = turn
            playMasterCard(turn, turn.trifles[0])
            mustRefuse(
                botMutations.spendMasterPhaseAction.act(player, { player, trifle: true }),
                'second extra action',
            )
            gameState.setNewTurnResources()
            expectEqual(gameState.turnResources.trifleGained, false, 'next turn')
            expectEqual(gameState.turnResources.mpa, 1, 'master phase action next turn')
        },
    },
    {
        name: 'Minion Tap is offered per vampire with blood and per amount, torpor included, and moves the chosen amount to the pool',
        run() {
            const turn = createLifeInTheCityTurn([3, 0], MINION_TAP_ID)
            const [full, empty] = turn.vampires
            const [late] = [readyVampire(turn.gameState, turn.player, 2)]
            turn.gameState.moveCardToRegion(late, turn.player.torpor)
            const offered = () => {
                const decision = getDecisionPoint(turn.gameState, turn.player)
                if (!decision) {
                    throw new ScenarioFailure('No decision point')
                }
                return { decision, options: optionsOfType(decision.options, 'playMaster') }
            }
            const { decision, options } = offered()
            expectEqual(
                options
                    .map(
                        option =>
                            `${option.target?.oid == full.oid ? 'full' : 'late'}${option.amount}`,
                    )
                    .join(),
                'full1,full2,full3,late1,late2',
                'one option per amount, none for the empty vampire, one for the one in torpor',
            )
            expectEqual(
                options.some(option => option.target == empty),
                false,
                'the empty vampire is not a target',
            )
            const pool = turn.player.pool
            const two = options.find(option => option.target == full && option.amount == 2)
            if (!two) {
                throw new ScenarioFailure('No option for 2')
            }
            applyOption(decision, two)
            expectEqual(full.blood, 1, 'the vampire lost the blood')
            expectEqual(turn.player.pool, pool + 2, 'the pool gained it')
            expectEqual(turn.gameState.turnResources.mpa, 0, 'master phase action')
            expectEqual(turn.card.isIn.hand, false, 'the card is played')
        },
    },
    {
        name: 'Minion Tap is not offered when no vampire has blood, and moves only blood the vampire holds',
        run() {
            const turn = createLifeInTheCityTurn([0, 0], MINION_TAP_ID)
            const decision = getDecisionPoint(turn.gameState, turn.player)
            if (!decision) {
                throw new ScenarioFailure('No decision point')
            }
            expectEqual(optionsOfType(decision.options, 'playMaster').length, 0, 'options')

            const [vampire] = turn.vampires
            vampire.blood = 2
            const implementation = getMasterImplementation(turn.card, turn.player)
            if (!implementation) {
                throw new ScenarioFailure('No implementation')
            }
            expectEqual(implementation.applyPlayEffect(vampire, 3).isValid, false, 'too much')
            expectEqual(implementation.applyPlayEffect(vampire, 0).isValid, false, 'nothing')
            expectEqual(implementation.applyPlayEffect(vampire).isValid, false, 'no amount')
            expectEqual(vampire.blood, 2, 'nothing moved')
        },
    },
    {
        name: 'Villein is offered per vampire with blood and per amount ( 2 to 5, less for a vampire that holds less ), torpor included, and is put on the vampire it drains',
        run() {
            const turn = createLifeInTheCityTurn([6, 1, 0], VILLEIN_ID, VILLEIN_DECK)
            const [full, one, empty] = turn.vampires
            const late = readyVampire(turn.gameState, turn.player, 3)
            turn.gameState.moveCardToRegion(late, turn.player.torpor)
            const name = (vampire: Minion | undefined) =>
                [
                    [full, 'full'],
                    [one, 'one'],
                    [late, 'late'],
                ].find(([candidate]) => candidate == vampire)?.[1]
            const decision = getDecisionPoint(turn.gameState, turn.player)
            if (!decision) {
                throw new ScenarioFailure('No decision point')
            }
            const options = optionsOfType(decision.options, 'playMaster')
            expectEqual(
                options
                    .map(option => `${name(option.target)}${option.amount}`)
                    .toSorted()
                    .join(),
                'full2,full3,full4,full5,late2,late3,one1',
                'one option per amount, none for the empty vampire',
            )
            expectEqual(
                options.some(option => option.target == empty),
                false,
                'the empty vampire is not a target',
            )
            const pool = turn.player.pool
            const four = options.find(option => option.target == full && option.amount == 4)
            if (!four) {
                throw new ScenarioFailure('No option for 4')
            }
            applyOption(decision, four)
            expectEqual(full.blood, 2, 'the vampire lost the blood')
            expectEqual(turn.player.pool, pool + 4, 'the pool gained it')
            expectEqual(turn.card.isIn.hand, false, 'the card is played')
            expectEqual(
                getAttachedCards(full).includes(turn.card),
                true,
                'the card stays on the vampire',
            )
        },
    },
    {
        name: 'Villein costs 1 pool for each Villein already on the vampire, and so does a Minion Tap played on it',
        run() {
            const [tapped, plain] = [0, 1]
            const play = (pool: number, onFirst: number, cardId: string, which: number) => {
                const turn = createLifeInTheCityTurn([6, 6], VILLEIN_ID, VILLEIN_DECK)
                const { gameState, player } = turn
                const tap = giveCard(gameState, player, MINION_TAP_ID)
                const others = [...player.library.cards, ...player.hand.cards].filter(
                    (card): card is LibraryCard =>
                        card instanceof LibraryCard &&
                        card.krcgId == VILLEIN_ID &&
                        card != turn.card,
                )
                for (const villein of others.slice(0, onFirst)) {
                    attachInPlay(villein, turn.vampires[tapped])
                }
                player.pool = pool
                const decision = getDecisionPoint(gameState, player)
                if (!decision) {
                    throw new ScenarioFailure('No decision point')
                }
                const card = cardId == VILLEIN_ID ? turn.card : tap
                const option = optionsOfType(decision.options, 'playMaster').find(
                    candidate =>
                        candidate.card == card &&
                        candidate.target == turn.vampires[which] &&
                        candidate.amount == 3,
                )
                if (option) {
                    applyOption(decision, option)
                }
                return { offered: !!option, pool: player.pool, turn }
            }

            expectEqual(play(10, 0, VILLEIN_ID, tapped).pool, 13, 'a first Villein is free')
            const second = play(10, 1, VILLEIN_ID, tapped)
            expectEqual(second.pool, 12, 'the second one costs 1')
            expectEqual(
                getAttachedCards(second.turn.vampires[tapped]).length,
                2,
                'and is put on the vampire',
            )
            expectEqual(play(10, 2, VILLEIN_ID, tapped).pool, 11, 'the third one costs 2')
            expectEqual(play(10, 1, VILLEIN_ID, plain).pool, 13, 'a Villein on the other is free')
            expectEqual(play(10, 0, MINION_TAP_ID, tapped).pool, 13, 'a Minion Tap is free')
            expectEqual(
                play(10, 1, MINION_TAP_ID, tapped).pool,
                12,
                'with a Villein on it it costs 1',
            )
            expectEqual(play(10, 2, MINION_TAP_ID, tapped).pool, 11, 'and 2 with two')
            expectEqual(play(10, 2, MINION_TAP_ID, plain).pool, 13, 'but not on another vampire')

            // The cost is paid with the pool, down to what it leaves: the card gives pool at the same time
            const edge = play(1, 1, VILLEIN_ID, tapped)
            expectEqual(edge.offered, true, 'one pool pays the 1 of a second Villein')
            expectEqual(edge.pool, 3, 'and the 3 gained come with it')
            expectEqual(
                play(1, 2, VILLEIN_ID, tapped).offered,
                false,
                'a third Villein cannot be played with 1 pool',
            )
            expectEqual(play(2, 2, VILLEIN_ID, tapped).pool, 3, 'with 2 pool it can')
            expectEqual(
                play(1, 2, VILLEIN_ID, plain).offered,
                true,
                'on another vampire it is free',
            )
        },
    },
    {
        name: 'The Barrens: lock it to discard a card of the hand, which is drawn back up; not offered while locked',
        run() {
            const { gameState } = createHeadlessGame([MalkavDeck, MalkavDeck])
            createdGames.push(gameState)
            const player = gameState.activePlayer
            if (!player) {
                throw new ScenarioFailure('No active player')
            }
            const barrens = giveCard(gameState, player, BARRENS_ID)
            gameState.moveCardToRegion(barrens, player.ready)
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Master)
            gameState.turnResources.unlocked = true

            const decision = getDecisionPoint(gameState, player)
            if (!decision) {
                throw new ScenarioFailure('No decision point')
            }
            const options = optionsOfType(decision.options, 'lockEffect')
            expectEqual(options.length, player.hand.length, 'one option per card of the hand')
            const ashHeap = player.ashHeap.length
            applyOption(decision, options[0])
            expectEqual(barrens.isLocked, true, 'locked')
            expectEqual(player.ashHeap.length, ashHeap + 1, 'ash heap')
            expectEqual(player.hand.length, player.handSize, 'hand drawn back up')

            const next = getDecisionPoint(gameState, player)
            expectEqual(
                next ? optionsOfType(next.options, 'lockEffect').length : -1,
                0,
                'not offered while locked',
            )
        },
    },
    {
        name: 'Faceless Night superior locks the minion whose block fails, inferior does not',
        run() {
            for (const [level, locked] of [
                [DisciplineLevel.SUPERIOR, true],
                [DisciplineLevel.INFERIOR, false],
            ] as const) {
                const game = createCatalogBleed({
                    discipline: Discipline.Obfuscate,
                    level,
                    cards: [FACELESS_NIGHT_ID],
                })
                const { gameState, bleeder, blocker } = game
                blocker.minionAttrs.intercept = 0
                // The block attempt is as good as the stealth: one more stealth makes it fail
                attemptBlock(game, true)
                const decision = getDecisionPoint(gameState, bleeder)
                const played =
                    decision ?
                        modifierOptionsOf(decision, FACELESS_NIGHT_ID).find(
                            option => modifierLevel(option) == level,
                        )
                    :   undefined
                if (!decision || !played) {
                    throw new ScenarioFailure('Faceless Night is not offered')
                }
                applyOption(decision, played)
                expectEqual(blocker.isLocked, false, 'not locked yet, the block is not resolved')

                // Everybody passes until the action is over
                for (let i = 0; i < 12 && gameState.action; i++) {
                    const decider = getDecidingPlayer(gameState)
                    const next = decider && getDecisionPoint(gameState, decider)
                    // A standing block is kept: "no reaction" comes before "no block"
                    const pass = ['noModifier', 'noReaction', 'noBlock']
                        .map(type => next?.options.find(option => option.type == type))
                        .find(Boolean)
                    if (!next || !pass) {
                        throw new ScenarioFailure('Nobody can pass')
                    }
                    applyOption(next, pass)
                }
                expectEqual(gameState.action, null, 'the action is over')
                expectEqual(blocker.isLocked, locked, `blocker locked at ${level}`)
            }
        },
    },
    {
        name: 'Wider View: 1 transfer draws a crypt card and removes an uncontrolled one from the game',
        run() {
            const turn = createWiderViewTurn(2)
            const { gameState, player, decision } = turn
            const options = optionsOfType(decision.options, 'transferEffect').filter(
                option => option.ability == 0,
            )
            expectEqual(
                options.length,
                player.uncontrolled.length,
                'one removal option per uncontrolled card',
            )
            expectEqual(
                optionsOfType(decision.options, 'transferEffect').length,
                options.length,
                'the burn needs 4 transfers',
            )
            const removed = options[0].removed
            const crypt = player.crypt.length
            const uncontrolled = player.uncontrolled.length
            applyOption(decision, options[0])
            expectEqual(gameState.turnResources.transfers, 1, 'transfers')
            expectEqual(player.crypt.length, crypt - 1, 'crypt')
            expectEqual(player.uncontrolled.length, uncontrolled, 'uncontrolled: one in, one out')
            expectEqual(removed?.isIn.removed, true, 'removed from the game')
        },
    },
    {
        name: 'Wider View with no uncontrolled card removes the card drawn, 4 transfers burn it for 2 pool',
        run() {
            const turn = createWiderViewTurn(4)
            const { gameState, player, card } = turn
            for (const vampire of [...player.uncontrolled.cards]) {
                gameState.moveCardToRegion(vampire, player.crypt)
            }
            const decision = getDecisionPoint(gameState, player)
            if (!decision) {
                throw new ScenarioFailure('No decision point')
            }
            const draws = optionsOfType(decision.options, 'transferEffect').filter(
                option => option.ability == 0,
            )
            expectEqual(draws.length, 1, 'the card drawn is removed')
            expectEqual(draws[0].removed, undefined, 'no removal choice')
            const crypt = player.crypt.length
            applyOption(decision, draws[0])
            expectEqual(player.crypt.length, crypt - 1, 'crypt')
            expectEqual(player.removed.length, 1, 'removed from the game')
            expectEqual(player.uncontrolled.length, 0, 'nothing uncontrolled')

            const next = getDecisionPoint(gameState, player)
            const burn = next?.options.filter(
                option => option.type == 'transferEffect' && option.ability == 1,
            )
            expectEqual(burn?.length, 0, 'burn: 3 transfers left, 4 needed')
            gameState.turnResources.transfers = 4
            const again = getDecisionPoint(gameState, player)
            const burns = again ? optionsOfType(again.options, 'transferEffect') : []
            const burning = burns.find(option => option.ability == 1)
            if (!again || !burning) {
                throw new ScenarioFailure('The burn is not offered with 4 transfers')
            }
            const pool = player.pool
            applyOption(again, burning)
            expectEqual(gameState.turnResources.transfers, 0, 'transfers')
            expectEqual(player.pool, pool + 2, 'pool')
            expectEqual(card.isIn.ashHeap, true, 'burned')
        },
    },
    {
        name: 'Cloak the Gathering superior is played by another ready vampire, which gives the action +1 stealth',
        run() {
            const game = createCatalogBleed({
                discipline: Discipline.Dominate,
                level: DisciplineLevel.INFERIOR,
                cards: [CLOAK_ID],
            })
            const other = readyVampire(game.gameState, game.bleeder, 4)
            other.minionAttrs.disciplines[Discipline.Obfuscate] = DisciplineLevel.SUPERIOR
            other.lock()
            attemptBlock(game, true)
            const decision = passUntilDecides(game.gameState, game.bleeder)
            const options = modifierOptionsOf(decision, CLOAK_ID)
            const byOther = options.filter(option => option.modifier.by == other)
            expectEqual(byOther.length, 1, 'options by the other vampire')
            expectEqual(
                options.some(option => option.modifier.by == undefined),
                true,
                'the acting minion plays the inferior level',
            )
            const before = game.gameState.action?.stealth ?? 0
            applyOption(decision, byOther[0])
            expectEqual(game.gameState.action?.stealth, before + 1, 'stealth')
            expectEqual(other.isLocked, true, 'the locked vampire stays locked')
        },
    },
    {
        name: 'Cloak the Gathering superior is not offered to the acting minion, nor to a vampire with the inferior level only',
        run() {
            const game = createCatalogBleed({
                discipline: Discipline.Obfuscate,
                level: DisciplineLevel.SUPERIOR,
                cards: [CLOAK_ID],
            })
            const other = readyVampire(game.gameState, game.bleeder, 4)
            other.minionAttrs.disciplines[Discipline.Obfuscate] = DisciplineLevel.INFERIOR
            attemptBlock(game, true)
            const decision = passUntilDecides(game.gameState, game.bleeder)
            const options = modifierOptionsOf(decision, CLOAK_ID)
            expectEqual(options.length, 1, 'options')
            expectEqual(options[0].modifier.by, undefined, 'played by the acting minion')
            expectEqual(modifierLevel(options[0]), DisciplineLevel.INFERIOR, 'level')
        },
    },
    {
        name: 'Swallowed by the Night is a maneuver in combat at superior, and nothing at inferior',
        run() {
            for (const [level, offered] of [
                [DisciplineLevel.SUPERIOR, true],
                [DisciplineLevel.INFERIOR, false],
            ] as const) {
                const fight = createFight(3, 3, MalkavDeck)
                fight.acting.minionAttrs.disciplines[Discipline.Obfuscate] = level
                const card = giveCard(fight.gameState, fight.actingPlayer, SWALLOWED_ID)
                passUntil(fight, CombatStep.DetermineRange)
                const decision = getCombatDecision(fight, fight.actingPlayer)
                const maneuvers = optionsOfType(decision.options, 'combatManeuver').filter(
                    option => option.card == card,
                )
                expectEqual(maneuvers.length, offered ? 1 : 0, `maneuver at ${level}`)
            }
        },
    },
    {
        name: 'Telepathic Misdirection inferior adds intercept, only while the own block attempt stands',
        run() {
            const game = createCatalogBleed({
                discipline: Discipline.Dominate,
                level: DisciplineLevel.INFERIOR,
                cards: [],
                preyCards: [TELEPATHIC_ID],
                preyDiscipline: [Discipline.Auspex, DisciplineLevel.INFERIOR],
            })
            const { gameState, bleeder, bled, blocker } = game
            const first = passUntilDecides(gameState, bled)
            expectEqual(optionsOfType(first.options, 'playReaction').length, 0, 'before the block')

            attemptBlock(game, false)
            decideWith(gameState, bleeder, 'noModifier')
            const decision = getDecisionPoint(gameState, bled)
            const reactions = decision ? optionsOfType(decision.options, 'playReaction') : []
            expectEqual(reactions.length, 1, 'reaction options')
            const before = gameState.action?.intercept ?? 0
            if (decision) {
                applyOption(decision, reactions[0])
            }
            expectEqual(gameState.action?.intercept, before + 1, 'intercept')
            expectEqual(blocker.blood, 2, 'blood paid')
        },
    },
    {
        name: 'Telepathic Misdirection superior bounces the bleed like Deflection and locks the vampire',
        run() {
            const game = createCatalogBleed({
                discipline: Discipline.Dominate,
                level: DisciplineLevel.INFERIOR,
                cards: [],
                preyCards: [TELEPATHIC_ID],
                preyDiscipline: [Discipline.Auspex, DisciplineLevel.SUPERIOR],
            })
            const { gameState, bled, third, blocker } = game
            // The prey declines to block, then the bounce is possible
            const first = passUntilDecides(gameState, bled)
            applyOption(first, findOption(first.options, 'noBlock'))
            const decision = passUntilDecides(gameState, bled)
            const options = optionsOfType(decision.options, 'playReaction')
            const bounce = options.find(
                option => option.effect.type == 'changeTarget' && option.effect.target == third,
            )
            if (!bounce) {
                throw new ScenarioFailure('The bounce is not offered')
            }
            applyOption(decision, bounce)
            expectEqual(gameState.action?.minionAction.target, third, 'new target')
            expectEqual(blocker.isLocked, true, 'locked')
        },
    },
    {
        name: 'On the Qui Vive wakes a locked minion, which can then attempt to block',
        run() {
            const game = createCatalogBleed({
                discipline: Discipline.Dominate,
                level: DisciplineLevel.INFERIOR,
                cards: [],
                preyCards: [QUI_VIVE_ID],
            })
            const { gameState, bled, blocker } = game
            blocker.lock()
            const decision = passUntilDecides(gameState, bled)
            expectEqual(
                optionsOfType(decision.options, 'block').length,
                0,
                'a locked minion cannot block',
            )
            const wakes = optionsOfType(decision.options, 'playReaction').filter(
                option => option.effect.type == 'wake' && option.minion == blocker,
            )
            expectEqual(wakes.length, 1, 'wake options')
            applyOption(decision, wakes[0])
            expectEqual(blocker.isLocked, true, 'still locked')
            expectEqual(
                gameState.playedSinceUnlock[blocker.oid]?.includes(QUI_VIVE_ID),
                true,
                'the play is remembered',
            )

            const next = passUntilDecides(gameState, bled)
            expectEqual(
                optionsOfType(next.options, 'block').filter(option => option.minion == blocker)
                    .length,
                1,
                'the woken minion can block',
            )
            expectEqual(
                optionsOfType(next.options, 'playReaction').length,
                0,
                'no second wake for the same minion',
            )
        },
    },
    {
        name: 'On the Qui Vive is for locked minions only, once between unlock phases',
        run() {
            const game = createCatalogBleed({
                discipline: Discipline.Dominate,
                level: DisciplineLevel.INFERIOR,
                cards: [],
                preyCards: [QUI_VIVE_ID],
            })
            const { gameState, bled, blocker } = game
            const wakeOptions = (decision: DecisionPoint) =>
                optionsOfType(decision.options, 'playReaction').filter(
                    option => option.effect.type == 'wake',
                )
            expectEqual(
                wakeOptions(passUntilDecides(gameState, bled)).length,
                0,
                'an unlocked minion',
            )

            blocker.lock()
            gameState.playedSinceUnlock[blocker.oid] = [QUI_VIVE_ID]
            expectEqual(
                wakeOptions(passUntilDecides(gameState, bled)).length,
                0,
                'already played since the unlock phase',
            )

            gameMutations.unlockAll.act(bled, { player: bled })
            expectEqual(gameState.playedSinceUnlock[blocker.oid], undefined, 'forgotten at unlock')
        },
    },
    {
        name: 'Eyes of Argus superior wakes a locked vampire, inferior adds 2 intercept to an unlocked blocker',
        run() {
            const woken = createCatalogBleed({
                discipline: Discipline.Dominate,
                level: DisciplineLevel.INFERIOR,
                cards: [],
                preyCards: [EYES_OF_ARGUS_ID],
                preyDiscipline: [Discipline.Auspex, DisciplineLevel.SUPERIOR],
            })
            woken.blocker.lock()
            const decision = passUntilDecides(woken.gameState, woken.bled)
            const reactions = optionsOfType(decision.options, 'playReaction')
            expectEqual(reactions.length, 1, 'options for a locked vampire')
            expectEqual(reactions[0].effect.type, 'wake', 'the only thing it can do is wake')

            const inferior = createCatalogBleed({
                discipline: Discipline.Dominate,
                level: DisciplineLevel.INFERIOR,
                cards: [],
                preyCards: [EYES_OF_ARGUS_ID],
                preyDiscipline: [Discipline.Auspex, DisciplineLevel.INFERIOR],
            })
            const { gameState, bleeder, bled } = inferior
            const first = passUntilDecides(gameState, bled)
            expectEqual(optionsOfType(first.options, 'playReaction').length, 0, 'before the block')
            attemptBlock(inferior, false)
            decideWith(gameState, bleeder, 'noModifier')
            const standing = getDecisionPoint(gameState, bled)
            const intercepts = standing ? optionsOfType(standing.options, 'playReaction') : []
            expectEqual(intercepts.length, 1, 'options during the block')
            const before = gameState.action?.intercept ?? 0
            if (standing) {
                applyOption(standing, intercepts[0])
            }
            expectEqual(gameState.action?.intercept, before + 2, 'intercept')
        },
    },
]
