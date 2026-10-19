import { CombatStep, CombatRange } from '@/shared/types/state.ts'
import { Discipline, DisciplineLevel } from '@/shared/const/model.ts'
import { Disciplines } from '@/shared/types/resources.ts'
import { traitsMeetRequirements } from '@/shared/state/cardRequirements.ts'
import { AttachedKit } from '@/shared/bot/utility/minionProfile.ts'
import {
    Side,
    SimCombatant,
    newCombatSim,
    CombatSim,
    applyMove,
    SimStrike,
    Move,
    legalMoves,
    outcomeOf,
    SimCard,
} from '@/shared/bot/utility/combatModel.ts'
import { CardFacts, combatCards } from '@/shared/bot/utility/combatSetup.ts'
import { combatConditionHolds } from '@/shared/cardImpl/catalog/combatPlay.ts'
import { newCombatantFields, newStrike } from '@/shared/state/combatRules.ts'
import { Scenario, ScenarioFailure, expectEqual } from './helpers.ts'

/**
 * The combat model ( src/shared/bot/utility/combatModel.ts ): the rules are the engine's, so what is checked here is
 * what the model adds ( the moves of a side, the cards, a copy that does not touch the original ) and the rules
 * from the model's side, on the rulebook's examples. script/botCombat.ts compares it with the engine on random combats.
 */

function simCombatant(side: Side, over: Partial<SimCombatant> = {}): SimCombatant {
    const blood = over.blood ?? 4
    return {
        ...newCombatantFields(1),
        side,
        name: side == 'acting' ? 'Alice' : 'Bob',
        isVampire: true,
        state: 'ready',
        blood,
        startBlood: blood,
        capacity: 10,
        worth: 10,
        pool: 10,
        attached: [],
        cards: [],
        spent: 0,
        allies: [],
        allyLost: 0,
        ...over,
    }
}

export const simFight = (
    acting: Partial<SimCombatant> = {},
    defending: Partial<SimCombatant> = {},
) => newCombatSim(simCombatant('acting', acting), simCombatant('defending', defending))

export function simPassUntil(sim: CombatSim, step: CombatStep | null): CombatSim {
    let current = sim
    for (let i = 0; i < 60; i++) {
        if (step === null ? current.closed : current.step == step) {
            return current
        }
        if (current.closed) {
            throw new ScenarioFailure(`The combat ended before the ${step} step`)
        }
        current = applyMove(current, { type: 'pass' }).sim
    }
    throw new ScenarioFailure(`The ${step} step was not reached`)
}

// The strike step, acting minion first: a hand strike for the side that gives none
export function simStrikes(sim: CombatSim, acting?: SimStrike, defending?: SimStrike): CombatSim {
    let current = simPassUntil(sim, CombatStep.Strike)
    while (current.step == CombatStep.Strike && !current.closed) {
        const side = current.impulsePlayer
        const given = side == 'acting' ? acting : defending
        const strike =
            given ?? newStrike('Hand strike', { damage: current[side].strength, isHand: true })
        current = applyMove(current, { type: 'strike', strike }).sim
    }
    return current
}

export function simMove(sim: CombatSim, test: (move: Move) => boolean, what: string): CombatSim {
    const move = legalMoves(sim).find(test)
    if (!move) {
        throw new ScenarioFailure(`${what} is not offered`)
    }
    return applyMove(sim, move).sim
}

export const MAGNUM_KIT: AttachedKit = {
    name: '.44 Magnum',
    retainer: false,
    equipment: true,
    burned: false,
    life: 0,
    strikes: [{ damage: 2, ranged: true, aggravated: false, maneuver: true }],
    burnsEquipment: false,
    prevention: [],
    environmental: 0,
    dodge: false,
}

export const retainerKit = (name: string, life: number, environmental = 0): AttachedKit => ({
    name,
    retainer: true,
    equipment: false,
    burned: false,
    life,
    strikes: [],
    burnsEquipment: false,
    prevention: [],
    environmental,
    dodge: false,
})

// A card put on the minion ( Heroic Might ) that gives it a strike that burns an equipment of the other
export const BURN_KIT: AttachedKit = {
    name: 'Heroic Might',
    retainer: false,
    equipment: false,
    burned: false,
    life: 0,
    strikes: [],
    burnsEquipment: true,
    prevention: [],
    environmental: 0,
    dodge: false,
}

