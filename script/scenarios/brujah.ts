import { LibraryCard } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { createCombatState, createHandStrike } from '@/shared/state/combatState.ts'
import {
    MinionActionType,
    LibraryCardUsage,
    CombatStep,
    CombatRange,
} from '@/shared/types/state.ts'
import { DisciplineLevel, Discipline, TurnSequence, TurnPhase } from '@/shared/const/model.ts'
import { Disciplines } from '@/shared/types/resources.ts'
import { findOption } from '@/shared/bot/helpers.ts'
import { createHeadlessGame } from '../harness.ts'
import { BrujahDeck } from '@/shared/bot/decks.ts'
import { applyOption, getDecisionPoint, getDecidingPlayer } from '@/shared/bot/referee.ts'
import { CombatCardOption, optionsOfType } from '@/shared/bot/types.ts'
import {
    Fight,
    Scenario,
    ScenarioFailure,
    createFight,
    createdGames,
    expectEqual,
    expectRegion,
    getCombat,
    giveCard,
    passUntil,
    readySpecific,
} from './helpers.ts'
import { emptyHand, sealLibrary } from './bounce.ts'
import { getCombatDecision } from './combatCards.ts'
import { MasterTurn, countMasterOptions, countUnlockEffects, getMasterDecision } from './master.ts'
import { createCatalogBleed, modifierOptionsOf, passUntilDecides } from './catalog.ts'
import { createMinionPhase, getActionOptions, resolveAction } from './torpor.ts'
import {
    ATIENA_ID,
    BAIT_AND_SWITCH_ID,
    ENCHANT_KINDRED_ID,
    MONKEY_WRENCH_ID,
    OCTANE_ID,
    RAYNE_ID,
    ROUNDHOUSE_ID,
    SLAM_ID,
    TORN_SIGNPOST_ID,
    VALERIYA_ID,
    WARZONE_ID,
} from '../cardIds.ts'

/**
 * Cards described in the catalog ( the Brujah precon ): requirements of the cardbase, variable
 * costs, combat cards.
 */

// A fight between two Brujah in the first round, the acting one holding the card
export function createBrujahFight(
    cardId: string,
    level: DisciplineLevel | null,
    actingBlood = 3,
    discipline = Discipline.Potence,
    deck = BrujahDeck,
): Fight & { card: LibraryCard } {
    const fight = createFight(actingBlood, 3, deck)
    // The vampire drawn may have a strength bonus (Valeriya, Theo Bell)
    fight.acting.minionAttrs.strength = 1
    getCombat(fight).acting.strength = 1
    fight.acting.minionAttrs.capacity = 10
    fight.acting.minionAttrs.disciplines = {} as Disciplines
    fight.defending.minionAttrs.strength = 1
    getCombat(fight).defending.strength = 1
    if (level) {
        fight.acting.minionAttrs.disciplines[discipline] = level
    }
    // A controlled hand: the card only, and nothing to draw
    emptyHand(fight.gameState, fight.actingPlayer)
    emptyHand(fight.gameState, fight.defendingPlayer)
    const card = giveCard(fight.gameState, fight.actingPlayer, cardId)
    sealLibrary(fight.gameState, fight.actingPlayer)
    sealLibrary(fight.gameState, fight.defendingPlayer)
    return { ...fight, card }
}

// The options of the acting player that come with the card
export function cardOptionsOf<T extends CombatCardOption['type']>(
    fight: Fight,
    type: T,
    card: LibraryCard,
): Extract<CombatCardOption, { type: T }>[] {
    return getCombatDecision(fight, fight.actingPlayer).options.filter(
        (option): option is Extract<CombatCardOption, { type: T }> =>
            option.type == type && 'card' in option && option.card == card,
    )
}

// Plays the card with the first of its options of the type that the test accepts
export function playCardOption<T extends CombatCardOption['type']>(
    fight: Fight,
    type: T,
    card: LibraryCard,
    accept: (option: Extract<CombatCardOption, { type: T }>) => boolean = () => true,
): void {
    const decision = getCombatDecision(fight, fight.actingPlayer)
    const option = decision.options.find(
        (candidate): candidate is Extract<CombatCardOption, { type: T }> =>
            candidate.type == type &&
            'card' in candidate &&
            candidate.card == card &&
            accept(candidate as Extract<CombatCardOption, { type: T }>),
    )
    if (!option) {
        throw new ScenarioFailure(`${type} of ${card.name} is not offered`)
    }
    applyOption(decision, option)
}

