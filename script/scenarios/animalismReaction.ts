import { GameState } from '@/shared/state/gameState.ts'
import { botMutations } from '@/shared/state/botMutations.ts'
import { canManeuver } from '@/shared/state/combatState.ts'
import { MinionActionType, CombatStep } from '@/shared/types/state.ts'
import { DisciplineLevel, Discipline } from '@/shared/const/model.ts'
import { findOption } from '@/shared/bot/helpers.ts'
import { MalkavDeck } from '@/shared/bot/decks.ts'
import { getDecidingPlayer, getDecisionPoint, applyOption } from '@/shared/bot/referee.ts'
import { DecisionPoint, optionsOfType } from '@/shared/bot/types.ts'
import { Scenario, ScenarioFailure, expectEqual, must } from './helpers.ts'
import { attemptBlock, createCatalogBleed, passUntilDecides } from './catalog.ts'
import { decideWith } from './bounce.ts'
import { GUARD_DOGS_ID, INSTINCTIVE_REACTION_ID } from '../cardIds.ts'

// The players pass until a combat starts ( a block with enough intercept was resolved )
export function passUntilCombat(gameState: GameState) {
    for (let i = 0; i < 8 && !gameState.combat; i++) {
        const decider = getDecidingPlayer(gameState)
        const decision = decider && getDecisionPoint(gameState, decider)
        const pass = decision?.options.find(option =>
            ['noReaction', 'noModifier'].includes(option.type),
        )
        if (!decision || !pass) {
            break
        }
        applyOption(decision, pass)
    }
    return gameState.combat
}

// The prey holds the card, its vampire blocks with the card played at the level ( or not ), and
// the block is enough to succeed
export function blockWithReaction(
    cardId: string,
    level: DisciplineLevel,
    options: { locked?: boolean; copies?: number; extra?: string[] } = {},
) {
    const extra = options.extra ?? []
    const game = createCatalogBleed({
        deck: { ...MalkavDeck, [cardId]: 4, ...Object.fromEntries(extra.map(id => [id, 4])) },
        discipline: Discipline.Dominate,
        level: DisciplineLevel.INFERIOR,
        cards: [],
        preyCards: [...Array.from({ length: options.copies ?? 1 }, () => cardId), ...extra],
        preyDiscipline: [Discipline.Animalism, level],
    })
    if (options.locked) {
        game.blocker.lock()
    }
    return game
}

export const reactionOptions = (decision: DecisionPoint) =>
    optionsOfType(decision.options, 'playReaction')

