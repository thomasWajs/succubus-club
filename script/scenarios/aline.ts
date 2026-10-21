import { Vampire } from '@/shared/model/Card.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { Sect, Discipline, DisciplineLevel } from '@/shared/const/model.ts'
import { emitEvent } from '@/shared/state/events.ts'
import { getTriggerKey } from '@/shared/state/triggers.ts'
import { chooseThroughView } from '@/shared/bot/playerView.ts'
import { findOption } from '@/shared/bot/helpers.ts'
import { createBleedAction } from '@/shared/state/minionActionFactories.ts'
import { BrujahDeck } from '@/shared/bot/decks.ts'
import { getDecidingPlayer, getDecisionPoint, applyOption } from '@/shared/bot/referee.ts'
import { DecisionPoint, DecisionKind } from '@/shared/bot/types.ts'
import {
    blockWithBlocker,
    createEventBleed,
    endBlockCombat,
    passUntilActionOver,
} from './events.ts'
import { createCatalogBleed } from './catalog.ts'
import { Scenario, ScenarioFailure, expectEqual, readySpecific } from './helpers.ts'
import { ALINE_ID, ATIENA_ID } from '../cardIds.ts'

type AlineGame = ReturnType<typeof createEventBleed> & { aline: Vampire }

// The first player bleeds with Atiena ( an Anarch, by default ) while Aline, locked, sits in the
// ready region of the same player. The prey does not block unless the scenario says so.
export function createAlineGame(
    setup: { actorSect?: Sect; alineBlood?: number; inTorpor?: boolean } = {},
): AlineGame {
    const game = createCatalogBleed({
        discipline: Discipline.Obfuscate,
        level: DisciplineLevel.INFERIOR,
        cards: [],
        deck: BrujahDeck,
        bleederId: ATIENA_ID,
    })
    game.bleeding.vampireAttrs.sect = setup.actorSect ?? Sect.Anarch
    const aline = readySpecific(game.gameState, game.bleeder, ALINE_ID, setup.alineBlood ?? 3)
    aline.vampireAttrs.sect = Sect.Anarch
    aline.lock()
    if (setup.inTorpor) {
        game.gameState.moveCardToRegion(aline, game.bleeder.torpor)
    }
    return { ...game, aline }
}

export function getTriggerDecision(game: AlineGame): DecisionPoint {
    const decider = getDecidingPlayer(game.gameState)
    const decision = decider && getDecisionPoint(game.gameState, decider)
    if (!decision || decision.kind != DecisionKind.Trigger) {
        throw new ScenarioFailure('No trigger decision')
    }
    return decision
}

function expectNoTrigger(gameState: GameState, what: string): void {
    expectEqual(gameState.pendingTriggers.length, 0, what)
}

