import { botMutations } from '@/shared/state/botMutations.ts'
import { createDodgeStrike } from '@/shared/state/combatState.ts'
import { CombatStep, CombatRange } from '@/shared/types/state.ts'
import { DisciplineLevel, Discipline } from '@/shared/const/model.ts'
import { applyOption } from '@/shared/bot/referee.ts'
import { CombatCardOption, optionsOfType } from '@/shared/bot/types.ts'
import {
    Fight,
    Scenario,
    ScenarioFailure,
    expectEqual,
    getCombat,
    must,
    mustRefuse,
    passUntil,
    strikes,
} from './helpers.ts'
import { getCombatDecision } from './combatCards.ts'
import { cardOptionsOf, createBrujahFight, playCardOption } from './brujah.ts'
import { DUST_UP_ID, GRAPPLE_ID, PURSUIT_ID, QUICKNESS_ID, TASTE_OF_VITAE_ID } from '../cardIds.ts'

// The player with the impulse chooses the option of the type that the test accepts
function decideCombat<T extends CombatCardOption['type']>(
    fight: Fight,
    type: T,
    accept: (option: Extract<CombatCardOption, { type: T }>) => boolean = () => true,
): void {
    const player = getCombat(fight).impulsePlayer
    const decision = getCombatDecision(fight, player)
    const option = decision.options.find(
        (candidate): candidate is Extract<CombatCardOption, { type: T }> =>
            candidate.type == type && accept(candidate as Extract<CombatCardOption, { type: T }>),
    )
    if (!option) {
        throw new ScenarioFailure(`${type} is not offered at ${getCombat(fight).step}`)
    }
    applyOption(decision, option)
}

const countOptions = (fight: Fight, type: CombatCardOption['type']) =>
    getCombatDecision(fight, getCombat(fight).impulsePlayer).options.filter(
        option => option.type == type,
    ).length

