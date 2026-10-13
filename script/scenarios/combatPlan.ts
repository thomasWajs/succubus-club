import { CombatStep } from '@/shared/types/state.ts'
import { Discipline, DisciplineLevel } from '@/shared/const/model.ts'
import {
    handStrike as handStrikeEffect,
    additionalStrike as additionalStrikeEffect,
    beforeRange as beforeRangeCondition,
    setStrength as setStrengthEffect,
} from '@/shared/cardImpl/catalog/builders.ts'
import { DEFAULT_PROFILE } from '@/shared/bot/utility/profile.ts'
import { AttachedKit } from '@/shared/bot/utility/minionProfile.ts'
import {
    SimCombatant,
    CombatSim,
    applyMove,
    Side,
    SimCard,
} from '@/shared/bot/utility/combatModel.ts'
import { combatCards } from '@/shared/bot/utility/combatSetup.ts'
import { chooseMove } from '@/shared/bot/utility/combatPolicy.ts'
import {
    planWeightsOf,
    planMove,
    describeMove,
    planLine,
    planCombat,
} from '@/shared/bot/utility/combatPlan.ts'
import { newStrike } from '@/shared/state/combatRules.ts'
import { DODGE_CARD, MANEUVER_CARD, PREVENT_KIT, fightProfile, testCard } from './combatPosition.ts'
import {
    CARD_USER,
    MAGNUM_KIT,
    factsOfCard,
    retainerKit,
    simFight,
    simPassUntil,
} from './combatModel.ts'
import { Scenario, ScenarioFailure, expectEqual } from './helpers.ts'
import { expectClose } from './assessment.ts'

/**
 * The plan of a combat: the move chosen by playing out what follows, against the hands that the other
 * side may hold.
 */

const PLAN_WEIGHTS = planWeightsOf(DEFAULT_PROFILE)

const SLAM_CARD = testCard('slam', { kind: 'combat', effects: [handStrikeEffect(2)] })

const UNDODGEABLE_CARD = testCard('trick', {
    kind: 'combat',
    effects: [handStrikeEffect(0, { undodgeable: true })],
})

// The strike step with the acting minion's hand strike chosen: the defending minion is to answer
function answeringStrike(
    acting: Partial<SimCombatant>,
    defending: Partial<SimCombatant>,
): CombatSim {
    const sim = simPassUntil(simFight(acting, defending), CombatStep.Strike)
    return applyMove(sim, {
        type: 'strike',
        strike: newStrike('Hand strike', { damage: sim.acting.strength, isHand: true }),
    }).sim
}

// A combat played to its end: the sides in `planning` choose by the plan, the other by the policy. The line is what
// each side did that was not a pass, in order.
function playPlanned(sim: CombatSim, planning: Side[]): { sim: CombatSim; line: string[] } {
    const line: string[] = []
    let current = sim
    for (let i = 0; i < 200 && !current.closed; i++) {
        const side = current.impulsePlayer
        const move =
            planning.includes(side) ?
                planMove(PLAN_WEIGHTS, current, []).move
            :   chooseMove(PLAN_WEIGHTS.policy, current)
        if (move.type != 'pass') {
            line.push(`${side}: ${describeMove(current, move)}`)
        }
        current = applyMove(current, move).sim
    }
    if (!current.closed) {
        throw new ScenarioFailure('The combat did not end')
    }
    return { sim: current, line }
}