export const ANIMALISM_REACTION_SCENARIOS: Scenario[] = [
    {
        name: 'Guard Dogs unlocks a locked vampire, and gives a maneuver in the block combat at superior',
        run() {
            for (const [level, maneuver] of [
                [DisciplineLevel.INFERIOR, false],
                [DisciplineLevel.SUPERIOR, true],
            ] as const) {
                const game = blockWithReaction(GUARD_DOGS_ID, level, { locked: true })
                const { gameState, bleeder, bled, blocker } = game
                const decision = passUntilDecides(gameState, bled)
                expectEqual(optionsOfType(decision.options, 'block').length, 0, 'locked')
                const unlocks = reactionOptions(decision).filter(
                    option =>
                        option.effect.type == 'unlock' &&
                        option.minion == blocker &&
                        !!option.effect.blockManeuver == maneuver,
                )
                expectEqual(unlocks.length, 1, 'offered')
                expectEqual(!!unlocks[0].effect.blockManeuver, maneuver, `maneuver at ${level}`)
                applyOption(decision, unlocks[0])
                expectEqual(blocker.isLocked, false, 'unlocked')

                const next = passUntilDecides(gameState, bled)
                applyOption(
                    next,
                    optionsOfType(next.options, 'block').find(o => o.minion == blocker) ??
                        findOption(next.options, 'block'),
                )
                if (gameState.action) {
                    gameState.action.stealth = 0
                }
                decideWith(gameState, bleeder, 'noModifier')
                const combat = passUntilCombat(gameState)
                expectEqual(combat?.defending.freeManeuvers, maneuver ? 1 : 0, 'free maneuvers')
            }
        },
    },
    {
        name: 'Guard Dogs is for a locked vampire, during a bleed against you',
        run() {
            const unlocked = blockWithReaction(GUARD_DOGS_ID, DisciplineLevel.INFERIOR)
            expectEqual(
                reactionOptions(passUntilDecides(unlocked.gameState, unlocked.bled)).length,
                0,
                'an unlocked vampire',
            )
            const hunt = createCatalogBleed({
                deck: { ...MalkavDeck, [GUARD_DOGS_ID]: 4 },
                discipline: Discipline.Dominate,
                level: DisciplineLevel.INFERIOR,
                cards: [],
                actionType: MinionActionType.Hunt,
                preyCards: [GUARD_DOGS_ID],
                preyDiscipline: [Discipline.Animalism, DisciplineLevel.INFERIOR],
            })
            hunt.blocker.lock()
            const decision = passUntilDecides(hunt.gameState, hunt.bled)
            expectEqual(reactionOptions(decision).length, 0, 'not a bleed')
        },
    },
    {
        name: 'Instinctive Reaction adds 1 intercept once your predator acts and a block stands, with a maneuver at superior',
        run() {
            for (const [level, maneuver] of [
                [DisciplineLevel.INFERIOR, false],
                [DisciplineLevel.SUPERIOR, true],
            ] as const) {
                const game = blockWithReaction(INSTINCTIVE_REACTION_ID, level)
                const { gameState, bleeder, bled } = game
                const first = passUntilDecides(gameState, bled)
                expectEqual(reactionOptions(first).length, 0, 'before the block')
                attemptBlock(game, false)
                decideWith(gameState, bleeder, 'noModifier')
                const standing = getDecisionPoint(gameState, bled)
                const reactions = (standing ? reactionOptions(standing) : []).filter(
                    option => !!option.effect.blockManeuver == maneuver,
                )
                expectEqual(reactions.length, 1, 'offered')
                const before = gameState.action?.intercept ?? 0
                if (standing) {
                    applyOption(standing, reactions[0])
                }
                expectEqual(gameState.action?.intercept, before + 1, 'intercept')
                expectEqual(
                    gameState.action?.blockManeuvers.length,
                    maneuver ? 1 : 0,
                    'maneuver granted',
                )
                if (gameState.action) {
                    gameState.action.stealth = 0
                }
                const combat = passUntilCombat(gameState)
                expectEqual(combat?.defending.freeManeuvers, maneuver ? 1 : 0, 'free maneuvers')
            }
        },
    },
    {
        name: 'A free maneuver is offered to the blocker once, and moves the range',
        run() {
            const game = blockWithReaction(INSTINCTIVE_REACTION_ID, DisciplineLevel.SUPERIOR)
            const { gameState, bleeder, bled, blocker } = game
            attemptBlock(game, false)
            decideWith(gameState, bleeder, 'noModifier')
            const standing = getDecisionPoint(gameState, bled)
            const reaction = standing && reactionOptions(standing).find(o => o.effect.blockManeuver)
            if (!standing || !reaction) {
                throw new ScenarioFailure('The reaction is not offered')
            }
            applyOption(standing, reaction)
            if (gameState.action) {
                gameState.action.stealth = 0
            }
            const combat = passUntilCombat(gameState)
            if (!combat) {
                throw new ScenarioFailure('No combat')
            }
            const range = combat.range
            while (combat.step != CombatStep.DetermineRange || combat.impulsePlayer != bled) {
                must(botMutations.COMBAT_pass.act(combat.impulsePlayer, {}), 'pass')
            }
            must(
                botMutations.COMBAT_maneuver.act(bled, { minion: blocker, free: true }),
                'free maneuver',
            )
            expectEqual(combat.range == range, false, 'the range moved')
            expectEqual(combat.defending.freeManeuvers, 0, 'used')
            expectEqual(
                canManeuver(gameState, blocker, undefined, undefined, true).isValid,
                false,
                'no second one',
            )
        },
    },
]
