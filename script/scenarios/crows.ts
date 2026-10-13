import { LibraryCard, Card } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { createDodgeStrike, createStrike } from '@/shared/state/combatState.ts'
import { MinionActionType, CombatStep } from '@/shared/types/state.ts'
import { DisciplineLevel, Discipline } from '@/shared/const/model.ts'
import { Disciplines } from '@/shared/types/resources.ts'
import { getHost } from '@/shared/state/attachments.ts'
import { getEnvironmentalDamage } from '@/shared/cardImpl/catalog/attached.ts'
import { CrowsDeck } from '../attachDeck.ts'
import { applyOption } from '@/shared/bot/referee.ts'
import { cardOptionsOf, createBrujahFight, playCardOption } from './brujah.ts'
import {
    Scenario,
    ScenarioFailure,
    attachInPlay,
    createFight,
    expectEqual,
    findCard,
    getCombat,
    giveCard,
    pass,
    passUntil,
    press,
    readyVampire,
    strikeRound,
    strikeRoundToEnd,
} from './helpers.ts'
import { createMinionPhase, getActionOptions, resolveAction } from './torpor.ts'
import { emptyHand } from './bounce.ts'
import { SPY_INFERIOR, createEquipTurn, equipOptions, levelOf } from './attachment.ts'

const CARRION_CROWS_ID = '100301'

const DEEP_SONG_ID = '100515'

export const MURDER_OF_CROWS_ID = '101254'

const createCrowsFight = (level: DisciplineLevel) =>
    createBrujahFight(CARRION_CROWS_ID, level, 3, Discipline.Animalism, CrowsDeck)

const crowsOptions = (fight: ReturnType<typeof createCrowsFight>) =>
    cardOptionsOf(fight, 'combatEnvironmentalDamage', fight.card)

// A second copy of the card, given to the acting player
function giveSecondCopy(fight: ReturnType<typeof createCrowsFight>): LibraryCard {
    const copy = fight.actingPlayer.removed.cards.find(
        card => card.krcgId == fight.card.krcgId && card != fight.card,
    )
    if (!(copy instanceof LibraryCard)) {
        throw new ScenarioFailure('No second copy')
    }
    fight.gameState.moveCardToRegion(copy, fight.actingPlayer.hand)
    return copy
}

// The minion phase of a player holding Deep Song, with a vampire of the prey in play
function createDeepSongTurn(level: DisciplineLevel) {
    const turn = createMinionPhase(5, 0, CrowsDeck)
    const { gameState, player } = turn
    const victim = player.prey
    if (!victim) {
        throw new ScenarioFailure('No prey')
    }
    turn.ready.minionAttrs.disciplines = { [Discipline.Animalism]: level } as Disciplines
    emptyHand(gameState, player)
    const card = giveCard(gameState, player, DEEP_SONG_ID)
    const target = readyVampire(gameState, victim, 4)
    return { ...turn, victim, card, target }
}

const deepSongOptions = (turn: ReturnType<typeof createDeepSongTurn>) => {
    const { decision, options } = getActionOptions(turn, MinionActionType.ActionCardFromHand)
    return {
        decision,
        mine: options.filter(
            option =>
                option.action.type == MinionActionType.ActionCardFromHand &&
                option.action.card == turn.card,
        ),
    }
}