export const BRUJAH_COMBAT_SCENARIOS: Scenario[] = [
    {
        name: 'Quickness is played after the pair of strikes: the minion strikes again alone, the opponent has no strike',
        run() {
            const fight = createBrujahFight(
                QUICKNESS_ID,
                DisciplineLevel.SUPERIOR,
                3,
                Discipline.Celerity,
            )
            expectEqual(countOptions(fight, 'combatAdditionalStrike'), 0, 'before the range')
            passUntil(fight, CombatStep.Strike)
            strikes(fight)
            passUntil(fight, CombatStep.AdditionalStrikes)
            expectEqual(fight.defending.blood, 2, 'blood of the defender after the first pair')
            expectEqual(
                countOptions(fight, 'combatAdditionalStrike'),
                2,
                'both levels: limited and not',
            )

            decideCombat(fight, 'combatAdditionalStrike', option => option.limited)
            const combat = getCombat(fight)
            expectEqual(combat.acting.additionalStrikes, 1, 'additional strikes')
            expectEqual(combat.acting.limitedAdditionalGained, true, 'limited gained')
            expectEqual(
                combat.playedThisRound[fight.acting.oid]?.includes(QUICKNESS_ID),
                true,
                'the play is remembered',
            )
            expectEqual(combat.impulsePlayer, fight.actingPlayer, 'impulse')

            passUntil(fight, CombatStep.Strike)
            expectEqual(combat.strikePair, 1, 'second pair')
            expectEqual(combat.defending.strikesInPair, false, 'the defender sits it out')
            expectEqual(combat.impulsePlayer, fight.actingPlayer, 'the acting minion chooses')
            decideCombat(fight, 'combatStrike')
            passUntil(fight, CombatStep.AdditionalStrikes)
            expectEqual(
                fight.defending.blood,
                1,
                'blood of the defender after the additional strike',
            )
            expectEqual(
                fight.acting.blood,
                2,
                'the acting minion took no damage in the second pair',
            )
            passUntil(fight, CombatStep.Press)
        },
    },
    {
        name: 'a limited additional strike is gained once per round, the unlimited level of Quickness is still offered',
        run() {
            const fight = createBrujahFight(
                QUICKNESS_ID,
                DisciplineLevel.SUPERIOR,
                3,
                Discipline.Celerity,
            )
            passUntil(fight, CombatStep.Strike)
            strikes(fight)
            passUntil(fight, CombatStep.AdditionalStrikes)
            getCombat(fight).acting.limitedAdditionalGained = true
            const options = optionsOfType(
                getCombatDecision(fight, fight.actingPlayer).options,
                'combatAdditionalStrike',
            )
            expectEqual(options.length, 1, 'options')
            expectEqual(options[0].limited, false, 'only the unlimited one')
        },
    },
    {
        name: 'Pursuit is a maneuver at inferior and a limited additional strike at superior',
        run() {
            const fight = createBrujahFight(
                PURSUIT_ID,
                DisciplineLevel.SUPERIOR,
                3,
                Discipline.Celerity,
            )
            passUntil(fight, CombatStep.DetermineRange)
            expectEqual(countOptions(fight, 'combatManeuver'), 1, 'maneuver')
            expectEqual(
                countOptions(fight, 'combatAdditionalStrike'),
                0,
                'no additional strike yet',
            )
            passUntil(fight, CombatStep.Strike)
            strikes(fight)
            passUntil(fight, CombatStep.AdditionalStrikes)
            const options = optionsOfType(
                getCombatDecision(fight, fight.actingPlayer).options,
                'combatAdditionalStrike',
            )
            expectEqual(options.length, 1, 'additional strike')
            expectEqual(options[0].limited, true, 'limited')
            expectEqual(countOptions(fight, 'combatManeuver'), 0, 'no maneuver in this window')
        },
    },
    {
        name: 'Dust Up with Animalism is an undodgeable hand strike +1: the dodge does not protect',
        run() {
            const fight = createBrujahFight(
                DUST_UP_ID,
                DisciplineLevel.INFERIOR,
                3,
                Discipline.Animalism,
            )
            passUntil(fight, CombatStep.Strike)
            const options = cardOptionsOf(fight, 'combatStrike', fight.card)
            expectEqual(options.length, 1, 'options')
            expectEqual(options[0].strike.damage, 2, 'damage')
            expectEqual(options[0].strike.undodgeable, true, 'undodgeable')
            playCardOption(fight, 'combatStrike', fight.card)
            must(
                botMutations.COMBAT_chooseStrike.act(fight.defendingPlayer, {
                    minion: fight.defending,
                    strike: createDodgeStrike(),
                }),
                'the defender dodges',
            )
            passUntil(fight, CombatStep.AdditionalStrikes)
            expectEqual(fight.defending.blood, 1, 'the dodge did not protect: 2 damage')
        },
    },
    {
        name: 'Dust Up with Celerity is a dodge with one additional strike, if none was gained from a limited card',
        run() {
            const fight = createBrujahFight(
                DUST_UP_ID,
                DisciplineLevel.INFERIOR,
                3,
                Discipline.Celerity,
            )
            passUntil(fight, CombatStep.Strike)
            const [option] = cardOptionsOf(fight, 'combatStrike', fight.card)
            expectEqual(option.strike.dodge, true, 'dodge')
            expectEqual(option.additional?.limited, true, 'additional strike')

            getCombat(fight).acting.limitedAdditionalGained = true
            const [again] = cardOptionsOf(fight, 'combatStrike', fight.card)
            expectEqual(again.additional, undefined, 'no additional strike once the limit is used')
            getCombat(fight).acting.limitedAdditionalGained = false

            playCardOption(fight, 'combatStrike', fight.card)
            expectEqual(getCombat(fight).acting.additionalStrikes, 1, 'additional strikes')
            strikes(fight)
            passUntil(fight, CombatStep.AdditionalStrikes)
            expectEqual(fight.acting.blood, 3, 'the dodge protected the acting minion')
        },
    },
    {
        name: 'Immortal Grapple: before the strikes at close range only, then hand strikes only for the round',
        run() {
            const fight = createBrujahFight(GRAPPLE_ID, DisciplineLevel.SUPERIOR)
            expectEqual(countOptions(fight, 'combatGrapple'), 0, 'before the range')
            passUntil(fight, CombatStep.DetermineRange)
            expectEqual(countOptions(fight, 'combatGrapple'), 0, 'range step')
            passUntil(fight, CombatStep.BeforeStrikes)
            getCombat(fight).range = CombatRange.Long
            expectEqual(countOptions(fight, 'combatGrapple'), 0, 'long range')
            getCombat(fight).range = CombatRange.Close
            expectEqual(countOptions(fight, 'combatGrapple'), 2, 'both levels at close range')

            decideCombat(fight, 'combatGrapple', option => option.press)
            expectEqual(getCombat(fight).handStrikesOnly, true, 'hand strikes only')
            passUntil(fight, CombatStep.Strike)
            mustRefuse(
                botMutations.COMBAT_chooseStrike.act(fight.actingPlayer, {
                    minion: fight.acting,
                    strike: createDodgeStrike(),
                }),
                'a dodge in a grappled round',
            )
            strikes(fight)
            passUntil(fight, CombatStep.Press)
        },
    },
    {
        name: 'a superior Immortal Grapple gives a press, and the next round is at close range with no range step',
        run() {
            const fight = createBrujahFight(GRAPPLE_ID, DisciplineLevel.SUPERIOR)
            passUntil(fight, CombatStep.BeforeStrikes)
            decideCombat(fight, 'combatGrapple', option => option.press)
            expectEqual(getCombat(fight).acting.pressesGranted, 1, 'press granted')
            passUntil(fight, CombatStep.Strike)
            strikes(fight)
            passUntil(fight, CombatStep.Press)

            expectEqual(countOptions(fight, 'combatPress'), 1, 'the granted press')
            decideCombat(fight, 'combatPress', option => !!option.granted)
            expectEqual(getCombat(fight).pressed, true, 'press to continue')
            expectEqual(getCombat(fight).acting.pressesGranted, 0, 'the press is used up')

            passUntil(fight, CombatStep.BeforeRange)
            const combat = getCombat(fight)
            expectEqual(combat.round, 2, 'round')
            expectEqual(combat.handStrikesOnly, false, 'the restriction ended with the round')
            passUntil(fight, CombatStep.BeforeStrikes)
            expectEqual(combat.round, 2, 'still round 2')
            expectEqual(combat.range, CombatRange.Close, 'close range')
            expectEqual(combat.closeNextRound, false, 'consumed')
        },
    },
    {
        name: 'Taste of Vitae gives back the blood the opponent lost to damage this round, at the end of the round',
        run() {
            const fight = createBrujahFight(TASTE_OF_VITAE_ID, null)
            getCombat(fight).acting.strength = 2
            passUntil(fight, CombatStep.Strike)
            expectEqual(
                countOptions(fight, 'combatGainBlood'),
                0,
                'not before the end of the round',
            )
            strikes(fight)
            passUntil(fight, CombatStep.EndOfRound)
            expectEqual(fight.defending.blood, 1, 'the defender mended 2')
            expectEqual(fight.acting.blood, 2, 'the acting minion mended 1')
            const options = optionsOfType(
                getCombatDecision(fight, fight.actingPlayer).options,
                'combatGainBlood',
            )
            expectEqual(options.length, 1, 'options')
            expectEqual(options[0].amount, 2, 'amount')
            decideCombat(fight, 'combatGainBlood')
            expectEqual(fight.acting.blood, 4, 'blood gained')
            expectEqual(countOptions(fight, 'combatGainBlood'), 0, 'once per round')
        },
    },
    {
        name: 'Taste of Vitae is not offered when the opponent lost no blood',
        run() {
            const fight = createBrujahFight(TASTE_OF_VITAE_ID, null)
            passUntil(fight, CombatStep.Strike)
            decideCombat(fight, 'combatStrike')
            must(
                botMutations.COMBAT_chooseStrike.act(fight.defendingPlayer, {
                    minion: fight.defending,
                    strike: createDodgeStrike(),
                }),
                'the defender dodges',
            )
            passUntil(fight, CombatStep.EndOfRound)
            expectEqual(fight.defending.blood, 3, 'no damage dealt')
            expectEqual(countOptions(fight, 'combatGainBlood'), 0, 'options')
        },
    },
]
