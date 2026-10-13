import { CombatStep } from '@/shared/types/state.ts'
import { Discipline, DisciplineLevel } from '@/shared/const/model.ts'
import { Disciplines } from '@/shared/types/resources.ts'
import {
    dodge as dodgeEffect,
    maneuver as maneuverEffect,
    additionalStrike as additionalStrikeEffect,
    beforeRange as beforeRangeCondition,
    setStrength as setStrengthEffect,
    oncePerCombat as oncePerCombatCondition,
    environmentalDamage as environmentalEffect,
} from '@/shared/cardImpl/catalog/builders.ts'
import { CombatPlay } from '@/shared/cardImpl/catalog/types.ts'
import { AttachDeck } from '../attachDeck.ts'
import { BrujahDeck, MalkavDeck } from '@/shared/bot/decks.ts'
import { DEFAULT_PROFILE } from '@/shared/bot/utility/profile.ts'
import { MinionProfile, AttachedKit } from '@/shared/bot/utility/minionProfile.ts'
import { SimCard, SimCombatant, applyMove } from '@/shared/bot/utility/combatModel.ts'
import {
    policyWeightsOf,
    Hand,
    Fighter,
    forecastFight,
    netLoss,
} from '@/shared/bot/utility/combatPosition.ts'
import { chooseMove, playOut } from '@/shared/bot/utility/combatPolicy.ts'
import { believedCards, seededRandom } from '@/shared/bot/utility/combatBelief.ts'
import { Densities } from '@/shared/bot/utility/defence.ts'
import { newStrike } from '@/shared/state/combatRules.ts'
import { combatRisk } from '@/shared/bot/utility/turnPlan.ts'
import {
    MAGNUM_KIT,
    retainerKit,
    simFight,
    simMove,
    simPassUntil,
    simStrikes,
} from './combatModel.ts'
import { Scenario, attachInPlay, expectEqual } from './helpers.ts'
import { addMinions, assessAs, createRing, expectClose, holdOnly } from './assessment.ts'
import { ROUNDHOUSE_ID } from './brujah.ts'
import { MAGNUM_ID, findAnyCard } from './attachment.ts'

/**
 * The position of a combat: the default policy of the playouts, the hands believed of the others, and
 * the forecast of a fight in pool, which the threat and the plan read.
 */

const POLICY_WEIGHTS = policyWeightsOf(DEFAULT_PROFILE)

export function fightProfile(over: Partial<MinionProfile> = {}): MinionProfile {
    return {
        oid: 'fighter',
        name: 'Fighter',
        controller: 'owner',
        state: 'unlocked',
        isVampire: true,
        clan: 'Brujah',
        sect: 'Camarilla',
        title: '',
        blood: 6,
        capacity: 8,
        disciplines: {},
        bleed: 1,
        hunt: 1,
        bloodMove: 0,
        strength: 1,
        undirectedStealth: 0,
        intercept: { general: 0, directed: 0, againstBleeds: 0 },
        life: 0,
        prevention: [],
        weaponStrikes: [],
        freeManeuver: false,
        environmentalDamage: 0,
        forbiddenPlays: [],
        burnsInTorpor: false,
        attached: [],
        attachedKits: [],
        canEnterCombat: false,
        ...over,
    }
}

const fighterWith = (over: Partial<MinionProfile> = {}, hand: Hand = { cards: [] }): Fighter => ({
    profile: fightProfile(over),
    pool: 10,
    hand,
})

export const testCard = (name: string, play: CombatPlay): SimCard => ({
    cardId: `test:${name}`,
    name,
    bloodCost: 0,
    poolCost: 0,
    plays: [play],
})

export const DODGE_CARD = testCard('dodge', { kind: 'combat', effects: [dodgeEffect] })

export const MANEUVER_CARD = testCard('maneuver', { kind: 'combat', effects: [maneuverEffect] })

const FIGHT_POTENCE = { [Discipline.Potence]: DisciplineLevel.SUPERIOR }

export const PREVENT_KIT: AttachedKit = {
    ...MAGNUM_KIT,
    name: 'Shield',
    strikes: [],
    prevention: [1],
}