export const COMBAT_PLAN_SCENARIOS: Scenario[] = [
    {
        name: 'Combat plan: a move the rules force is played as it is, and two cards that make the same move are one choice',
        run() {
            const forced = planMove(PLAN_WEIGHTS, simPassUntil(simFight(), CombatStep.Strike), [])
            expectEqual(forced.options.length, 0, 'nothing to weigh with the hand strike alone')
            expectEqual(forced.move.type, 'strike', 'the hand strike')
            const twins = planMove(
                PLAN_WEIGHTS,
                answeringStrike({}, { cards: [DODGE_CARD, DODGE_CARD] }),
                [],
            )
            expectEqual(twins.options.length, 2, 'the hand strike and one dodge, not two')
        },
    },
    {
        name: 'Combat plan: a strike card that sends the other to torpor past its prevention is played, and the plan prints as the line it expects',
        run() {
            const sim = answeringStrike(
                { blood: 3, attached: [PREVENT_KIT] },
                { strength: 3, blood: 6, cards: [SLAM_CARD] },
            )
            const plan = planMove(PLAN_WEIGHTS, sim, [])
            expectEqual(plan.move.type, 'strike', 'a strike')
            expectEqual(
                plan.move.card,
                0,
                'with the card: 5 damage, less 1 prevented, still sends it to torpor',
            )
            const plain = plan.options.find(option => option.move.card === undefined)
            expectEqual(
                plan.options[0].value - (plain?.value ?? 0) > 1,
                true,
                'worth much more than the plain strike, which 1 prevention keeps out of torpor',
            )
            const line = planLine(PLAN_WEIGHTS, sim, plan.move)
            expectEqual(line[0], 'defending: strike Hand strike +2 (slam)', 'the plan, printed')
            expectEqual(describeMove(sim, plan.move), 'strike Hand strike +2 (slam)', 'its move')
        },
    },
    {
        name: 'Combat plan: the plan is never worse than the policy on the hands it was played against, and keeps the policy move when the others are not clearly better',
        run() {
            const sims = [
                answeringStrike(
                    { blood: 3, attached: [PREVENT_KIT] },
                    { strength: 3, cards: [SLAM_CARD] },
                ),
                answeringStrike({}, { cards: [DODGE_CARD, MANEUVER_CARD] }),
                simPassUntil(
                    simFight({ attached: [MAGNUM_KIT] }, { cards: [MANEUVER_CARD] }),
                    CombatStep.DetermineRange,
                ),
            ]
            for (const sim of sims) {
                const plan = planMove(PLAN_WEIGHTS, sim, [])
                const policy = chooseMove(PLAN_WEIGHTS.policy, sim)
                const asPolicy = plan.options.find(
                    option => JSON.stringify(option.move) == JSON.stringify(policy),
                )
                expectEqual(
                    plan.options[0].value >= (asPolicy?.value ?? -Infinity),
                    true,
                    'the best move is at least as good as the policy move',
                )
            }
            const even = simPassUntil(simFight(), CombatStep.DetermineRange)
            expectEqual(
                planMove(PLAN_WEIGHTS, even, []).move.type,
                chooseMove(PLAN_WEIGHTS.policy, even).type,
                'an even fight: the policy move',
            )
        },
    },
    {
        name: 'Combat plan: against a hand believed to hold dodges the strike that cannot be dodged is played, against an empty hand the free one',
        run() {
            const presence = { [Discipline.Presence]: DisciplineLevel.INFERIOR }
            const minion = fightProfile({ disciplines: presence })
            const sim = simPassUntil(
                simFight({ strength: 3, cards: [UNDODGEABLE_CARD] }, {}),
                CombatStep.Strike,
            )
            const plan = (size: number, dodge: number) =>
                planCombat(DEFAULT_PROFILE, sim, { minion, hand: { size, densities: { dodge } } })
            const dodged = plan(5, 1)
            expectEqual(
                dodged.move.type == 'strike' && dodged.move.card,
                0,
                'the card, which no dodge stops',
            )
            const open = plan(0, 1)
            expectEqual(
                open.move.type == 'strike' && open.move.card,
                undefined,
                'an empty hand cannot dodge: the free hand strike',
            )
            const again = plan(5, 1)
            expectEqual(
                JSON.stringify(again),
                JSON.stringify(dodged),
                'the same plan, with the same values, asked twice',
            )
        },
    },
    {
        name: 'Combat plan: a move is judged by the mix of the average of the hands and the worst of them, as much of the worst as the caution says',
        run() {
            const sim = simPassUntil(
                simFight({ strength: 3, cards: [UNDODGEABLE_CARD] }),
                CombatStep.Strike,
            )
            const hands = [[], [DODGE_CARD]]
            const plainStrike = (caution: number) =>
                planMove({ ...PLAN_WEIGHTS, caution }, sim, hands).options.find(
                    option => option.move.card === undefined,
                )
            const mean = plainStrike(0)
            const worst = plainStrike(1)
            const mixed = plainStrike(0.25)
            expectEqual(mean?.value, mean?.mean, 'no caution: the average')
            expectEqual(worst?.value, worst?.worst, 'all the caution: the worst')
            expectEqual(
                (worst?.worst ?? 0) < (worst?.mean ?? 0),
                true,
                'one hand dodges it: the worst is lower than the average',
            )
            expectClose(
                mixed?.value ?? 0,
                (mean?.mean ?? 0) + 0.25 * ((mean?.worst ?? 0) - (mean?.mean ?? 0)),
                'a quarter of the way to the worst',
                0.0001,
            )
        },
    },
    {
        name: 'Combat plan: planning its own later moves inside the rollouts values a move by what the minion will do right, not by what the policy would do',
        run() {
            const quickness = testCard('quickness', {
                kind: 'combat',
                when: [{ type: 'oncePerRound' }],
                effects: [additionalStrikeEffect({ limited: true })],
            })
            const sim = simFight(
                { blood: 4, strength: 2, strengthBonus: 1, cards: [quickness] },
                {
                    blood: 4,
                    strength: 1,
                    cards: [SLAM_CARD],
                    attached: [PREVENT_KIT, retainerKit('Raven', 1), retainerKit('Crows', 2)],
                },
            )
            const options = (depth: number) => planMove({ ...PLAN_WEIGHTS, depth }, sim, []).options
            const bonus = (depth: number) =>
                options(depth).find(option => option.move.type == 'strengthBonus')?.value ?? NaN
            expectEqual(
                bonus(1) > bonus(0) + 1,
                true,
                'the policy plays the strikes at the retainers badly, planning them is worth more',
            )
            expectEqual(
                planMove({ ...PLAN_WEIGHTS, depth: 1 }, sim, []).move.type,
                'strengthBonus',
                'with the strength bonus taken first',
            )
            expectEqual(bonus(2), bonus(1), 'one level of it is all this fight has to plan')
        },
    },
    {
        name: 'Combat plan: a card costs the pool it is paid with and the card itself, which the plan counts against what it wins',
        run() {
            const worth = (card: SimCard) => {
                const sim = answeringStrike({ blood: 1 }, { strength: 3, blood: 6, cards: [card] })
                const options = planMove(PLAN_WEIGHTS, sim, []).options
                const plain = options.find(option => option.move.card === undefined)
                const played = options.find(option => option.move.card === 0)
                return (plain?.value ?? NaN) - (played?.value ?? NaN)
            }
            expectClose(
                worth(SLAM_CARD),
                DEFAULT_PROFILE.combat.cardCost,
                'it sends to torpor either way: the card is the whole difference',
                0.0001,
            )
            expectClose(
                worth({ ...SLAM_CARD, poolCost: 4 }),
                DEFAULT_PROFILE.combat.cardCost + 4,
                'and 4 pool paid for it more',
                0.0001,
            )
        },
    },
    {
        name: 'Combat plan: the plan works on copies, the combat it is given is not changed',
        run() {
            const sim = answeringStrike(
                { attached: [PREVENT_KIT] },
                { cards: [SLAM_CARD, DODGE_CARD] },
            )
            const before = JSON.stringify(sim)
            planMove(PLAN_WEIGHTS, sim, [[DODGE_CARD], []])
            expectEqual(JSON.stringify(sim), before, 'the same combat after the plan')
        },
    },
    {
        name: 'Combat plan: the cards of a whole combat are played in their order: strength, range, Immortal Grapple, the strike, Taste of Vitae',
        run() {
            const potence = { [Discipline.Potence]: DisciplineLevel.INFERIOR }
            const signpost = testCard('signpost', {
                kind: 'combat',
                when: [beforeRangeCondition],
                effects: [setStrengthEffect(3)],
            })
            const knife: AttachedKit = {
                ...MAGNUM_KIT,
                name: 'Knife',
                strikes: [{ damage: 2, ranged: false, aggravated: false, maneuver: false }],
            }
            const cards = [
                signpost,
                MANEUVER_CARD,
                ...combatCards({ ...CARD_USER, disciplines: potence }, [
                    factsOfCard('100959', 'Immortal Grapple'),
                    factsOfCard('101945', 'Taste of Vitae'),
                ]),
            ]
            const fight = (held: AttachedKit[]) =>
                playPlanned(
                    simFight(
                        { strength: 1, blood: 6, cards },
                        { strength: 1, blood: 6, attached: held },
                    ),
                    ['acting', 'defending'],
                )
            // A knife at close range: the grapple leaves it nothing but a hand strike
            const knifed = fight([knife])
            expectEqual(
                knifed.line.join(' | '),
                'acting: strength 3 (signpost) | acting: grapple (Immortal Grapple) | acting: strike Hand strike | defending: strike Hand strike | acting: gainBlood 3 (Taste of Vitae)',
                'strength, grapple, strike, blood',
            )
            // A Magnum: the other goes to long range, the answer brings the fight back to close range
            const shot = fight([MAGNUM_KIT])
            expectEqual(
                shot.line.join(' | '),
                'acting: strength 3 (signpost) | defending: maneuver | acting: maneuver (maneuver) | acting: strike Hand strike | acting: gainBlood 3 (Taste of Vitae)',
                'strength, range, strike, blood',
            )
            for (const { sim } of [knifed, shot]) {
                expectEqual(sim.defending.bloodLost > 0, true, 'the other side was hurt')
            }
        },
    },
    {
        name: 'Combat plan: the rulebook examples of aggravated damage, played by the plan: Nassir and Tamoszius go to torpor, a vampire that cannot pay is burned',
        run() {
            const claws = (damage: number): AttachedKit => ({
                ...MAGNUM_KIT,
                name: 'Claws',
                strikes: [{ damage, ranged: false, aggravated: true, maneuver: false }],
            })
            const played = (
                acting: Partial<SimCombatant>,
                blood: number,
            ): { sim: CombatSim; line: string[] } =>
                playPlanned(simFight(acting, { strength: 1, blood }), ['acting'])
            // Nassir: 1 blood, 1 aggravated damage: wounded, torpor with 1 blood
            const nassir = played({ attached: [claws(1)] }, 1)
            expectEqual(nassir.sim.defending.state, 'torpor', 'Nassir: torpor')
            expectEqual(nassir.sim.defending.blood, 1, 'Nassir: with 1 blood')
            // Tamoszius: 2 blood, 3 aggravated damage: wounded by 1, burns 2 blood for the others, torpor with 0
            const tamoszius = played({ attached: [claws(3)] }, 2)
            expectEqual(tamoszius.sim.defending.state, 'torpor', 'Tamoszius: torpor')
            expectEqual(tamoszius.sim.defending.blood, 0, 'Tamoszius: with 0 blood')
            // Ryan's example, as far as one strike goes: aggravated damage that a vampire has no blood to pay for burns it,
            // and the plan prefers the claws to the hand strike that only sends it to torpor
            const ryan = played({ strength: 2, attached: [claws(2)] }, 0)
            expectEqual(ryan.sim.defending.state, 'burned', 'Ryan: burned')
            for (const { line } of [nassir, tamoszius, ryan]) {
                expectEqual(
                    line.some(move => move.startsWith('acting: strike Claws')),
                    true,
                    'the plan chose the claws',
                )
            }
        },
    },
]