export const CARD_USER = {
    disciplines: {} as Partial<Disciplines>,
    isVampire: true,
    forbiddenPlays: [] as string[],
    clan: 'Brujah',
    sect: 'Camarilla',
    title: '',
    capacity: 10,
}

export const factsOfCard = (
    krcgId: string,
    name: string,
    costs: { bloodCost?: number; poolCost?: number } = {},
): CardFacts => ({ krcgId, name, type: 'Combat', bloodCost: 0, poolCost: 0, ...costs })

type StrikeMove = Extract<Move, { type: 'strike' }>

const strikeMoves = (sim: CombatSim) =>
    legalMoves(sim).filter((move): move is StrikeMove => move.type == 'strike')

// The strike of the first move at the strike step that the name matches
const strikeNamed = (sim: CombatSim, name: string): SimStrike | undefined =>
    strikeMoves(simPassUntil(sim, CombatStep.Strike)).find(move => move.strike.name == name)?.strike

export const COMBAT_MODEL_SCENARIOS: Scenario[] = [
    {
        name: 'Combat model: a round of hand strikes, 1 damage each, mended, no press so the combat ends',
        run() {
            const sim = simPassUntil(simStrikes(simFight({ blood: 3 }, { blood: 3 })), null)
            expectEqual(sim.acting.blood, 2, 'acting blood')
            expectEqual(sim.defending.blood, 2, 'defending blood')
            expectEqual(outcomeOf(sim).over, true, 'the combat is over')
            expectEqual(sim.acting.state, 'ready', 'acting state')
        },
    },
    {
        name: 'Combat model: the first window offers a pass, the strike step cannot be passed and offers the hand strike first',
        run() {
            const sim = simFight()
            expectEqual(
                legalMoves(sim)
                    .map(move => move.type)
                    .join(),
                'pass',
                'moves of the first window',
            )
            const moves = legalMoves(simPassUntil(sim, CombatStep.Strike))
            expectEqual(moves.map(move => move.type).join(), 'strike', 'moves of the strike step')
            expectEqual(
                moves[0].type == 'strike' && moves[0].strike.name,
                'Hand strike',
                'the hand strike',
            )
        },
    },
    {
        name: 'Combat model: a strike with first strike resolves before the others, so a minion sent to torpor does not strike',
        run() {
            const firstStrike = newStrike('Quick', { damage: 3, firstStrike: true })
            const sim = simPassUntil(
                simStrikes(simFight({ blood: 1 }, { blood: 3 }), undefined, firstStrike),
                null,
            )
            expectEqual(sim.acting.state, 'torpor', 'acting goes to torpor')
            expectEqual(sim.acting.blood, 0, 'acting blood')
            expectEqual(sim.defending.blood, 3, 'the hand strike of the acting minion was lost')
        },
    },
    {
        name: 'Combat model: a dodge stops the opposing strike, combat ends stops the combat before any damage',
        run() {
            const dodged = simPassUntil(
                simStrikes(simFight(), undefined, newStrike('Dodge', { dodge: true })),
                null,
            )
            expectEqual(dodged.defending.blood, 4, 'the dodging minion is not hurt')
            expectEqual(dodged.acting.blood, 4, 'a dodge does no damage')
            const ended = simStrikes(
                simFight(),
                newStrike('Dodge', { dodge: true }),
                newStrike('Combat ends', { combatEnds: true }),
            )
            expectEqual(ended.acting.blood + ended.defending.blood, 8, 'combat ends is not dodged')
            expectEqual(ended.isOver, true, 'the combat is over')
        },
    },
    {
        name: 'Combat model: stolen blood moves before the damage is mended, and what is above the capacity drains off',
        run() {
            const steal = newStrike('Steal', { stealBlood: 2 })
            const sim = simPassUntil(
                simStrikes(simFight({ blood: 4, capacity: 5 }, { blood: 3 }), steal),
                null,
            )
            expectEqual(sim.defending.blood, 1, 'defending lost 2 counters')
            expectEqual(sim.acting.blood, 4, '5 after the steal ( the capacity ), 1 mended')
        },
    },
    {
        name: 'Combat model: aggravated damage is not mended, a wounded vampire burns blood for each further point or is burned',
        run() {
            const claws = newStrike('Claws', { damage: 3, aggravated: true })
            const torpor = simPassUntil(simStrikes(simFight({}, { blood: 2 }), claws), null)
            expectEqual(torpor.defending.state, 'torpor', '2 blood, 3 aggravated: torpor')
            expectEqual(torpor.defending.blood, 0, 'with no blood left')
            const burned = simPassUntil(simStrikes(simFight({}, { blood: 1 }), claws), null)
            expectEqual(burned.defending.state, 'burned', '1 blood, 3 aggravated: burned')
        },
    },
    {
        name: 'Combat model: an ally burns its life counters and is burned when none is left, it does not go to torpor',
        run() {
            const sim = simPassUntil(
                simStrikes(simFight({ strength: 3 }, { isVampire: false, blood: 2 })),
                null,
            )
            expectEqual(sim.defending.state, 'burned', 'the ally is burned')
            expectEqual(sim.defending.blood, 0, 'with no life left')
        },
    },
    {
        name: 'Combat model: a hand strike has no effect at long range, a ranged strike does, a weapon maneuver gives both the strike and the range',
        run() {
            let sim = simPassUntil(simFight({ attached: [MAGNUM_KIT] }), CombatStep.DetermineRange)
            sim = simMove(
                sim,
                move => move.type == 'maneuver' && move.weaponKey !== undefined,
                'the weapon maneuver',
            )
            expectEqual(sim.range, CombatRange.Long, 'long range')
            sim = simPassUntil(simStrikes(sim), null)
            expectEqual(sim.defending.blood, 2, 'the Magnum hits at long range')
            expectEqual(sim.acting.blood, 4, 'the hand strike does not')
        },
    },
    {
        name: 'Combat model: a weapon gives its maneuver once per combat, the weapon of the other side has its own',
        run() {
            let sim = simPassUntil(
                simFight({ attached: [MAGNUM_KIT] }, { attached: [MAGNUM_KIT] }),
                CombatStep.DetermineRange,
            )
            sim = simMove(sim, move => move.type == 'maneuver' && !!move.weaponKey, 'acting')
            expectEqual(
                legalMoves(sim).some(
                    move => move.type == 'maneuver' && move.weaponKey?.startsWith('defending'),
                ),
                true,
                'the other Magnum maneuvers back',
            )
            sim = simMove(sim, move => move.type == 'maneuver' && !!move.weaponKey, 'defending')
            expectEqual(sim.range, CombatRange.Close, 'back at close range')
            expectEqual(
                legalMoves(sim).some(move => move.type == 'maneuver'),
                false,
                'both weapons gave their maneuver, and nobody plays two in a row',
            )
        },
    },
    {
        name: 'Combat model: a strike at a retainer burns its life counters, the first retainer is a target like the others, what a burned retainer inflicted ends with it',
        run() {
            const kits = [retainerKit('Raven Spy', 2), retainerKit('Murder of Crows', 1, 1)]
            const base = simFight({ attached: [MAGNUM_KIT] }, { attached: kits })
            const names = strikeMoves(simPassUntil(base, CombatStep.Strike)).map(
                move => move.strike.name,
            )
            expectEqual(
                names.filter(name => name.includes(' at ')).length,
                4,
                'the Magnum and the hand at each of the two retainers',
            )
            const first = simPassUntil(
                simStrikes(base, strikeNamed(base, '.44 Magnum at Raven Spy')),
                null,
            )
            expectEqual(first.defending.attached[0].life, 0, 'the first retainer lost its counters')
            expectEqual(first.defending.attached[1].life, 1, 'the other is not touched')
            expectEqual(
                first.acting.blood,
                2,
                'the hand strike and the environmental damage of the other',
            )
            const second = simPassUntil(
                simStrikes(base, strikeNamed(base, '.44 Magnum at Murder of Crows')),
                null,
            )
            expectEqual(second.defending.attached[1].life, 0, 'the retainer is burned')
            expectEqual(second.acting.blood, 3, 'only the hand strike: it inflicts no more')
        },
    },
    {
        name: 'Combat model: a strike that burns an equipment is aimed at an equipment of the opposing minion only, and a burned weapon gives no strike',
        run() {
            const base = simFight(
                { attached: [BURN_KIT, MAGNUM_KIT] },
                { attached: [MAGNUM_KIT, retainerKit('Raven Spy', 2), BURN_KIT] },
            )
            const burns = strikeMoves(simPassUntil(base, CombatStep.Strike)).filter(
                move => move.strike.equipment !== undefined,
            )
            expectEqual(burns.length, 1, 'strikes that burn an equipment')
            expectEqual(burns[0].strike.equipment, 0, 'the Magnum of the opposing minion')
            expectEqual(burns[0].strike.name, 'Heroic Might burns .44 Magnum', 'its name')
            expectEqual(burns[0].strike.damage, 0, 'it hurts nobody')

            const after = simPassUntil(simStrikes(base, burns[0].strike), null)
            expectEqual(after.defending.attached[0].burned, true, 'the Magnum is burned')
            expectEqual(after.acting.attached[1].burned, false, 'the own Magnum is not touched')
            expectEqual(after.defending.blood, 4, 'the burn hurts nobody')
            expectEqual(base.defending.attached[0].burned, false, 'the combat it comes from')

            const gone = simFight({}, { attached: [{ ...MAGNUM_KIT, burned: true }] })
            expectEqual(
                strikeMoves(simPassUntil(gone, CombatStep.Strike))
                    .map(move => move.strike.name)
                    .join(),
                'Hand strike',
                'a burned weapon gives no strike',
            )
            const bare = simFight(
                { attached: [BURN_KIT] },
                { attached: [{ ...MAGNUM_KIT, burned: true }] },
            )
            expectEqual(
                strikeMoves(simPassUntil(bare, CombatStep.Strike)).some(
                    move => move.strike.equipment !== undefined,
                ),
                false,
                'a burned equipment is no target',
            )
        },
    },
    {
        name: 'Combat model: a copy is made to be changed, the combat it comes from is not',
        run() {
            const base = simFight({}, { attached: [retainerKit('Raven Spy', 2)] })
            const before = JSON.stringify(base)
            simPassUntil(simStrikes(base, strikeNamed(base, 'Hand strike at Raven Spy')), null)
            expectEqual(JSON.stringify(base), before, 'the first combat')
        },
    },
    {
        name: 'Combat model: a card is offered for each way the minion can play it, with the discipline it needs',
        run() {
            const roundhouse = factsOfCard('102215', 'Roundhouse')
            expectEqual(combatCards(CARD_USER, [roundhouse]).length, 0, 'no Potence, no card')
            const inferior = combatCards(
                { ...CARD_USER, disciplines: { [Discipline.Potence]: DisciplineLevel.INFERIOR } },
                [roundhouse],
            )
            expectEqual(inferior[0].plays.length, 1, 'inferior: one play')
            const superior = combatCards(
                { ...CARD_USER, disciplines: { [Discipline.Potence]: DisciplineLevel.SUPERIOR } },
                [roundhouse],
            )
            expectEqual(superior[0].plays.length, 2, 'superior: the inferior play too')
            const sim = simPassUntil(simFight({ cards: superior }), CombatStep.Strike)
            const damages = strikeMoves(sim)
                .filter(move => move.card !== undefined)
                .map(move => move.strike.damage)
                .toSorted()
            expectEqual(damages.join(), '3,4', 'the damage is the strength plus 2, or plus 3')
        },
    },
    {
        name: 'Combat model: a card costs blood and needs more pool than it costs, the card leaves the hand when it is played',
        run() {
            const potence = { [Discipline.Potence]: DisciplineLevel.INFERIOR }
            const card = (costs: { bloodCost?: number; poolCost?: number }) =>
                combatCards({ ...CARD_USER, disciplines: potence }, [
                    factsOfCard('102215', 'Roundhouse', costs),
                ])
            const offered = (cards: SimCard[], blood: number, pool: number) =>
                strikeMoves(simPassUntil(simFight({ cards, blood, pool }), CombatStep.Strike)).some(
                    move => move.card !== undefined,
                )
            expectEqual(offered(card({ bloodCost: 2 }), 1, 10), false, '2 blood cost, 1 blood')
            expectEqual(offered(card({ bloodCost: 2 }), 2, 10), true, '2 blood cost, 2 blood')
            expectEqual(offered(card({ poolCost: 3 }), 4, 3), false, '3 pool cost, 3 pool')
            expectEqual(offered(card({ poolCost: 3 }), 4, 4), true, '3 pool cost, 4 pool')
            const played = simMove(
                simPassUntil(
                    simFight({ cards: card({ bloodCost: 1, poolCost: 2 }) }),
                    CombatStep.Strike,
                ),
                move => move.type == 'strike' && move.card !== undefined,
                'the card',
            )
            expectEqual(played.acting.blood, 3, 'the minion paid 1 blood')
            expectEqual(played.acting.pool, 8, 'the Methuselah paid 2 pool')
            expectEqual(played.acting.cards.length, 0, 'the card left the hand')
            expectEqual(played.acting.spent, 1, 'a card was played')
        },
    },
    {
        name: 'Combat model: a card that is played once per combat is not offered again, even from another copy',
        run() {
            const animalism = { [Discipline.Animalism]: DisciplineLevel.INFERIOR }
            const crows = combatCards({ ...CARD_USER, disciplines: animalism }, [
                factsOfCard('100301', 'Carrion Crows'),
                factsOfCard('100301', 'Carrion Crows'),
            ])
            expectEqual(crows.length, 2, 'two copies')
            let sim = simFight({ cards: crows })
            const offered = (current: CombatSim) =>
                legalMoves(current).filter(move => move.type == 'environmentalDamage').length
            expectEqual(offered(sim), 2, 'both copies are offered before the range')
            sim = simMove(sim, move => move.type == 'environmentalDamage', 'the crows')
            expectEqual(offered(sim), 0, 'the second copy is not played in the same combat')
            expectEqual(sim.playedThisCombat['acting']?.join(), '100301', 'remembered')
        },
    },
    {
        name: 'Combat model: after a grapple only hand strikes are chosen, and Taste of Vitae gives back the blood the opponent lost',
        run() {
            const potence = { [Discipline.Potence]: DisciplineLevel.INFERIOR }
            const grapple = combatCards({ ...CARD_USER, disciplines: potence }, [
                factsOfCard('100959', 'Immortal Grapple'),
            ])
            let sim = simPassUntil(
                simFight({ attached: [MAGNUM_KIT], cards: grapple }),
                CombatStep.BeforeStrikes,
            )
            sim = simMove(sim, move => move.type == 'grapple', 'the grapple')
            sim = simPassUntil(sim, CombatStep.Strike)
            expectEqual(
                strikeMoves(sim).every(move => move.strike.isHand),
                true,
                'only hand strikes',
            )
            const taste = combatCards(CARD_USER, [factsOfCard('101945', 'Taste of Vitae')])
            let fight = simFight({ cards: taste, strength: 2, blood: 3 })
            const dodged = simPassUntil(
                simStrikes(fight, undefined, newStrike('Dodge', { dodge: true })),
                CombatStep.EndOfRound,
            )
            expectEqual(
                legalMoves(dodged).some(move => move.type == 'gainBlood'),
                false,
                'nothing was lost to a dodge',
            )
            fight = simPassUntil(simStrikes(fight), CombatStep.EndOfRound)
            expectEqual(fight.defending.bloodLost, 2, 'the opponent lost 2')
            fight = simMove(
                fight,
                move => move.type == 'gainBlood' && move.amount == 2,
                'the blood',
            )
            expectEqual(fight.acting.blood, 4, '3, 1 lost, 2 regained')
        },
    },
    {
        name: 'Combat model: the vampire requirement of a card is read from the traits of the vampire, an ally has none',
        run() {
            const card = { clan: 'Brujah/Gangrel', requirement: 'Anarch' }
            const traits = { clan: 'Brujah', sect: 'Anarch', title: '', capacity: 6 }
            expectEqual(traitsMeetRequirements(traits, card), true, 'an Anarch Brujah')
            expectEqual(
                traitsMeetRequirements({ ...traits, sect: 'Camarilla' }, card),
                false,
                'a Camarilla Brujah',
            )
            expectEqual(
                traitsMeetRequirements({ ...traits, clan: 'Ventrue' }, card),
                false,
                'an Anarch Ventrue',
            )
            const dustUp = { ...factsOfCard('100597', 'Dust Up'), requirement: 'Anarch' }
            const user = {
                ...CARD_USER,
                disciplines: { [Discipline.Potence]: DisciplineLevel.INFERIOR },
            }
            expectEqual(combatCards({ ...user, isVampire: false }, [dustUp]).length, 0, 'an ally')
            expectEqual(combatCards({ ...user, sect: 'Anarch' }, [dustUp]).length, 1, 'an Anarch')
            expectEqual(combatCards(user, [dustUp]).length, 0, 'a Camarilla vampire')
            expectEqual(
                combatCards({ ...user, sect: 'Anarch', forbiddenPlays: ['Dust Up'] }, [dustUp])
                    .length,
                0,
                'forbidden by an attached card',
            )
        },
    },
    {
        name: 'Combat model: a card played once per combat stays played in the next round, what a round saw is forgotten, a burned retainer is neither a target nor a threat',
        run() {
            const animalism = { [Discipline.Animalism]: DisciplineLevel.INFERIOR }
            const crows = combatCards({ ...CARD_USER, disciplines: animalism }, [
                factsOfCard('100301', 'Carrion Crows'),
                factsOfCard('100301', 'Carrion Crows'),
            ])
            let sim = simFight(
                { cards: crows, attached: [MAGNUM_KIT], pressesGranted: 1, blood: 8 },
                { attached: [retainerKit('Murder of Crows', 1, 1)], blood: 8 },
            )
            sim = simMove(sim, move => move.type == 'environmentalDamage', 'the first crows')
            sim = simPassUntil(
                simStrikes(sim, strikeNamed(sim, '.44 Magnum at Murder of Crows')),
                CombatStep.Press,
            )
            sim = simMove(sim, move => move.type == 'press' && !!move.granted, 'the press')
            sim = simPassUntil(
                simMove(sim, move => move.type == 'pass', 'the other side lets it go'),
                CombatStep.BeforeRange,
            )
            expectEqual(sim.round, 2, 'a second round')
            expectEqual(sim.playedThisRound['acting']?.length ?? 0, 0, 'the round was forgotten')
            expectEqual(sim.playedThisCombat['acting']?.join(), '100301', 'the combat was not')
            expectEqual(
                legalMoves(sim).some(move => move.type == 'environmentalDamage'),
                false,
                'the second copy cannot be played',
            )
            const names = strikeMoves(simPassUntil(sim, CombatStep.Strike)).map(
                move => move.strike.name,
            )
            expectEqual(
                names.some(name => name.includes('Murder of Crows')),
                false,
                'no target',
            )
            const blood = sim.acting.blood
            sim = simPassUntil(simStrikes(sim), null)
            expectEqual(
                sim.acting.blood,
                blood - 1,
                'the hand strike, and no more from the retainer',
            )
        },
    },
    {
        name: 'Combat model: a card with a variable cost is not offered, a strength lower than the minion has is not either, a maneuver that only goes to close range waits for long range',
        run() {
            const potence = { [Discipline.Potence]: DisciplineLevel.SUPERIOR }
            const user = { ...CARD_USER, disciplines: potence }
            expectEqual(
                combatCards(user, [factsOfCard('102215', 'Roundhouse')]).length,
                1,
                'a cost that is a number',
            )
            expectEqual(
                combatCards(user, [{ ...factsOfCard('102215', 'Roundhouse'), bloodCost: 'X' }])
                    .length,
                0,
                'a cost of X',
            )
            const signpost = combatCards(user, [factsOfCard('101993', 'Torn Signpost')])
            const strengthMoves = (strength: number) =>
                legalMoves(simFight({ cards: signpost, strength })).filter(
                    move => move.type == 'strength',
                ).length
            expectEqual(strengthMoves(1), 2, 'strength 2 and 3 for a minion of strength 1')
            expectEqual(strengthMoves(3), 0, 'nothing above 3')
            const slam = combatCards(user, [factsOfCard('101798', 'Slam')])
            const maneuvers = (sim: CombatSim) =>
                legalMoves(sim).filter(move => move.type == 'maneuver' && move.card !== undefined)
                    .length
            let sim = simPassUntil(
                simFight({ cards: slam }, { attached: [MAGNUM_KIT] }),
                CombatStep.DetermineRange,
            )
            expectEqual(maneuvers(sim), 0, 'at close range')
            sim = simMove(sim, move => move.type == 'pass', 'acting lets the range be')
            sim = simMove(sim, move => move.type == 'maneuver', 'the Magnum of the other')
            expectEqual(sim.range, CombatRange.Long, 'long range')
            expectEqual(maneuvers(sim), 1, 'at long range')
        },
    },
    {
        name: 'Combat model: with no combat the conditions of a combat play say no, except that nothing was played',
        run() {
            const round = { type: 'combatRound', round: 1 } as const
            expectEqual(combatConditionHolds(round, 'x', null), false, 'round')
            expectEqual(combatConditionHolds({ type: 'closeRange' }, 'x', null), false, 'close')
            expectEqual(combatConditionHolds({ type: 'oncePerRound' }, 'x', null), true, 'once')
            expectEqual(
                combatConditionHolds({ type: 'opposingIsVampire' }, 'x', null),
                false,
                'a vampire',
            )
        },
    },
]