export const ALINE_SCENARIOS: Scenario[] = [
    {
        name: 'Aline Gadeke: after another Anarch of hers acts unblocked, she may unlock for 1 blood',
        run() {
            const game = createAlineGame()
            passUntilActionOver(game.gameState)
            const decision = getTriggerDecision(game)
            expectEqual(decision.player, game.bleeder, 'the controller decides')
            expectEqual(
                decision.options.map(option => option.type).join(','),
                'useTrigger,skipTrigger',
                'options',
            )
            applyOption(decision, findOption(decision.options, 'useTrigger'))
            expectEqual(game.aline.isLocked, false, 'unlocked')
            expectEqual(game.aline.blood, 2, 'blood burned')
            expectNoTrigger(game.gameState, 'pending')
            expectEqual(
                game.gameState.turnResources.usedTriggers.includes(getTriggerKey(game.aline, 0)),
                true,
                'used this turn',
            )
        },
    },
    {
        name: 'Aline Gadeke: the controller may opt out, nothing changes',
        run() {
            const game = createAlineGame()
            passUntilActionOver(game.gameState)
            const decision = getTriggerDecision(game)
            applyOption(decision, findOption(decision.options, 'skipTrigger'))
            expectEqual(game.aline.isLocked, true, 'still locked')
            expectEqual(game.aline.blood, 3, 'blood')
            expectNoTrigger(game.gameState, 'pending')
            expectEqual(game.gameState.turnResources.usedTriggers.length, 0, 'not used')
        },
    },
    {
        name: 'Aline Gadeke: a failed block still lets the action resolve, so it counts',
        run() {
            const game = createAlineGame()
            if (!game.gameState.action) {
                throw new ScenarioFailure('The bleed is not declared')
            }
            game.gameState.action.stealth = 1
            game.blocker.minionAttrs.intercept = 0
            blockWithBlocker(game)
            passUntilActionOver(game.gameState)
            getTriggerDecision(game)
        },
    },
    {
        name: 'Aline Gadeke: a block that succeeds starts a combat, nothing is pending',
        run() {
            const game = createAlineGame()
            if (!game.gameState.action) {
                throw new ScenarioFailure('The bleed is not declared')
            }
            game.gameState.action.stealth = 1
            game.blocker.minionAttrs.intercept = 5
            blockWithBlocker(game)
            passUntilActionOver(game.gameState)
            expectEqual(game.gameState.combat != null, true, 'combat')
            endBlockCombat(game)
            expectNoTrigger(game.gameState, 'an unsuccessful action')
        },
    },
    {
        name: 'Aline Gadeke: does not trigger on her own action, nor on a minion that is not an Anarch',
        run() {
            const own = createCatalogBleed({
                discipline: Discipline.Obfuscate,
                level: DisciplineLevel.INFERIOR,
                cards: [],
                deck: BrujahDeck,
                bleederId: ALINE_ID,
            })
            own.bleeding.lock()
            passUntilActionOver(own.gameState)
            expectNoTrigger(own.gameState, 'her own action')

            const camarilla = createAlineGame({ actorSect: Sect.Camarilla })
            passUntilActionOver(camarilla.gameState)
            expectNoTrigger(camarilla.gameState, 'a Camarilla vampire')

            // "Another Anarch YOU control": Aline of the prey does not react to the bleeder
            const others = createAlineGame()
            others.gameState.moveCardToRegion(others.aline, others.bled.ready)
            passUntilActionOver(others.gameState)
            expectNoTrigger(others.gameState, 'an Anarch of another Methuselah')
        },
    },
    {
        name: 'Aline Gadeke: not queued without a blood to burn, and only once per turn',
        run() {
            const empty = createAlineGame({ alineBlood: 0 })
            passUntilActionOver(empty.gameState)
            expectNoTrigger(empty.gameState, 'no blood')

            const game = createAlineGame()
            passUntilActionOver(game.gameState)
            const decision = getTriggerDecision(game)
            applyOption(decision, findOption(decision.options, 'useTrigger'))
            // Another action resolves the same turn
            game.aline.lock()
            emitEvent(game.gameState, {
                type: 'actionResolved',
                action: createBleedAction(game.bleeding, game.bled),
                successful: true,
                armed: [],
            })
            expectNoTrigger(game.gameState, 'once per turn')
        },
    },
    {
        name: 'Aline Gadeke: works from torpor too, the unlock leaves her in torpor',
        run() {
            const game = createAlineGame({ inTorpor: true })
            expectEqual(game.aline.isIn.torpor, true, 'in torpor')
            passUntilActionOver(game.gameState)
            const decision = getTriggerDecision(game)
            applyOption(decision, findOption(decision.options, 'useTrigger'))
            expectEqual(game.aline.isLocked, false, 'unlocked')
            expectEqual(game.aline.isIn.torpor, true, 'still in torpor')
        },
    },
    {
        name: 'Aline Gadeke: two copies ask one after the other, and the decision goes through the player view',
        run() {
            const game = createAlineGame()
            const second = [...game.bleeder.crypt.cards, ...game.bleeder.uncontrolled.cards].find(
                card => card.krcgId == ALINE_ID && card != game.aline,
            )
            if (!second?.isVampire()) {
                throw new ScenarioFailure('No second Aline')
            }
            game.gameState.moveCardToRegion(second, game.bleeder.ready)
            second.blood = 2
            second.lock()
            passUntilActionOver(game.gameState)
            expectEqual(game.gameState.pendingTriggers.length, 2, 'both pending')

            const first = getTriggerDecision(game)
            const viaView = chooseThroughView(first, {
                choose: decision => findOption(decision.options, 'useTrigger'),
            })
            expectEqual(viaView.type, 'useTrigger', 'chosen through the view')
            applyOption(first, viaView)
            expectEqual(game.gameState.pendingTriggers.length, 1, 'one left')
            const next = getTriggerDecision(game)
            applyOption(next, findOption(next.options, 'skipTrigger'))
            expectNoTrigger(game.gameState, 'all decided')
        },
    },
]
