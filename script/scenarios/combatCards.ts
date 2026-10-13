import { Vampire } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { botMutations } from '@/shared/state/botMutations.ts'
import { createHandStrike } from '@/shared/state/combatState.ts'
import { CombatStep, CombatRange } from '@/shared/types/state.ts'
import { DisciplineLevel, Discipline } from '@/shared/const/model.ts'
import { BEHIND_YOU_ID } from '@/shared/cardImpl/cardIds.ts'
import { GovernAgent } from '@/shared/bot/agents/governAgent.ts'
import { getDecisionPoint, applyOption } from '@/shared/bot/referee.ts'
import { optionsOfType } from '@/shared/bot/types.ts'
import {
    Fight,
    Scenario,
    ScenarioFailure,
    applyPendingCleanup,
    createFight,
    expectEqual,
    getCombat,
    giveCard,
    must,
    passUntil,
} from './helpers.ts'

/**
 * Combat cards played from the hand (Behind You) and the Govern agent's choices.
 */

function giveBehindYou(fight: Fight, player: Player, minion: Vampire, level: DisciplineLevel) {
    minion.minionAttrs.disciplines[Discipline.Obfuscate] = level
    return giveCard(fight.gameState, player, BEHIND_YOU_ID)
}

export function getCombatDecision(fight: Fight, player: Player) {
    const decision = getDecisionPoint(fight.gameState, player)
    if (!decision) {
        throw new ScenarioFailure(`${player.name} has no decision`)
    }
    return decision
}