export const COMBAT_POSITION_SCENARIOS: Scenario[] = [
    {
        name: 'Combat position: a minion with a ranged weapon maneuvers to the long range where the other cannot strike, one with hands only keeps the range',
        run() {
            const chosen = (acting: Partial<SimCombatant>) =>
                chooseMove(
                    POLICY_WEIGHTS,
                    simPassUntil(simFight(acting), CombatStep.DetermineRange),
                )
            const armed = chosen({ attached: [MAGNUM_KIT] })
            expectEqual(armed.type, 'maneuver', 'the Magnum goes to long range')
            expectEqual(chosen({}).type, 'pass', 'with hands only it stays at close range')
            const answered = (cardCost: number) =>
                chooseMove(
                    policyWeightsOf({
                        ...DEFAULT_PROFILE,
                        combat: { ...DEFAULT_PROFILE.combat, cardCost },
                    }),
                    simPassUntil(
                        simFight({ attached: [MAGNUM_KIT] }, { cards: [MANEUVER_CARD] }),
                        CombatStep.DetermineRange,
                    ),
                ).type
            expectEqual(
                answered(0),
                'pass',
                'the other would bring the range back for nothing: the weapon maneuver is kept',
            )
            expectEqual(
                answered(0.2),
                'maneuver',
                'it costs the other a card to bring it back: worth the try',
            )
        },
    },
    {
        name: 'Combat position: the other side answers a maneuver with its own when it is worth the card, and not when it has none',
        run() {
            const answer = (cards: SimCard[]) => {
                let sim = simPassUntil(
                    simFight({ attached: [MAGNUM_KIT] }, { cards }),
                    CombatStep.DetermineRange,
                )
                sim = simMove(sim, move => move.type == 'maneuver', 'the Magnum maneuver')
                return chooseMove(POLICY_WEIGHTS, sim)
            }
            const withCard = answer([MANEUVER_CARD])
            expectEqual(withCard.type, 'maneuver', 'it brings the range back')
            expectEqual(withCard.card, 0, 'with the card')
            expectEqual(answer([]).type, 'pass', 'nothing to answer with')
        },
    },
    {
        name: 'Combat position: a card is played when it pays for itself in the round: a dodge against a strong strike, not against a weak one',
        run() {
            const dodges = (strength: number, weights = POLICY_WEIGHTS) => {
                const sim = simPassUntil(
                    simFight({ strength }, { cards: [DODGE_CARD] }),
                    CombatStep.Strike,
                )
                const struck = simMove(sim, move => move.type == 'strike', 'the hand strike')
                const reply = chooseMove(weights, struck)
                return reply.type == 'strike' && reply.strike.dodge
            }
            expectEqual(dodges(3), true, '3 damage is worth the card')
            expectEqual(dodges(1), false, '1 damage for 1 damage is not')
            const dear = policyWeightsOf({
                ...DEFAULT_PROFILE,
                combat: { ...DEFAULT_PROFILE.combat, cardCost: 2 },
            })
            expectEqual(dodges(3, dear), false, 'a card that costs 2 is not worth 1.5')
            const steal = simPassUntil(simFight({}, { cards: [DODGE_CARD] }), CombatStep.Strike)
            const robbed = applyMove(steal, {
                type: 'strike',
                strike: newStrike('Steal', { stealBlood: 3 }),
            }).sim
            const reply = chooseMove(POLICY_WEIGHTS, robbed)
            expectEqual(
                reply.type == 'strike' && reply.strike.dodge,
                true,
                'a dodge keeps the blood from being stolen',
            )
        },
    },
    {
        name: 'Combat position: a strike at a retainer is chosen when it burns it for more than the hand strike takes from the minion, not when it only scratches it',
        run() {
            const reply = (life: number) => {
                const sim = simPassUntil(
                    simFight({ strength: 2 }, { attached: [retainerKit('Raven', life)] }),
                    CombatStep.Strike,
                )
                const move = chooseMove(POLICY_WEIGHTS, sim)
                return move.type == 'strike' && move.strike.retainer !== undefined
            }
            expectEqual(reply(1), true, 'a retainer with 1 life is burned')
            expectEqual(reply(5), false, 'one with 5 is not worth the strike')
        },
    },
    {
        name: 'Combat position: a press is played when the next round is favourable, an additional strike is played for the extra pair',
        run() {
            const pressed = (strength: number) => {
                const struck = simStrikes(
                    simFight({ strength, pressesGranted: 1 }, { strength: 3 - strength + 1 }),
                )
                return chooseMove(POLICY_WEIGHTS, simPassUntil(struck, CombatStep.Press)).type
            }
            expectEqual(pressed(3), 'press', 'the stronger presses')
            expectEqual(pressed(1), 'pass', 'the weaker lets the combat end')
            const extra = testCard('extra', {
                kind: 'combat',
                effects: [additionalStrikeEffect({ limited: false })],
            })
            const struck = simStrikes(simFight({ cards: [extra] }))
            const move = chooseMove(
                POLICY_WEIGHTS,
                simPassUntil(struck, CombatStep.AdditionalStrikes),
            )
            expectEqual(move.type, 'additionalStrike', 'a strike nobody can answer')
        },
    },
    {
        name: 'Combat position: a card that sets the strength is played before the range when the damage it adds is worth more than the card',
        run() {
            const signpost = testCard('signpost', {
                kind: 'combat',
                when: [beforeRangeCondition],
                effects: [setStrengthEffect(3)],
            })
            const move = chooseMove(POLICY_WEIGHTS, simFight({ cards: [signpost], strength: 1 }))
            expectEqual(move.type, 'strength', 'the strength is set')
            const idle = chooseMove(POLICY_WEIGHTS, simFight({ cards: [signpost], strength: 3 }))
            expectEqual(idle.type, 'pass', 'it is not raised above what it is')
        },
    },
    {
        name: 'Combat position: a card that makes the other take damage every round is played before the range, a card that does nothing is not',
        run() {
            const crows = testCard('crows', {
                kind: 'combat',
                when: [beforeRangeCondition, oncePerCombatCondition],
                effects: [environmentalEffect(1)],
            })
            expectEqual(
                chooseMove(POLICY_WEIGHTS, simFight({ cards: [crows] })).type,
                'environmentalDamage',
                'the crows are played',
            )
            const played = simMove(
                simFight({ cards: [crows] }),
                move => move.type == 'environmentalDamage',
                'the crows',
            )
            expectEqual(
                chooseMove(POLICY_WEIGHTS, played).type,
                'pass',
                'once per combat, the next move is a pass',
            )
        },
    },
    {
        name: 'Combat position: a card in play that prevents damage is used when damage is pending, the strikes are at the strength of the minion',
        run() {
            const sim = simStrikes(simFight({ strength: 3 }, { attached: [PREVENT_KIT] }))
            expectEqual(sim.step, CombatStep.DamageResolution, 'damage is pending')
            const end = playOut(POLICY_WEIGHTS, sim).sim
            expectEqual(end.defending.blood, 2, '3 damage, 1 prevented: 4 blood left 2')
            expectEqual(
                playOut(POLICY_WEIGHTS, simStrikes(simFight({ strength: 3 }))).sim.defending.blood,
                1,
                'without it 1',
            )
        },
    },
    {
        name: 'Combat position: a minion that is out of blood goes to torpor and pays its worth, the combat is judged the same every time',
        run() {
            const forecast = forecastFight(
                fighterWith({ blood: 1 }),
                fighterWith({ strength: 3 }),
                DEFAULT_PROFILE,
            )
            expectEqual(forecast.acting.torpor, 1, 'it goes to torpor')
            expectEqual(forecast.defending.torpor, 0, 'the other does not')
            const { bloodValue } = DEFAULT_PROFILE.plan
            expectClose(
                forecast.acting.loss,
                bloodValue + DEFAULT_PROFILE.combat.torporShare * 8,
                'the blood it had and half its worth',
                0.001,
            )
            expectEqual(
                netLoss(forecast, 'acting', DEFAULT_PROFILE) >
                    netLoss(forecast, 'defending', DEFAULT_PROFILE),
                true,
                'a loss for it, a gain for the other',
            )
        },
    },
    {
        name: 'Combat position: a retainer burned costs what the profile says, a vampire burned loses all its worth and not half',
        run() {
            const raven = retainerKit('Raven', 1)
            const withRetainer = (retainerValue: number) =>
                forecastFight(
                    fighterWith({ strength: 2 }),
                    fighterWith({ blood: 6, attachedKits: [raven] }),
                    {
                        ...DEFAULT_PROFILE,
                        combat: { ...DEFAULT_PROFILE.combat, retainerValue },
                    },
                )
            const cheap = withRetainer(1)
            expectEqual(cheap.defending.retainers, 1, 'the retainer is burned')
            expectClose(cheap.defending.loss, 1, 'at 1 pool', 0.001)
            expectClose(withRetainer(3).defending.loss, 3, 'at 3 pool', 0.001)

            const flamethrower: AttachedKit = {
                name: 'Flamethrower',
                retainer: false,
                life: 0,
                strikes: [{ damage: 3, ranged: false, aggravated: true, maneuver: false }],
                prevention: [],
                environmental: 0,
            }
            const burned = forecastFight(
                fighterWith({ attachedKits: [flamethrower] }),
                fighterWith({ blood: 1 }),
                DEFAULT_PROFILE,
            )
            expectEqual(burned.defending.burned, 1, 'burned by 3 aggravated damage')
            expectEqual(burned.defending.torpor, 0, 'not in torpor')
            expectClose(
                burned.defending.loss,
                DEFAULT_PROFILE.plan.bloodValue + 8,
                'its blood and all of its worth',
                0.001,
            )
        },
    },
    {
        name: 'Combat position: a hand is drawn from several times when it may hold cards the minion plays, and not otherwise',
        run() {
            const believed = (size: number, strike: number): Hand => ({
                size,
                densities: { strike },
            })
            const samples = (them: Fighter) =>
                forecastFight(fighterWith({ disciplines: FIGHT_POTENCE }), them, DEFAULT_PROFILE)
                    .samples
            expectEqual(
                samples(fighterWith({ disciplines: FIGHT_POTENCE }, believed(7, 0.3))),
                DEFAULT_PROFILE.combat.samples,
                'a Potence minion may hold strikes',
            )
            expectEqual(
                samples(fighterWith({}, believed(7, 0.3))),
                1,
                'a minion without a discipline plays none',
            )
            expectEqual(
                samples(fighterWith({ disciplines: FIGHT_POTENCE }, believed(0, 0.3))),
                1,
                'an empty hand holds none',
            )
            expectEqual(
                samples(fighterWith({ disciplines: FIGHT_POTENCE }, believed(7, 0))),
                1,
                'a library with none holds none',
            )
        },
    },
    {
        name: 'Combat position: the cards of a believed hand follow the shares of the roles, and only the roles the minion plays',
        run() {
            const draws = (disciplines: Partial<Disciplines>, densities: Densities) => {
                const counts: Record<string, number> = {}
                for (let seed = 0; seed < 400; seed++) {
                    const cards = believedCards(
                        fightProfile({ disciplines }),
                        { size: 7, densities },
                        DEFAULT_PROFILE.combat,
                        seededRandom(seed),
                    )
                    for (const card of cards) {
                        counts[card.cardId] = (counts[card.cardId] ?? 0) + 1
                    }
                }
                return (cardId: string) => (counts[cardId] ?? 0) / 400
            }
            const potence = { [Discipline.Potence]: DisciplineLevel.INFERIOR }
            const mean = draws(potence, { strike: 0.3, dodge: 0.2 })
            expectClose(mean('believed:strike'), 7 * 0.3, 'a hand of 7, 30% of strikes', 0.25)
            expectEqual(mean('believed:dodge'), 0, 'Potence plays no dodge')
            const both = draws(
                { ...potence, [Discipline.Presence]: DisciplineLevel.INFERIOR },
                { strike: 0.3, dodge: 0.2 },
            )
            expectClose(both('believed:dodge'), 7 * 0.2, 'with Presence, 20% of dodges', 0.25)
            expectClose(both('believed:strike'), 7 * 0.3, 'and as many strikes', 0.25)
        },
    },
    {
        name: 'Combat position: a strike card believed at a superior discipline hits harder than at an inferior one',
        run() {
            const damage = (level: DisciplineLevel) => {
                const [card] = believedCards(
                    fightProfile({ disciplines: { [Discipline.Potence]: level } }),
                    { size: 1, densities: { strike: 1 } },
                    DEFAULT_PROFILE.combat,
                    () => 0,
                )
                const play = card.plays[0].effects[0]
                return play.type == 'strike' && play.preset == 'hand' ? play.extraDamage : -1
            }
            expectEqual(
                damage(DisciplineLevel.INFERIOR),
                DEFAULT_PROFILE.combat.strikeBonus.inferior,
                'inferior',
            )
            expectEqual(
                damage(DisciplineLevel.SUPERIOR),
                DEFAULT_PROFILE.combat.strikeBonus.superior,
                'superior',
            )
        },
    },
    {
        name: 'Combat position: the more strike cards a hand is believed to hold, the more it costs me, and none is the empty hand',
        run() {
            const loss = (strike: number) =>
                forecastFight(
                    fighterWith({ disciplines: FIGHT_POTENCE }),
                    fighterWith({ disciplines: FIGHT_POTENCE }, { size: 7, densities: { strike } }),
                    DEFAULT_PROFILE,
                ).acting.loss
            const none = forecastFight(
                fighterWith({ disciplines: FIGHT_POTENCE }),
                fighterWith({ disciplines: FIGHT_POTENCE }),
                DEFAULT_PROFILE,
            ).acting.loss
            expectEqual(loss(0), none, 'no card believed: the empty hand')
            expectEqual(loss(0.2) > loss(0), true, 'a few strikes cost something')
            expectEqual(loss(0.6) > loss(0.2), true, 'more cost more')
        },
    },
    {
        name: 'Combat position: the hand I hold is read exactly, a Roundhouse makes a fight with a minion of the same strength cheaper',
        run() {
            const risk = (hand: string[]) => {
                const ring = createRing([BrujahDeck, BrujahDeck])
                const [me, other] = ring.players
                addMinions(ring, me, [{ blood: 6, disciplines: FIGHT_POTENCE }])
                addMinions(ring, other, [{ strength: 1, blood: 6 }])
                holdOnly(ring, me, hand)
                return assessAs(ring, me).threat[other.oid].combat
            }
            const without = risk([])
            expectEqual(without > 0, true, 'an even fight costs something')
            expectEqual(risk([ROUNDHOUSE_ID]) < without, true, 'with the card it costs less')
        },
    },
    {
        name: 'Combat position: a weapon of the blocker that my hand strikes cannot reach is a danger that the same minion without it is not',
        run() {
            const risk = (armed: boolean) => {
                const ring = createRing([AttachDeck, AttachDeck])
                const [me, other] = ring.players
                addMinions(ring, me, [{ blood: 6 }])
                const [blocker] = addMinions(ring, other, [{ strength: 1, blood: 6 }])
                if (armed) {
                    attachInPlay(findAnyCard(other, MAGNUM_ID), blocker)
                }
                holdOnly(ring, me, [])
                return assessAs(ring, me).threat[other.oid].combat
            }
            expectEqual(risk(true) > risk(false), true, 'the Magnum is a danger')
        },
    },
    {
        name: 'Combat position: the combat axis of the threat is the average of the fights my minions lose, times the share of my actions that get blocked',
        run() {
            const ring = createRing([MalkavDeck, MalkavDeck])
            const [me, other] = ring.players
            addMinions(ring, me, [{ blood: 3 }, { blood: 8, strength: 8 }])
            addMinions(ring, other, [{ strength: 3, blood: 7 }])
            holdOnly(ring, me, [])
            const assessment = assessAs(ring, me)
            const risks = assessment.table.me.minions.map(minion => combatRisk(assessment, minion))
            expectEqual(
                risks.some(risk => risk > 0) && risks.some(risk => risk == 0),
                true,
                'one fight is lost, one is won',
            )
            expectClose(
                assessment.threat[other.oid].combat,
                (assessment.opportunity[other.oid].blockedShare * (risks[0] + risks[1])) / 2,
                'the average, not the sum',
                0.001,
            )
        },
    },
    {
        name: 'Combat position: the fight a block of my prey runs my minion into is the worst of its unlocked blockers, none when it has none, more with an armed one',
        run() {
            const risk = (blockers: { armed?: boolean; locked?: boolean }[]) => {
                const ring = createRing([AttachDeck, AttachDeck])
                const [me, other] = ring.players
                addMinions(ring, me, [{ blood: 6 }])
                const theirs = addMinions(
                    ring,
                    other,
                    blockers.map(({ locked }) => ({ strength: 1, blood: 6, locked })),
                )
                blockers.forEach(({ armed }, index) => {
                    if (armed) {
                        attachInPlay(findAnyCard(other, MAGNUM_ID), theirs[index])
                    }
                })
                holdOnly(ring, me, [])
                const assessment = assessAs(ring, me)
                return combatRisk(assessment, assessment.table.me.minions[0])
            }
            const unarmed = risk([{}])
            expectEqual(unarmed > 0, true, 'an even fight is a cost')
            expectEqual(risk([{ armed: true }]) > unarmed, true, 'the Magnum makes it dearer')
            expectEqual(
                risk([{}, { armed: true }]),
                risk([{ armed: true }]),
                'the worst of the two blockers counts',
            )
            expectEqual(risk([{ armed: true, locked: true }]), 0, 'a locked blocker does not block')
        },
    },
]