// The master phase of a player holding Warzone Hunting Ground as their only card
export function createWarzoneTurn(cardId = WARZONE_ID): MasterTurn & { warzone: LibraryCard } {
    const { gameState } = createHeadlessGame([BrujahDeck, BrujahDeck])
    createdGames.push(gameState)
    const player = gameState.activePlayer
    if (!player) {
        throw new ScenarioFailure('No active player')
    }
    emptyHand(gameState, player)
    const warzone = giveCard(gameState, player, cardId)
    gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Master)
    gameState.turnResources.unlocked = true
    return { gameState, player, library: warzone, warzone }
}

export const BRUJAH_SCENARIOS: Scenario[] = [
    {
        name: 'Monkey Wrench is offered for X = 1, 2 and 3 to an Anarch, as many as its blood allows',
        run() {
            const game = createCatalogBleed({
                deck: BrujahDeck,
                bleederId: OCTANE_ID,
                discipline: Discipline.Presence,
                level: DisciplineLevel.SUPERIOR,
                cards: [MONKEY_WRENCH_ID],
            })
            passUntilDecides(game.gameState, game.bleeder)
            const xsAt = (blood: number) => {
                game.bleeding.blood = blood
                const decision = getDecisionPoint(game.gameState, game.bleeder)
                if (!decision) {
                    throw new ScenarioFailure('No decision point')
                }
                return modifierOptionsOf(decision, MONKEY_WRENCH_ID)
                    .map(option => option.modifier.usage.x)
                    .join()
            }
            expectEqual(xsAt(5), '1,2,3', 'X')
            expectEqual(xsAt(2), '1,2', 'X with 2 blood')
            expectEqual(xsAt(0), '', 'X with no blood')
        },
    },
    {
        name: 'Monkey Wrench pays X blood and adds X bleed, and needs an Anarch',
        run() {
            const game = createCatalogBleed({
                deck: BrujahDeck,
                bleederId: OCTANE_ID,
                discipline: Discipline.Presence,
                level: DisciplineLevel.SUPERIOR,
                cards: [MONKEY_WRENCH_ID],
            })
            const decision = passUntilDecides(game.gameState, game.bleeder)
            const three = modifierOptionsOf(decision, MONKEY_WRENCH_ID).find(
                option => option.modifier.usage.x == 3,
            )
            if (!three) {
                throw new ScenarioFailure('X = 3 is not offered')
            }
            const before = game.gameState.action?.bleed ?? 0
            applyOption(decision, three)
            expectEqual(game.gameState.action?.bleed, before + 3, 'bleed')
            expectEqual(game.bleeding.blood, 2, 'blood paid')

            const outsider = createCatalogBleed({
                deck: BrujahDeck,
                bleederId: OCTANE_ID,
                discipline: Discipline.Presence,
                level: DisciplineLevel.SUPERIOR,
                cards: [MONKEY_WRENCH_ID],
            })
            outsider.bleeding.vampireAttrs.sect = 'Camarilla'
            expectEqual(
                modifierOptionsOf(
                    passUntilDecides(outsider.gameState, outsider.bleeder),
                    MONKEY_WRENCH_ID,
                ).length,
                0,
                'a Camarilla vampire',
            )
        },
    },
    {
        name: 'Bait and Switch needs a baron: the bounce locks the baron, no offer for a plain Anarch',
        run() {
            const baron = createCatalogBleed({
                deck: BrujahDeck,
                discipline: Discipline.Presence,
                level: DisciplineLevel.SUPERIOR,
                cards: [],
                preyCards: [BAIT_AND_SWITCH_ID],
                preyVampireId: ATIENA_ID,
            })
            const { gameState, bled, third, blocker } = baron
            const first = passUntilDecides(gameState, bled)
            applyOption(first, findOption(first.options, 'noBlock'))
            const decision = passUntilDecides(gameState, bled)
            const bounce = optionsOfType(decision.options, 'playReaction').find(
                option => option.effect.type == 'changeTarget' && option.effect.target == third,
            )
            if (!bounce) {
                throw new ScenarioFailure('The bounce is not offered to a baron')
            }
            applyOption(decision, bounce)
            expectEqual(gameState.action?.minionAction.target, third, 'new target')
            expectEqual(blocker.isLocked, true, 'locked')

            const anarch = createCatalogBleed({
                deck: BrujahDeck,
                discipline: Discipline.Presence,
                level: DisciplineLevel.SUPERIOR,
                cards: [],
                preyCards: [BAIT_AND_SWITCH_ID],
                preyVampireId: RAYNE_ID,
            })
            const firstAnarch = passUntilDecides(anarch.gameState, anarch.bled)
            applyOption(firstAnarch, findOption(firstAnarch.options, 'noBlock'))
            const next = passUntilDecides(anarch.gameState, anarch.bled)
            expectEqual(
                optionsOfType(next.options, 'playReaction').length,
                0,
                'reactions for an Anarch that is not a baron',
            )
        },
    },
    {
        name: 'Enchant Kindred: a bleed at inferior, blood for a younger uncontrolled vampire at superior',
        run() {
            const turn = createMinionPhase(5, 0, BrujahDeck)
            turn.ready.minionAttrs.disciplines[Discipline.Presence] = DisciplineLevel.SUPERIOR
            turn.ready.minionAttrs.capacity = 6
            const young = turn.player.vampiresInUncontrolled[0]
            young.minionAttrs.capacity = 4
            young.blood = 1
            const card = giveCard(turn.gameState, turn.player, ENCHANT_KINDRED_ID)

            const { decision, options } = getActionOptions(
                turn,
                MinionActionType.ActionCardFromHand,
            )
            const mine = options.flatMap(option =>
                (
                    option.action.type == MinionActionType.ActionCardFromHand &&
                    option.action.card == card
                ) ?
                    [{ option, usage: option.action.usage }]
                :   [],
            )
            const level = (usage: LibraryCardUsage) => usage.disciplines?.[0]?.level
            const bleeds = mine.filter(({ usage }) => usage.target instanceof Player)
            expectEqual(bleeds.length, 1, 'bleed options')
            expectEqual(level(bleeds[0].usage), DisciplineLevel.INFERIOR, 'bleed level')
            const feed = mine.find(({ usage }) => usage.target == young)
            if (!feed) {
                throw new ScenarioFailure('The younger vampire is not a target')
            }
            expectEqual(level(feed.usage), DisciplineLevel.SUPERIOR, 'feed level')

            applyOption(decision, feed.option)
            resolveAction(turn)
            expectEqual(young.blood, 3, 'blood of the younger vampire')
        },
    },
    {
        name: 'Warzone Hunting Ground requires a ready Brujah and gives 1 blood in the unlock phase',
        run() {
            const turn = createWarzoneTurn()
            const { gameState, player, warzone } = turn
            expectEqual(countMasterOptions(turn), 0, 'no ready vampire')

            const octane = readySpecific(gameState, player, OCTANE_ID, 2)
            expectEqual(countMasterOptions(turn), 1, 'a ready Brujah')
            octane.vampireAttrs.clan = 'Malkavian'
            expectEqual(countMasterOptions(turn), 0, 'a ready Malkavian')
            octane.vampireAttrs.clan = 'Brujah'

            gameState.moveCardToRegion(warzone, player.ready)
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Unlock)
            expectEqual(countUnlockEffects(turn), 1, 'unlock effects')
            const decision = getMasterDecision(turn)
            applyOption(decision, findOption(decision.options, 'unlockEffect'))
            expectEqual(octane.blood, 3, 'blood gained')
        },
    },
    {
        name: 'Valeriya Zinovieva has +1 strength, which her hand strike deals',
        run() {
            const { gameState, players } = createHeadlessGame([BrujahDeck, BrujahDeck])
            createdGames.push(gameState)
            const valeriya = readySpecific(gameState, players[0], VALERIYA_ID, 5)
            const opponent = readySpecific(gameState, players[1], RAYNE_ID, 2)
            expectEqual(valeriya.minionAttrs.strength, 2, 'strength')
            expectEqual(opponent.minionAttrs.strength, 1, 'strength of a plain Anarch')
            gameState.combat = createCombatState(valeriya, opponent)
            expectEqual(
                createHandStrike(createCombatState(valeriya, opponent).acting).damage,
                2,
                'damage',
            )
        },
    },
    {
        name: 'Torn Signpost sets the strength before the range only, and only when it raises it',
        run() {
            const fight = createBrujahFight(TORN_SIGNPOST_ID, DisciplineLevel.SUPERIOR)
            const options = cardOptionsOf(fight, 'combatStrength', fight.card)
            expectEqual(options.map(option => option.amount).join(), '2,3', 'both levels')

            getCombat(fight).acting.strength = 2
            expectEqual(
                cardOptionsOf(fight, 'combatStrength', fight.card)
                    .map(option => option.amount)
                    .join(),
                '3',
                'a strength of 2 already',
            )

            getCombat(fight).acting.strength = 1
            playCardOption(fight, 'combatStrength', fight.card, option => option.amount == 3)
            expectEqual(getCombat(fight).acting.strength, 3, 'strength')
            expectEqual(getCombat(fight).step, CombatStep.BeforeRange, 'still before the range')
            expectEqual(getCombat(fight).impulsePlayer, fight.actingPlayer, 'impulse')
            expectEqual(fight.card.isIn.ready, true, 'the card is played')

            passUntil(fight, CombatStep.DetermineRange)
            expectEqual(
                cardOptionsOf(fight, 'combatStrength', fight.card).length,
                0,
                'in the range step',
            )
        },
    },
    {
        name: 'Torn Signpost strength lasts the combat: the hand strike deals it',
        run() {
            const fight = createBrujahFight(TORN_SIGNPOST_ID, DisciplineLevel.INFERIOR, 3)
            playCardOption(fight, 'combatStrength', fight.card)
            passUntil(fight, CombatStep.Strike)
            const decision = getCombatDecision(fight, fight.actingPlayer)
            const hand = optionsOfType(decision.options, 'combatStrike').find(
                option => !option.card,
            )
            expectEqual(hand?.strike.damage, 2, 'hand strike damage')
        },
    },
    {
        name: 'Roundhouse is a hand strike with 2 damage more at inferior, 3 at superior',
        run() {
            const inferior = createBrujahFight(ROUNDHOUSE_ID, DisciplineLevel.INFERIOR)
            passUntil(inferior, CombatStep.Strike)
            const options = cardOptionsOf(inferior, 'combatStrike', inferior.card)
            expectEqual(options.length, 1, 'inferior options')
            expectEqual(options[0].strike.damage, 3, 'inferior damage')
            expectEqual(options[0].strike.aggravated, false, 'aggravated')

            const superior = createBrujahFight(ROUNDHOUSE_ID, DisciplineLevel.SUPERIOR)
            passUntil(superior, CombatStep.Strike)
            const damages = cardOptionsOf(superior, 'combatStrike', superior.card)
                .map(option => option.strike.damage)
                .sort()
            expectEqual(damages.join(), '3,4', 'superior damages')
        },
    },
    {
        name: 'a Roundhouse strike deals its damage: more than the blood sends the vampire to torpor',
        run() {
            const fight = createBrujahFight(ROUNDHOUSE_ID, DisciplineLevel.SUPERIOR)
            passUntil(fight, CombatStep.Strike)
            playCardOption(fight, 'combatStrike', fight.card, option => option.strike.damage == 4)
            const decision = getCombatDecision(fight, fight.defendingPlayer)
            applyOption(decision, findOption(decision.options, 'combatStrike'))
            while (fight.gameState.combat) {
                const player = getDecidingPlayer(fight.gameState)
                const next = player && getDecisionPoint(fight.gameState, player)
                if (!next) {
                    throw new ScenarioFailure('The combat is stuck')
                }
                applyOption(next, findOption(next.options, 'combatPass'))
            }
            expectRegion(fight.defending, 'torpor')
        },
    },
    {
        name: 'Slam costs 1 blood; at superior its maneuver is only offered at long range, and brings the strike',
        run() {
            const inferior = createBrujahFight(SLAM_ID, DisciplineLevel.INFERIOR)
            getCombat(inferior).range = CombatRange.Long
            passUntil(inferior, CombatStep.DetermineRange)
            expectEqual(
                cardOptionsOf(inferior, 'combatManeuver', inferior.card).length,
                0,
                'maneuver at inferior',
            )
            passUntil(inferior, CombatStep.Strike)
            expectEqual(
                cardOptionsOf(inferior, 'combatStrike', inferior.card)[0]?.strike.damage,
                3,
                'inferior damage',
            )

            const close = createBrujahFight(SLAM_ID, DisciplineLevel.SUPERIOR)
            passUntil(close, CombatStep.DetermineRange)
            expectEqual(
                cardOptionsOf(close, 'combatManeuver', close.card).length,
                0,
                'maneuver at close range',
            )

            const far = createBrujahFight(SLAM_ID, DisciplineLevel.SUPERIOR)
            passUntil(far, CombatStep.DetermineRange)
            getCombat(far).range = CombatRange.Long
            const maneuvers = cardOptionsOf(far, 'combatManeuver', far.card)
            expectEqual(maneuvers.length, 1, 'maneuvers: the superior level only')
            playCardOption(far, 'combatManeuver', far.card)
            expectEqual(getCombat(far).range, CombatRange.Close, 'range')
            expectEqual(getCombat(far).acting.strike?.damage, 3, 'the maneuver chose the strike')
            expectEqual(far.acting.blood, 2, 'blood paid')
            expectEqual(far.card.isIn.ready, true, 'the card is played')
        },
    },
]
