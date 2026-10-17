import { Player } from '@/shared/model/Player.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { botMutations } from '@/shared/state/botMutations.ts'
import { Discipline, DisciplineLevel } from '@/shared/const/model.ts'
import { getBlockingMinion } from '@/shared/state/actionState.ts'
import { addEventObserver } from '@/shared/state/events.ts'
import { findOption } from '@/shared/bot/helpers.ts'
import { getDecidingPlayer, getDecisionPoint, applyOption } from '@/shared/bot/referee.ts'
import { optionsOfType } from '@/shared/bot/types.ts'
import { Scenario, ScenarioFailure, expectEqual, must, readyVampire } from './helpers.ts'
import {
    attemptBlock,
    createCatalogBleed,
    modifierLevel,
    modifierOptionsOf,
    passUntilDecides,
} from './catalog.ts'
import { FACELESS_NIGHT_ID } from '../cardIds.ts'

// The names of the events announced from now on, until stop() is called
function watchEvents(): { names: string[]; stop: () => void } {
    const names: string[] = []
    const stop = addEventObserver((_gameState, event) => {
        names.push(
            event.type == 'actionResolved' && !event.successful ?
                'actionResolved(blocked)'
            :   event.type,
        )
    })
    return { names, stop }
}

// Everybody passes ( a standing block is kept ) until the action is over
// Until the action is over, or a block is resolved ( its combat, if any, is not played )
export function passUntilActionOver(gameState: GameState): void {
    for (let i = 0; i < 12 && gameState.action && !gameState.action.blockResolved; i++) {
        const decider = getDecidingPlayer(gameState)
        const next = decider && getDecisionPoint(gameState, decider)
        const pass = ['noModifier', 'noReaction', 'noBlock']
            .map(type => next?.options.find(option => option.type == type))
            .find(Boolean)
        if (!next || !pass) {
            throw new ScenarioFailure('Nobody can pass')
        }
        applyOption(next, pass)
    }
    expectEqual(!gameState.action || !!gameState.action.blockResolved, true, 'the action is over')
}

export function createEventBleed(blockerIntercept: number) {
    const game = createCatalogBleed({
        discipline: Discipline.Obfuscate,
        level: DisciplineLevel.INFERIOR,
        cards: [],
    })
    if (!game.gameState.action) {
        throw new ScenarioFailure('The bleed is not declared')
    }
    game.gameState.action.stealth = 1
    game.blocker.minionAttrs.intercept = blockerIntercept
    return game
}

// The combat of a block is ended by hand, and the post block window of the blocker, if open, is passed
export function endBlockCombat(game: {
    gameState: GameState
    bleeder: Player
    bled: Player
}): void {
    must(botMutations.COMBAT_end.act(game.bleeder, {}), 'end combat')
    const window = game.gameState.action ? getDecisionPoint(game.gameState, game.bled) : null
    if (window) {
        applyOption(window, findOption(window.options, 'noReaction'))
    }
    expectEqual(game.gameState.action, null, 'the blocked action is over')
}

export function blockWithBlocker(game: ReturnType<typeof createEventBleed>): void {
    const first = passUntilDecides(game.gameState, game.bled)
    applyOption(
        first,
        optionsOfType(first.options, 'block').find(option => option.minion == game.blocker) ??
            findOption(first.options, 'block'),
    )
}

export const EVENT_SCENARIOS: Scenario[] = [
    {
        name: 'Events: an unblocked bleed announces actionResolving then actionResolved',
        run() {
            const game = createEventBleed(0)
            const watch = watchEvents()
            try {
                passUntilActionOver(game.gameState)
            } finally {
                watch.stop()
            }
            expectEqual(watch.names.join(','), 'actionResolving,actionResolved', 'events')
        },
    },
    {
        name: 'Events: a failed block announces blockFailed, then the action resolves',
        run() {
            const game = createEventBleed(0)
            const watch = watchEvents()
            try {
                blockWithBlocker(game)
                passUntilActionOver(game.gameState)
            } finally {
                watch.stop()
            }
            expectEqual(
                watch.names.join(','),
                'blockFailed,actionResolving,actionResolved',
                'events',
            )
        },
    },
    {
        name: 'Events: a block that succeeds starts a combat, and the action ends unsuccessful with it',
        run() {
            const game = createEventBleed(5)
            const watch = watchEvents()
            try {
                blockWithBlocker(game)
                passUntilActionOver(game.gameState)
                expectEqual(watch.names.length, 0, 'events during the combat')
                expectEqual(game.gameState.combat != null, true, 'combat')
                expectEqual(game.gameState.action?.blockResolved, game.blocker, 'block resolved')
                endBlockCombat(game)
            } finally {
                watch.stop()
            }
            expectEqual(watch.names.join(','), 'actionResolved(blocked)', 'events')
        },
    },
    {
        name: 'Faceless Night: a block that failed before the card was played is not locked, the armed trigger leaves with the action',
        run() {
            const game = createCatalogBleed({
                discipline: Discipline.Obfuscate,
                level: DisciplineLevel.SUPERIOR,
                cards: [FACELESS_NIGHT_ID],
            })
            const { gameState, bleeder, blocker } = game
            if (!gameState.action) {
                throw new ScenarioFailure('The bleed is not declared')
            }
            gameState.action.stealth = 1
            blocker.minionAttrs.intercept = 0
            blockWithBlocker({ ...game, blocker })
            // Both pass: the block is resolved, and fails
            for (let i = 0; i < 4 && getBlockingMinion(gameState); i++) {
                const decider = getDecidingPlayer(gameState)
                const next = decider && getDecisionPoint(gameState, decider)
                const pass = ['noModifier', 'noReaction']
                    .map(type => next?.options.find(option => option.type == type))
                    .find(Boolean)
                if (!next || !pass) {
                    throw new ScenarioFailure('Nobody can pass')
                }
                applyOption(next, pass)
            }
            expectEqual(getBlockingMinion(gameState), null, 'the failed block is resolved')
            // No block attempt stands: the stealth is not needed, the card is not offered
            const idle = getDecisionPoint(gameState, bleeder)
            expectEqual(
                idle ? modifierOptionsOf(idle, FACELESS_NIGHT_ID).length : -1,
                0,
                'not offered after the failed block',
            )

            // A second vampire attempts the block, which would succeed: the card flips it
            const second = readyVampire(gameState, game.bled, 3)
            attemptBlock({ gameState, bled: game.bled, blocker: second }, true)
            const decision = getDecisionPoint(gameState, bleeder)
            const played =
                decision &&
                modifierOptionsOf(decision, FACELESS_NIGHT_ID).find(
                    option => modifierLevel(option) == DisciplineLevel.SUPERIOR,
                )
            if (!decision || !played) {
                throw new ScenarioFailure('Faceless Night is not offered during the second attempt')
            }
            applyOption(decision, played)
            expectEqual(gameState.action?.armedTriggers.length, 1, 'armed trigger')
            passUntilActionOver(gameState)
            expectEqual(blocker.isLocked, false, 'the earlier block does not count')
            expectEqual(second.isLocked, true, 'the failed block of the card is locked')
            expectEqual(gameState.action, null, 'the action is over')
        },
    },
    {
        name: 'Events: an action ended by hand announces actionResolved only',
        run() {
            const game = createEventBleed(0)
            const watch = watchEvents()
            try {
                must(gameMutations.ACTION_endAction.act(game.bleeder, {}), 'end the action')
            } finally {
                watch.stop()
            }
            expectEqual(watch.names.join(','), 'actionResolved', 'events')
        },
    },
]
