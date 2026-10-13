import { Card } from '@/shared/model/Card.ts'
import { botMutations } from '@/shared/state/botMutations.ts'
import { createHandStrike, createStrike, createDodgeStrike } from '@/shared/state/combatState.ts'
import { CombatStep, CombatRange } from '@/shared/types/state.ts'
import {
    Scenario,
    createFight,
    damageResolution,
    expectEqual,
    expectRegion,
    expectStep,
    getCombat,
    maneuver,
    must,
    mustRefuse,
    pass,
    passUntil,
    press,
    strikeRound,
    strikeRoundToEnd,
    strikes,
} from './helpers.ts'

export const SCENARIOS: Scenario[] = [
    {
        name: 'a round of hand strikes: 1 damage each, mended, no press so the combat ends',
        run() {
            const fight = createFight(3, 3)
            strikeRound(fight)
            passUntil(fight, null)
            expectEqual(fight.acting.blood, 2, 'acting blood')
            expectEqual(fight.defending.blood, 2, 'defending blood')
            expectRegion(fight.acting, 'ready')
            expectRegion(fight.defending, 'ready')
        },
    },
    {
        name: 'the strike step cannot be passed, and strikes are chosen in order',
        run() {
            const fight = createFight(3, 3)
            passUntil(fight, CombatStep.Strike)
            mustRefuse(botMutations.COMBAT_pass.act(fight.actingPlayer, {}), 'pass')
            mustRefuse(
                botMutations.COMBAT_chooseStrike.act(fight.defendingPlayer, {
                    minion: fight.defending,
                    strike: createHandStrike(getCombat(fight).defending),
                }),
                'strike out of order',
            )
        },
    },
    {
        name: 'only the impulse player can move, and only in the matching step',
        run() {
            const fight = createFight(3, 3)
            mustRefuse(botMutations.COMBAT_pass.act(fight.defendingPlayer, {}), 'pass out of turn')
            mustRefuse(
                botMutations.COMBAT_maneuver.act(fight.actingPlayer, { minion: fight.acting }),
                'maneuver before the range step',
            )
            mustRefuse(
                botMutations.COMBAT_press.act(fight.actingPlayer, { minion: fight.acting }),
                'press before the press step',
            )
        },
    },
    {
        name: 'a maneuver to long range: hand strikes do nothing, a ranged strike works',
        run() {
            const fight = createFight(3, 3)
            passUntil(fight, CombatStep.DetermineRange)
            maneuver(fight.actingPlayer, fight.acting)
            expectEqual(getCombat(fight).range, CombatRange.Long, 'range')
            // The impulse went to the opponent: no second maneuver in a row
            mustRefuse(
                botMutations.COMBAT_maneuver.act(fight.actingPlayer, { minion: fight.acting }),
                'second maneuver in a row',
            )
            strikeRound(fight, createStrike('Gun', { damage: 2, ranged: true }))
            passUntil(fight, null)
            expectEqual(fight.acting.blood, 3, 'acting blood (hand strike at long range)')
            expectEqual(fight.defending.blood, 1, 'defending blood (ranged strike)')
        },
    },
    {
        name: 'maneuvers offset each other, passing facing a maneuver closes the window',
        run() {
            const fight = createFight(3, 3)
            passUntil(fight, CombatStep.DetermineRange)
            maneuver(fight.actingPlayer, fight.acting)
            maneuver(fight.defendingPlayer, fight.defending)
            expectEqual(getCombat(fight).range, CombatRange.Close, 'range back to close')
            maneuver(fight.actingPlayer, fight.acting)
            expectEqual(getCombat(fight).range, CombatRange.Long, 'range long again')
            pass(fight.defendingPlayer, 'defending passes')
            expectStep(fight, CombatStep.BeforeStrikes)
        },
    },
    {
        name: 'the acting minion passes, the opponent maneuvers, the acting minion can answer',
        run() {
            const fight = createFight(3, 3)
            passUntil(fight, CombatStep.DetermineRange)
            pass(fight.actingPlayer, 'acting passes')
            expectStep(fight, CombatStep.DetermineRange)
            maneuver(fight.defendingPlayer, fight.defending)
            expectEqual(getCombat(fight).impulsePlayer, fight.actingPlayer, 'impulse back')
            pass(fight.actingPlayer, 'acting passes again')
            expectStep(fight, CombatStep.BeforeStrikes)
            expectEqual(getCombat(fight).range, CombatRange.Long, 'range')
        },
    },
    {
        name: 'a maneuver from a strike card chooses the strike of the round',
        run() {
            const fight = createFight(3, 3)
            passUntil(fight, CombatStep.DetermineRange)
            const gun = createStrike('Gun', { damage: 2, ranged: true })
            maneuver(fight.actingPlayer, fight.acting, gun)
            pass(fight.defendingPlayer, 'defending passes')
            passUntil(fight, CombatStep.Strike)
            // The acting minion is skipped: its strike is already chosen
            expectEqual(getCombat(fight).impulsePlayer, fight.defendingPlayer, 'strike impulse')
            strikes(fight)
            passUntil(fight, null)
            expectEqual(fight.defending.blood, 1, 'defending blood')
            expectEqual(fight.acting.blood, 3, 'acting blood (hand strike at long range)')
        },
    },
    {
        name: 'a dodge protects from a hand strike',
        run() {
            const fight = createFight(3, 3)
            strikeRound(fight, undefined, createDodgeStrike())
            passUntil(fight, null)
            expectEqual(fight.acting.blood, 3, 'acting blood')
            expectEqual(fight.defending.blood, 3, 'defending blood')
        },
    },
    {
        name: 'a dodge protects from first strike aggravated damage',
        run() {
            const fight = createFight(3, 1)
            strikeRound(
                fight,
                createStrike('Claws', { damage: 3, aggravated: true, firstStrike: true }),
                createDodgeStrike(),
            )
            passUntil(fight, null)
            expectEqual(fight.defending.blood, 1, 'defending blood')
            expectRegion(fight.defending, 'ready')
        },
    },
    {
        name: 'first strike: the victim goes to torpor and its own strike is lost',
        run() {
            const fight = createFight(3, 1)
            strikeRoundToEnd(fight, createStrike('Quick', { damage: 2, firstStrike: true }))
            // 1 damage mended with the last blood, 1 not: wounded
            expectEqual(fight.defending.blood, 0, 'defending blood')
            expectRegion(fight.defending, 'torpor')
            passUntil(fight, null)
            expectEqual(fight.acting.blood, 3, 'the defending strike was never resolved')
        },
    },
    {
        name: 'first strike from both minions resolves simultaneously',
        run() {
            const fight = createFight(3, 3)
            const quick = createStrike('Quick', { damage: 1, firstStrike: true })
            strikeRound(fight, quick, quick)
            passUntil(fight, null)
            expectEqual(fight.acting.blood, 2, 'acting blood')
            expectEqual(fight.defending.blood, 2, 'defending blood')
        },
    },
    {
        name: 'combat ends resolves first, nothing else happens, the end of round step still does',
        run() {
            const fight = createFight(3, 3)
            strikeRound(fight, createStrike('Flee', { combatEnds: true }))
            expectStep(fight, CombatStep.EndOfRound)
            passUntil(fight, null)
            expectEqual(fight.acting.blood, 3, 'acting blood')
            expectEqual(fight.defending.blood, 3, 'defending blood')
        },
    },
    {
        name: 'combat ends is not stopped by a dodge',
        run() {
            const fight = createFight(3, 3)
            strikeRound(fight, createStrike('Flee', { combatEnds: true }), createDodgeStrike())
            expectStep(fight, CombatStep.EndOfRound)
        },
    },
    {
        name: 'steal blood happens before damage is mended, and the excess drains off',
        run() {
            const fight = createFight(0, 3)
            const capacity = fight.acting.minionAttrs.capacity
            fight.acting.blood = capacity - 1
            strikeRound(fight, createStrike('Drain', { stealBlood: 2 }))
            passUntil(fight, null)
            // Capacity - 1 + 2 = capacity + 1, capped, then 1 damage mended
            expectEqual(fight.acting.blood, capacity - 1, 'acting blood')
            expectEqual(fight.defending.blood, 1, 'defending blood')
        },
    },
    {
        name: 'a vampire that cannot mend all damage is wounded and goes to torpor',
        run() {
            const fight = createFight(3, 1)
            strikeRoundToEnd(fight, createStrike('Punch', { damage: 3 }))
            expectEqual(fight.defending.blood, 0, 'defending blood')
            expectRegion(fight.defending, 'torpor')
            expectRegion(fight.acting, 'ready')
        },
    },
    {
        name: 'a combatant going to torpor ends the combat: no press step',
        run() {
            const fight = createFight(3, 1)
            strikeRound(fight, createStrike('Punch', { damage: 3 }))
            passUntil(fight, CombatStep.EndOfRound)
            passUntil(fight, null)
        },
    },
    {
        name: 'rulebook, Nassir: 1 blood, 1 aggravated damage: torpor with 1 blood',
        run() {
            const fight = createFight(3, 1)
            strikeRoundToEnd(fight, createStrike('Claws', { damage: 1, aggravated: true }))
            expectEqual(fight.defending.blood, 1, 'defending blood')
            expectRegion(fight.defending, 'torpor')
        },
    },
    {
        name: 'rulebook, Tamoszius: 2 blood, 3 aggravated damage: torpor with 0 blood',
        run() {
            const fight = createFight(3, 2)
            strikeRoundToEnd(fight, createStrike('Claws', { damage: 3, aggravated: true }))
            expectEqual(fight.defending.blood, 0, 'defending blood')
            expectRegion(fight.defending, 'torpor')
        },
    },
    {
        name: 'rulebook, Ryan: 1 blood, 2 normal and 1 aggravated damage: burned',
        run() {
            const fight = createFight(3, 1)
            damageResolution(fight, fight.defending, 2, 1)
            passUntil(fight, CombatStep.EndOfRound)
            expectRegion(fight.defending, 'ashHeap')
        },
    },
    {
        name: 'aggravated damage on a vampire without blood to spare burns it',
        run() {
            const fight = createFight(3, 0)
            strikeRoundToEnd(fight, createStrike('Claws', { damage: 2, aggravated: true }))
            expectRegion(fight.defending, 'ashHeap')
        },
    },
    {
        name: 'damage prevention: victims prevent one at a time, acting minion first',
        run() {
            const fight = createFight(3, 3)
            strikeRound(
                fight,
                createStrike('Punch', { damage: 2 }),
                createStrike('Kick', { damage: 1 }),
            )
            // Both are victims: 1 damage on the acting minion, 2 on the defending one
            expectStep(fight, CombatStep.DamageResolution)
            expectEqual(getCombat(fight).impulsePlayer, fight.actingPlayer, 'first victim')
            must(
                botMutations.COMBAT_preventDamage.act(fight.actingPlayer, {
                    minion: fight.acting,
                    amount: 1,
                    aggravated: false,
                }),
                'prevent',
            )
            mustRefuse(
                botMutations.COMBAT_preventDamage.act(fight.actingPlayer, {
                    minion: fight.acting,
                    amount: 1,
                    aggravated: false,
                }),
                'prevent damage that is not there',
            )
            pass(fight.actingPlayer, 'acting victim passes')
            expectEqual(getCombat(fight).impulsePlayer, fight.defendingPlayer, 'second victim')
            pass(fight.defendingPlayer, 'defending victim passes')
            expectEqual(fight.acting.blood, 3, 'acting blood: the damage was prevented')
            expectEqual(fight.defending.blood, 1, 'defending blood: 2 damage mended')
        },
    },
    {
        name: 'a press to continue starts another round',
        run() {
            const fight = createFight(5, 5)
            strikeRound(fight)
            passUntil(fight, CombatStep.Press)
            press(fight.actingPlayer, fight.acting)
            pass(fight.defendingPlayer, 'defending passes')
            passUntil(fight, CombatStep.BeforeRange)
            expectEqual(getCombat(fight).round, 2, 'round')
            expectEqual(getCombat(fight).range, CombatRange.Close, 'range')
            expectEqual(getCombat(fight).acting.strike, null, 'strike of the new round')
            strikeRound(fight)
            passUntil(fight, null)
            expectEqual(fight.acting.blood, 3, 'acting blood after two rounds')
            expectEqual(fight.defending.blood, 3, 'defending blood after two rounds')
        },
    },
    {
        name: 'a press is cancelled by the opponent, and nobody presses twice in a row',
        run() {
            const fight = createFight(5, 5)
            strikeRound(fight)
            passUntil(fight, CombatStep.Press)
            press(fight.actingPlayer, fight.acting)
            mustRefuse(
                botMutations.COMBAT_press.act(fight.actingPlayer, { minion: fight.acting }),
                'second press in a row',
            )
            press(fight.defendingPlayer, fight.defending)
            expectEqual(getCombat(fight).pressed, false, 'pressed')
            pass(fight.actingPlayer, 'acting passes')
            passUntil(fight, null)
        },
    },
    {
        name: 'an ally burns when it has no life left',
        run() {
            const fight = createFight(3, 1)
            // An ally is a minion that is not a vampire, its life is its blood
            ;(fight.defending as Card).vampireAttrs = undefined
            strikeRoundToEnd(fight, createStrike('Punch', { damage: 2 }))
            expectRegion(fight.defending, 'ashHeap')
        },
    },
    {
        name: 'ending the combat by hand stops everything, whoever has the impulse',
        run() {
            const fight = createFight(3, 3)
            must(botMutations.COMBAT_end.act(fight.defendingPlayer, {}), 'end combat')
            expectStep(fight, null)
        },
    },
]
