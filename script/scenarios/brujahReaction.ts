import { MinionActionType } from '@/shared/types/state.ts'
import { Discipline, DisciplineLevel, TurnSequence, TurnPhase } from '@/shared/const/model.ts'
import { Disciplines } from '@/shared/types/resources.ts'
import { getBlockingMinion } from '@/shared/state/actionState.ts'
import { findOption } from '@/shared/bot/helpers.ts'
import { BrujahDeck } from '@/shared/bot/decks.ts'
import { applyOption, getDecisionPoint, getDecidingPlayer } from '@/shared/bot/referee.ts'
import { DecisionPoint, optionsOfType } from '@/shared/bot/types.ts'
import { attemptBlock, createCatalogBleed, passUntilDecides } from './catalog.ts'
import { ATIENA_ID, OCTANE_ID, RAYNE_ID, createWarzoneTurn } from './brujah.ts'
import {
    Scenario,
    ScenarioFailure,
    expectEqual,
    giveCard,
    readySpecific,
    readyVampire,
} from './helpers.ts'
import { decideWith, emptyHand } from './bounce.ts'
import { createMinionPhase, getActionOptions } from './torpor.ts'
import { countMasterOptions, countUnlockEffects, getMasterDecision } from './master.ts'

export const ORGANIZED_RESISTANCE_ID = '102230'

const SHOW_OF_FORCE_ID = '101772'

const CARFAX_ID = '100297'

const ARIANE_ID = '200132'

const ELEN_ID = '201585'

// A bleed against a prey that holds Organized Resistance, a baron ( Atiena ) and a locked Anarch
function createResistance(baronLocked: boolean) {
    const game = createCatalogBleed({
        deck: BrujahDeck,
        discipline: Discipline.Presence,
        level: DisciplineLevel.SUPERIOR,
        cards: [],
        preyCards: [ORGANIZED_RESISTANCE_ID],
        preyVampireId: ATIENA_ID,
    })
    const anarch = readySpecific(game.gameState, game.bled, RAYNE_ID, 3)
    anarch.lock()
    if (baronLocked) {
        game.blocker.lock()
    }
    return { ...game, anarch }
}

const reactionsOf = (decision: DecisionPoint, type: string) =>
    optionsOfType(decision.options, 'playReaction').filter(option => option.effect.type == type)