export const CROWS_SCENARIOS: Scenario[] = [
    {
        name: 'Carrion Crows is offered before the range at the levels of the vampire, and no later',
        run() {
            const fight = createCrowsFight(DisciplineLevel.SUPERIOR)
            expectEqual(
                crowsOptions(fight)
                    .map(option => option.amount)
                    .join(),
                '1,2',
                'both levels',
            )
            passUntil(fight, CombatStep.DetermineRange)
            expectEqual(crowsOptions(fight).length, 0, 'in the range step')

            const inferior = createCrowsFight(DisciplineLevel.INFERIOR)
            expectEqual(
                crowsOptions(inferior)
                    .map(option => option.amount)
                    .join(),
                '1',
                'inferior only',
            )
            const none = createCrowsFight(DisciplineLevel.INFERIOR)
            none.acting.minionAttrs.disciplines = {} as Disciplines
            expectEqual(crowsOptions(none).length, 0, 'no Animalism')
        },
    },
    {
        name: 'Carrion Crows hurts the opposing minion, and a vampire plays only one per combat',
        run() {
            const fight = createCrowsFight(DisciplineLevel.SUPERIOR)
            const second = giveSecondCopy(fight)
            playCardOption(
                fight,
                'combatEnvironmentalDamage',
                fight.card,
                option => option.amount == 2,
            )
            expectEqual(getCombat(fight).defending.environmentalDamage, 2, 'damage on the opponent')
            expectEqual(getCombat(fight).acting.environmentalDamage, 0, 'damage on the player')
            expectEqual(getCombat(fight).impulsePlayer, fight.actingPlayer, 'impulse')
            expectEqual(
                cardOptionsOf(fight, 'combatEnvironmentalDamage', second).length,
                0,
                'a second one',
            )
        },
    },
    {
        name: 'Carrion Crows damage comes each round and a dodge does not stop it',
        run() {
            const fight = createCrowsFight(DisciplineLevel.INFERIOR)
            playCardOption(fight, 'combatEnvironmentalDamage', fight.card)
            strikeRound(fight, undefined, createDodgeStrike())
            passUntil(fight, CombatStep.Press)
            expectEqual(fight.defending.blood, 2, 'defending blood after round 1')
            expectEqual(fight.acting.blood, 3, 'acting blood')

            press(fight.actingPlayer, fight.acting)
            pass(fight.defendingPlayer, 'defending passes')
            passUntil(fight, CombatStep.BeforeRange)
            strikeRoundToEnd(fight, undefined, createDodgeStrike())
            expectEqual(fight.defending.blood, 1, 'defending blood after round 2')
        },
    },
    {
        name: 'Carrion Crows damage is inflicted with first strikes alone, and not when the combat ended',
        run() {
            const fight = createCrowsFight(DisciplineLevel.INFERIOR)
            playCardOption(fight, 'combatEnvironmentalDamage', fight.card)
            const quick = createStrike('Quick', { damage: 1, firstStrike: true })
            strikeRoundToEnd(fight, quick, quick)
            expectEqual(fight.defending.blood, 1, 'defending blood')
            expectEqual(fight.acting.blood, 2, 'acting blood')

            const ended = createCrowsFight(DisciplineLevel.INFERIOR)
            playCardOption(ended, 'combatEnvironmentalDamage', ended.card)
            strikeRound(ended, createStrike('Flee', { combatEnds: true }))
            passUntil(ended, null)
            expectEqual(ended.defending.blood, 3, 'defending blood when the combat ends')
        },
    },
    {
        name: 'Murder of Crows is a retainer with 1 life at inferior and 2 at superior',
        run() {
            for (const [level, life] of [
                [DisciplineLevel.INFERIOR, 1],
                [DisciplineLevel.SUPERIOR, 2],
            ] as const) {
                const turn = createEquipTurn(MURDER_OF_CROWS_ID, CrowsDeck, level)
                const { decision, mine } = equipOptions(turn)
                const option = mine.find(candidate => levelOf(candidate) == level)
                if (!option) {
                    throw new ScenarioFailure(`No ${level} option`)
                }
                applyOption(decision, option)
                resolveAction(turn)
                expectEqual(getHost(turn.card), turn.ready, 'host')
                expectEqual(turn.card.blood, life, `life at ${level}`)
                expectEqual(getEnvironmentalDamage(turn.ready), 1, `damage at ${level}`)
            }
            const none = createEquipTurn(MURDER_OF_CROWS_ID, CrowsDeck, null)
            expectEqual(equipOptions(none).mine.length, 0, 'no Animalism')
        },
    },
    {
        name: 'Murder of Crows hurts the opposing minion each round, even against a dodge, until it is burned',
        run() {
            const fight = createFight(3, 3, CrowsDeck)
            const crows = findCard(fight.actingPlayer, MURDER_OF_CROWS_ID)
            attachInPlay(crows, fight.acting, { life: 1, disciplines: SPY_INFERIOR })
            strikeRound(fight, undefined, createDodgeStrike())
            passUntil(fight, CombatStep.Press)
            expectEqual(fight.defending.blood, 2, 'defending blood after round 1')
            expectEqual(fight.acting.blood, 3, 'the employer is not hurt')

            fight.gameState.moveCardToRegion(crows, fight.actingPlayer.ashHeap)
            press(fight.actingPlayer, fight.acting)
            pass(fight.defendingPlayer, 'defending passes')
            passUntil(fight, CombatStep.BeforeRange)
            strikeRoundToEnd(fight, undefined, createDodgeStrike())
            expectEqual(fight.defending.blood, 2, 'defending blood once the retainer is gone')
        },
    },
    {
        name: 'Deep Song bleeds at +1 with inferior Animalism, and cannot enter combat',
        run() {
            const turn = createDeepSongTurn(DisciplineLevel.INFERIOR)
            const { decision, mine } = deepSongOptions(turn)
            expectEqual(mine.length, 1, 'options')
            const target = mine[0].action.target
            expectEqual(target instanceof Player, true, 'a bleed aims at a player')
            applyOption(decision, mine[0])
            expectEqual(turn.gameState.action?.bleed, turn.ready.minionAttrs.bleed + 1, 'bleed')
        },
    },
    {
        name: 'Deep Song with superior Animalism locks a vampire of another Methuselah and starts a combat where it acts',
        run() {
            const turn = createDeepSongTurn(DisciplineLevel.SUPERIOR)
            const own = readyVampire(turn.gameState, turn.player, 3)
            const { decision, mine } = deepSongOptions(turn)
            const vampireTargets = mine.filter(
                option =>
                    option.action.actingMinion == turn.ready &&
                    option.action.target instanceof Card,
            )
            expectEqual(vampireTargets.length, 1, 'vampire targets')
            expectEqual(vampireTargets[0].action.target, turn.target, 'target')
            expectEqual(
                mine.some(option => option.action.target == own),
                false,
                'one of your own vampires',
            )

            applyOption(decision, vampireTargets[0])
            resolveAction(turn)
            expectEqual(turn.target.isLocked, true, 'target locked')
            const combat = turn.gameState.combat
            expectEqual(combat?.acting.minion, turn.target, 'acting minion')
            expectEqual(combat?.defending.minion, turn.ready, 'defending minion')
            expectEqual(combat?.impulsePlayer, turn.victim, 'impulse')
        },
    },
]