export const CARD_SCENARIOS: Scenario[] = [
    {
        name: 'Behind You at inferior is a maneuver, played from the hand in the range step only',
        run() {
            const fight = createFight(3, 3)
            const card = giveBehindYou(
                fight,
                fight.actingPlayer,
                fight.acting,
                DisciplineLevel.INFERIOR,
            )

            // Not in the first step
            const early = getCombatDecision(fight, fight.actingPlayer)
            expectEqual(optionsOfType(early.options, 'combatManeuver').length, 0, 'before range')

            passUntil(fight, CombatStep.DetermineRange)
            const decision = getCombatDecision(fight, fight.actingPlayer)
            const [option] = optionsOfType(decision.options, 'combatManeuver')
            expectEqual(!!option, true, 'maneuver offered')
            expectEqual(optionsOfType(decision.options, 'combatStrike').length, 0, 'no strike')

            applyOption(decision, option)
            expectEqual(getCombat(fight).range, CombatRange.Long, 'range')
            expectEqual(card.isIn.ready, true, 'the card is played')
            expectEqual(
                fight.actingPlayer.hand.length,
                fight.actingPlayer.handSize,
                'drawn back to the hand size',
            )
        },
    },
    {
        name: 'Behind You at superior is a dodge in the strike step, and is not offered in round 2',
        run() {
            const fight = createFight(3, 3)
            const card = giveBehindYou(
                fight,
                fight.defendingPlayer,
                fight.defending,
                DisciplineLevel.SUPERIOR,
            )
            passUntil(fight, CombatStep.Strike)
            must(
                botMutations.COMBAT_chooseStrike.act(fight.actingPlayer, {
                    minion: fight.acting,
                    strike: createHandStrike(getCombat(fight).acting),
                }),
                'acting strikes',
            )
            const decision = getCombatDecision(fight, fight.defendingPlayer)
            // The random starting hand may hold other copies of the card
            const dodges = optionsOfType(decision.options, 'combatStrike').filter(
                option => option.strike.dodge && option.card == card,
            )
            expectEqual(dodges.length, 1, 'dodge offered')
            expectEqual(dodges[0].strike.source?.oid, dodges[0].card?.oid, 'strike source')

            // First round only
            getCombat(fight).round = 2
            const later = getCombatDecision(fight, fight.defendingPlayer)
            expectEqual(
                optionsOfType(later.options, 'combatStrike').filter(option => option.strike.dodge)
                    .length,
                0,
                'dodge in round 2',
            )
        },
    },
    {
        name: 'Govern dodges a hand strike with Behind You, and takes no damage',
        run() {
            const fight = createFight(3, 3)
            giveBehindYou(fight, fight.defendingPlayer, fight.defending, DisciplineLevel.SUPERIOR)
            passUntil(fight, CombatStep.Strike)
            must(
                botMutations.COMBAT_chooseStrike.act(fight.actingPlayer, {
                    minion: fight.acting,
                    strike: createHandStrike(getCombat(fight).acting),
                }),
                'acting strikes',
            )
            const decision = getCombatDecision(fight, fight.defendingPlayer)
            const chosen = new GovernAgent().choose(decision)
            expectEqual(chosen.type == 'combatStrike' && chosen.strike.dodge, true, 'dodge chosen')
            applyOption(decision, chosen)
            passUntil(fight, null)
            expectEqual(fight.defending.blood, 3, 'defending blood')
        },
    },
    {
        name: 'once the combat is over, the combat cards of both bots go to the ash heap',
        run() {
            const fight = createFight(3, 3)
            const card = giveBehindYou(
                fight,
                fight.defendingPlayer,
                fight.defending,
                DisciplineLevel.SUPERIOR,
            )
            passUntil(fight, CombatStep.Strike)
            must(
                botMutations.COMBAT_chooseStrike.act(fight.actingPlayer, {
                    minion: fight.acting,
                    strike: createHandStrike(getCombat(fight).acting),
                }),
                'acting strikes',
            )
            const decision = getCombatDecision(fight, fight.defendingPlayer)
            const dodge = decision.options.find(
                option => option.type == 'combatStrike' && option.card == card,
            )
            if (!dodge) {
                throw new ScenarioFailure('Behind You is not offered')
            }
            applyOption(decision, dodge)
            expectEqual(card.region == fight.defendingPlayer.ready, true, 'still in play')
            for (let i = 0; i < 40 && fight.gameState.combat; i++) {
                const combat = fight.gameState.combat
                const current = getCombatDecision(fight, combat.impulsePlayer)
                const pass = current.options.find(option => option.type == 'combatPass')
                if (!pass) {
                    throw new ScenarioFailure('Cannot pass')
                }
                applyOption(current, pass)
            }
            expectEqual(fight.gameState.combat, null, 'combat over')
            applyPendingCleanup(fight.gameState, fight.defendingPlayer)
            expectEqual(card.region == fight.defendingPlayer.ashHeap, true, 'in the ash heap')
        },
    },
    {
        name: 'Govern does not dodge when the opposing strike is out of range',
        run() {
            const fight = createFight(3, 3)
            giveBehindYou(fight, fight.defendingPlayer, fight.defending, DisciplineLevel.SUPERIOR)
            getCombat(fight).range = CombatRange.Long
            passUntil(fight, CombatStep.Strike)
            must(
                botMutations.COMBAT_chooseStrike.act(fight.actingPlayer, {
                    minion: fight.acting,
                    strike: createHandStrike(getCombat(fight).acting),
                }),
                'acting strikes',
            )
            const decision = getCombatDecision(fight, fight.defendingPlayer)
            const chosen = new GovernAgent().choose(decision)
            expectEqual(chosen.type == 'combatStrike' && chosen.strike.dodge, false, 'no dodge')
        },
    },
    {
        name: 'Govern maneuvers to long range when it is the weaker minion, not when it is stronger',
        run() {
            const weak = createFight(3, 3)
            giveBehindYou(weak, weak.actingPlayer, weak.acting, DisciplineLevel.INFERIOR)
            getCombat(weak).defending.strength = 3
            passUntil(weak, CombatStep.DetermineRange)
            const decision = getCombatDecision(weak, weak.actingPlayer)
            const chosen = new GovernAgent().choose(decision)
            expectEqual(chosen.type, 'combatManeuver', 'weaker minion maneuvers')

            const strong = createFight(3, 3)
            giveBehindYou(strong, strong.actingPlayer, strong.acting, DisciplineLevel.INFERIOR)
            getCombat(strong).acting.strength = 3
            passUntil(strong, CombatStep.DetermineRange)
            const strongChoice = new GovernAgent().choose(
                getCombatDecision(strong, strong.actingPlayer),
            )
            expectEqual(strongChoice.type, 'combatPass', 'stronger minion stays close')
        },
    },
]