export const BRUJAH_REACTION_SCENARIOS: Scenario[] = [
    {
        name: 'Organized Resistance unlocks a locked Anarch which attempts to block with +1 intercept',
        run() {
            const game = createResistance(false)
            const decision = passUntilDecides(game.gameState, game.bled)
            const unlocks = reactionsOf(decision, 'unlockBlock')
            expectEqual(unlocks.length, 1, 'unlock options')
            expectEqual(
                unlocks[0].effect.type == 'unlockBlock' && unlocks[0].effect.target == game.anarch,
                true,
                'target',
            )
            applyOption(decision, unlocks[0])
            expectEqual(game.anarch.isLocked, false, 'unlocked')
            expectEqual(game.gameState.action?.intercept, 1, 'intercept')
            const standing = getBlockingMinion(game.gameState)
            expectEqual(standing, game.anarch, 'the block attempt stands')
            expectEqual(game.blocker.isLocked, false, 'the baron is not locked by the card')
        },
    },
    {
        name: 'Organized Resistance is usable by a locked baron, and needs a baron',
        run() {
            const locked = createResistance(true)
            const decision = passUntilDecides(locked.gameState, locked.bled)
            // Rayne, and the baron herself: she is a locked Anarch too
            expectEqual(reactionsOf(decision, 'unlockBlock').length, 2, 'a locked baron')

            const plain = createCatalogBleed({
                deck: BrujahDeck,
                discipline: Discipline.Presence,
                level: DisciplineLevel.SUPERIOR,
                cards: [],
                preyCards: [ORGANIZED_RESISTANCE_ID],
                preyVampireId: RAYNE_ID,
            })
            readySpecific(plain.gameState, plain.bled, OCTANE_ID, 3).lock()
            const next = passUntilDecides(plain.gameState, plain.bled)
            expectEqual(optionsOfType(next.options, 'playReaction').length, 0, 'a plain Anarch')
        },
    },
    {
        name: 'Organized Resistance adds 1 intercept to the standing block of an Anarch, not once a block stands for the unlock',
        run() {
            const game = createResistance(false)
            const first = passUntilDecides(game.gameState, game.bled)
            expectEqual(reactionsOf(first, 'intercept').length, 0, 'before any block')
            attemptBlock(game, false)
            decideWith(game.gameState, game.bleeder, 'noModifier')
            const decision = getDecisionPoint(game.gameState, game.bled)
            if (!decision) {
                throw new ScenarioFailure('No decision after the block attempt')
            }
            expectEqual(
                reactionsOf(decision, 'unlockBlock').length,
                0,
                'no unlock while a block stands',
            )
            const intercepts = reactionsOf(decision, 'intercept')
            expectEqual(intercepts.length >= 1, true, 'intercept options')
            const before = game.gameState.action?.intercept ?? 0
            applyOption(decision, intercepts[0])
            expectEqual(game.gameState.action?.intercept, before + 1, 'intercept')
        },
    },
    {
        name: 'Show of Force: a bleed that gives its strength bonus to the first round of the combat if blocked',
        run() {
            const turn = createMinionPhase(5, 0, BrujahDeck)
            const { gameState, player } = turn
            const victim = player.prey
            if (!victim) {
                throw new ScenarioFailure('No prey')
            }
            turn.ready.vampireAttrs.sect = 'Anarch'
            turn.ready.minionAttrs.strength = 1
            turn.ready.minionAttrs.disciplines = {} as Disciplines
            turn.ready.minionAttrs.disciplines[Discipline.Potence] = DisciplineLevel.SUPERIOR
            turn.ready.minionAttrs.disciplines[Discipline.Presence] = DisciplineLevel.SUPERIOR
            emptyHand(gameState, player)
            const card = giveCard(gameState, player, SHOW_OF_FORCE_ID)
            const blocker = readyVampire(gameState, victim, 3)

            const { decision, options } = getActionOptions(
                turn,
                MinionActionType.ActionCardFromHand,
            )
            const mine = options.flatMap(option =>
                (
                    option.action.type == MinionActionType.ActionCardFromHand &&
                    option.action.card == card
                ) ?
                    [option]
                :   [],
            )
            expectEqual(mine.length, 2, 'both levels')
            const superior = mine.find(
                option =>
                    option.action.type == MinionActionType.ActionCardFromHand &&
                    option.action.usage.disciplines?.every(
                        use => use.level == DisciplineLevel.SUPERIOR,
                    ),
            )
            if (!superior) {
                throw new ScenarioFailure('The superior level is not offered')
            }
            applyOption(decision, superior)
            expectEqual(gameState.action?.bleed, 3, 'bleed: 1 + 2')

            const first = passUntilDecides(gameState, victim)
            applyOption(first, findOption(first.options, 'block'))
            // Everybody passes until the block is resolved
            for (let i = 0; i < 6 && !gameState.combat; i++) {
                const decider = getDecidingPlayer(gameState)
                const next = decider && getDecisionPoint(gameState, decider)
                const pass = next?.options.find(option =>
                    ['noModifier', 'noReaction'].includes(option.type),
                )
                if (!next || !pass) {
                    break
                }
                applyOption(next, pass)
            }
            const combat = gameState.combat
            if (!combat) {
                throw new ScenarioFailure('No combat after the block')
            }
            expectEqual(combat.acting.minion, turn.ready, 'acting minion')
            expectEqual(combat.defending.minion, blocker, 'blocked by')
            expectEqual(combat.acting.strengthBonus, 2, 'bonus')

            const combatDecision = getDecisionPoint(gameState, player)
            const bonus = combatDecision?.options.find(
                option => option.type == 'combatStrengthBonus',
            )
            if (!combatDecision || !bonus) {
                throw new ScenarioFailure('The bonus is not offered')
            }
            applyOption(combatDecision, bonus)
            expectEqual(combat.acting.strength, 3, 'strength')
            expectEqual(combat.acting.strengthBonus, 0, 'bonus used')
        },
    },
    {
        name: 'Carfax Abbey needs a ready Anarch and feeds an Anarch in the unlock phase, not another sect',
        run() {
            const turn = createWarzoneTurn(CARFAX_ID)
            const { gameState, player, warzone } = turn
            expectEqual(countMasterOptions(turn), 0, 'no ready vampire')
            const octane = readySpecific(gameState, player, OCTANE_ID, 2)
            expectEqual(countMasterOptions(turn), 1, 'a ready Anarch')
            octane.vampireAttrs.sect = 'Camarilla'
            expectEqual(countMasterOptions(turn), 0, 'a ready Camarilla vampire')
            octane.vampireAttrs.sect = 'Anarch'

            gameState.moveCardToRegion(warzone, player.ready)
            gameState.turnPhaseIndex = TurnSequence.indexOf(TurnPhase.Unlock)
            const rayne = readySpecific(gameState, player, RAYNE_ID, 1)
            rayne.vampireAttrs.sect = 'Camarilla'
            expectEqual(countUnlockEffects(turn), 1, 'only the Anarch is a target')
            const decision = getMasterDecision(turn)
            applyOption(decision, findOption(decision.options, 'unlockEffect'))
            expectEqual(octane.blood, 3, 'blood gained')
            expectEqual(rayne.blood, 1, 'the other vampire gained nothing')
        },
    },
    {
        name: 'Ariane has 1 stealth less on undirected actions',
        run() {
            const turn = createMinionPhase(5, 0, BrujahDeck)
            const ariane = readySpecific(turn.gameState, turn.player, ARIANE_ID, 4)
            const { decision, options } = getActionOptions(turn, MinionActionType.Hunt)
            const hunt = options.find(option => option.action.actingMinion == ariane)
            if (!hunt) {
                throw new ScenarioFailure('Ariane cannot hunt')
            }
            applyOption(decision, hunt)
            expectEqual(turn.gameState.action?.stealth, 0, 'stealth of the hunt')
        },
    },
    {
        name: 'Elen Kamjian must bleed while her Methuselah controls a locked minion: nothing else, no end of phase',
        run() {
            const turn = createMinionPhase(5, 0, BrujahDeck)
            const elen = readySpecific(turn.gameState, turn.player, ELEN_ID, 4)
            const elenOptions = () => {
                const decision = getDecisionPoint(turn.gameState, turn.player)
                if (!decision) {
                    throw new ScenarioFailure('No decision point')
                }
                return {
                    decision,
                    actions: optionsOfType(decision.options, 'declareAction').filter(
                        option => option.action.actingMinion == elen,
                    ),
                }
            }
            const free = elenOptions()
            expectEqual(
                free.actions.some(option => option.action.type == MinionActionType.Hunt),
                true,
                'free to hunt',
            )
            expectEqual(
                free.decision.options.some(option => option.type == 'endPhase'),
                true,
                'free to end the phase',
            )

            // Another vampire is locked ( Elen herself may be the one drawn as ready )
            readyVampire(turn.gameState, turn.player, 3).lock()
            const forced = elenOptions()
            expectEqual(
                forced.actions.every(option => option.action.type == MinionActionType.Bleed),
                true,
                'bleed only',
            )
            expectEqual(forced.actions.length > 0, true, 'a bleed is offered')
            expectEqual(
                forced.decision.options.some(option => option.type == 'endPhase'),
                false,
                'no end of phase',
            )
        },
    },
]
