import { Player } from '@/shared/model/Player.ts'
import { MinionActionType, LibraryCardUsage } from '@/shared/types/state.ts'
import { Discipline, DisciplineLevel } from '@/shared/const/model.ts'
import { Disciplines } from '@/shared/types/resources.ts'
import { BrujahDeck } from '@/shared/bot/decks.ts'
import { applyOption } from '@/shared/bot/referee.ts'
import { createMinionPhase, getActionOptions, resolveAction } from './torpor.ts'
import {
    Scenario,
    ScenarioFailure,
    expectEqual,
    giveCard,
    readySpecific,
    readyVampire,
} from './helpers.ts'
import { emptyHand } from './bounce.ts'
import { LINE_BRAWL_ID, THEO_BELL_ID } from '../cardIds.ts'

// The minion phase of a player holding Line Brawl, with an Anarch vampire that has the disciplines
// and a minion of the prey in play
export function createLineBrawlTurn() {
    const turn = createMinionPhase(5, 0, BrujahDeck)
    const { gameState, player } = turn
    const victim = player.prey
    if (!victim) {
        throw new ScenarioFailure('No prey')
    }
    turn.ready.vampireAttrs.sect = 'Anarch'
    turn.ready.minionAttrs.disciplines = {} as Disciplines
    for (const discipline of [Discipline.Celerity, Discipline.Potence, Discipline.Presence]) {
        turn.ready.minionAttrs.disciplines[discipline] = DisciplineLevel.INFERIOR
    }
    emptyHand(gameState, player)
    const card = giveCard(gameState, player, LINE_BRAWL_ID)
    const target = readyVampire(gameState, victim, 4)
    return { ...turn, victim, card, target }
}

const lineBrawlOptions = (turn: ReturnType<typeof createLineBrawlTurn>) => {
    const { decision, options } = getActionOptions(turn, MinionActionType.ActionCardFromHand)
    return {
        decision,
        mine: options.flatMap(option =>
            (
                option.action.type == MinionActionType.ActionCardFromHand &&
                option.action.card == turn.card
            ) ?
                [{ option, usage: option.action.usage }]
            :   [],
        ),
    }
}

export const BRUJAH_ACTION_SCENARIOS: Scenario[] = [
    {
        name: 'Line Brawl: a bleed at +1, stealing pool and entering combat, each with its own discipline, needing an Anarch',
        run() {
            const turn = createLineBrawlTurn()
            const { mine } = lineBrawlOptions(turn)
            const kinds = (usage: LibraryCardUsage) =>
                usage.target instanceof Player ? 'player' : 'minion'
            const disciplines = mine.map(({ usage }) => usage.disciplines?.[0]?.discipline).sort()
            expectEqual(
                disciplines.filter(name => name == Discipline.Presence).length,
                1,
                'bleed options',
            )
            expectEqual(
                disciplines.filter(name => name == Discipline.Potence).length,
                1,
                'combat options (the only minion of the other Methuselah)',
            )
            expectEqual(
                mine.filter(({ usage }) => kinds(usage) == 'player').length >= 2,
                true,
                'bleed and steal pool aim at players',
            )

            turn.ready.vampireAttrs.sect = 'Camarilla'
            expectEqual(lineBrawlOptions(turn).mine.length, 0, 'a Camarilla vampire')
        },
    },
    {
        name: 'Line Brawl with Celerity steals 1 pool from another Methuselah',
        run() {
            const turn = createLineBrawlTurn()
            const { decision, mine } = lineBrawlOptions(turn)
            const steal = mine.find(
                ({ usage }) => usage.disciplines?.[0]?.discipline == Discipline.Celerity,
            )
            if (!steal) {
                throw new ScenarioFailure('The steal is not offered')
            }
            const victim = steal.usage.target
            if (!(victim instanceof Player)) {
                throw new ScenarioFailure('The steal does not aim at a Methuselah')
            }
            victim.pool = 5
            const own = turn.player.pool
            applyOption(decision, steal.option)
            resolveAction(turn)
            expectEqual(victim.pool, 4, 'pool of the victim')
            expectEqual(turn.player.pool, own + 1, 'pool of the thief')
        },
    },
    {
        name: 'Line Brawl with Potence enters combat with the minion: the combat starts, the card is paid',
        run() {
            const turn = createLineBrawlTurn()
            const { decision, mine } = lineBrawlOptions(turn)
            const brawl = mine.find(({ usage }) => usage.target == turn.target)
            if (!brawl) {
                throw new ScenarioFailure('The combat is not offered')
            }
            applyOption(decision, brawl.option)
            resolveAction(turn)
            const combat = turn.gameState.combat
            expectEqual(combat === null, false, 'combat in progress')
            expectEqual(combat?.acting.minion, turn.ready, 'acting minion')
            expectEqual(combat?.defending.minion, turn.target, 'defending minion')
        },
    },
    {
        name: 'Theo Bell can enter combat with a minion of another Methuselah as an action, others cannot',
        run() {
            const turn = createMinionPhase(5, 0, BrujahDeck)
            const victim = turn.player.prey
            if (!victim) {
                throw new ScenarioFailure('No prey')
            }
            const target = readyVampire(turn.gameState, victim, 4)
            // The ready vampire drawn at random may be Theo Bell himself
            const others = () =>
                getActionOptions(turn, MinionActionType.EnterCombat).options.filter(
                    option => option.action.actingMinion.krcgId != THEO_BELL_ID,
                )
            expectEqual(others().length, 0, 'an ordinary vampire')

            const theo =
                turn.ready.krcgId == THEO_BELL_ID ?
                    turn.ready
                :   readySpecific(turn.gameState, turn.player, THEO_BELL_ID, 5)
            expectEqual(theo.minionAttrs.strength, 2, 'strength')
            const { decision, options } = getActionOptions(turn, MinionActionType.EnterCombat)
            expectEqual(options.length, 1, 'options')
            expectEqual(options[0].action.actingMinion, theo, 'acting minion')
            expectEqual(options[0].action.target, target, 'target')

            applyOption(decision, options[0])
            resolveAction(turn)
            expectEqual(turn.gameState.combat?.defending.minion, target, 'combat started')
        },
    },
]
