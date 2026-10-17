import { DisciplineLevel, Discipline } from '@/shared/const/model.ts'
import { Disciplines } from '@/shared/types/resources.ts'
import {
    Effect,
    describeEffect,
    summarizeCardId,
    waysUsableBy,
} from '@/shared/bot/utility/summaries.ts'
import { CARD_DEFS } from '@/shared/cardImpl/catalog/index.ts'
import { Scenario, ScenarioFailure, expectEqual, summaryOf } from './helpers.ts'
import {
    ALINE_ID,
    BARRENS_ID,
    CONDITIONING_ID,
    DEFLECTION_ID,
    FACELESS_NIGHT_ID,
    GOVERN_ID,
    GUARD_DOGS_ID,
    LABYRINTH_ID,
    LIFE_IN_THE_CITY_ID,
    LOST_IN_CROWDS_ID,
    MAGNUM_ID,
    MINION_TAP_ID,
    MONKEY_WRENCH_ID,
    ORGANIZED_RESISTANCE_ID,
    PRETERNATURAL_ID,
    QUI_VIVE_ID,
    RAVEN_SPY_ID,
    THEO_BELL_ID,
    VILLEIN_ID,
    WARRENS_ID,
    WIDER_VIEW_ID,
} from '../cardIds.ts'

function findEffect<T extends Effect['type']>(
    effects: Effect[],
    type: T,
): Extract<Effect, { type: T }> {
    const found = effects.find(
        (effect): effect is Extract<Effect, { type: T }> => effect.type == type,
    )
    if (!found) {
        throw new ScenarioFailure(`No ${type} effect in ${effects.map(describeEffect).join('; ')}`)
    }
    return found
}

export const SUMMARY_SCENARIOS: Scenario[] = [
    {
        name: 'Summary: a bleed action is a bleed, and the stealth of an action is its own, not a stealth card',
        run() {
            const [bleed, accelerate] = summaryOf(GOVERN_ID).plays
            expectEqual(bleed.window, 'minionAction', 'window')
            expectEqual(findEffect(bleed.effects, 'bleedAction').amount, 2, 'bleed')
            expectEqual(bleed.roles.join(), 'bleed', 'roles of the bleed')
            expectEqual(bleed.ways.length, 1, 'one way')
            expectEqual(bleed.ways[0][0].level, DisciplineLevel.INFERIOR, 'inferior')

            expectEqual(
                findEffect(accelerate.effects, 'stealth').amount,
                1,
                'stealth of the action',
            )
            expectEqual(findEffect(accelerate.effects, 'gainBlood').amount, 3, 'blood')
            expectEqual(accelerate.target, 'youngerUncontrolledVampire', 'target')
            expectEqual(
                accelerate.roles.join(),
                'accelerate',
                'an acceleration, not a stealth card',
            )
        },
    },
    {
        name: 'Summary: a modifier is a stealth source or a bleed bonus, in the window it is played',
        run() {
            const crowds = summaryOf(LOST_IN_CROWDS_ID).plays
            expectEqual(
                crowds.map(play => findEffect(play.effects, 'stealth').amount).join(),
                '1,2',
                'stealth',
            )
            expectEqual(crowds[0].window, 'ownAction', 'window')
            expectEqual(crowds[0].roles.join(), 'stealth', 'roles')

            const conditioning = summaryOf(CONDITIONING_ID).plays[0]
            const bonus = findEffect(conditioning.effects, 'bleedBonus')
            expectEqual(bonus.amount, 2, 'bonus')
            expectEqual(bonus.limited, true, 'limited')
            expectEqual(conditioning.window, 'ownBleed', 'only during a bleed')
            expectEqual(conditioning.roles.join(), 'bleedBonus', 'roles')

            const wrench = summaryOf(MONKEY_WRENCH_ID).plays[0]
            expectEqual(findEffect(wrench.effects, 'bleedBonus').amount, 'X', 'variable bonus')
            expectEqual(JSON.stringify(wrench.x), JSON.stringify({ min: 1, max: 3 }), 'X range')
        },
    },
    {
        name: 'Summary: a bounce is played once the blocks are declined, a wake before the block',
        run() {
            const [inferior, superior] = summaryOf(DEFLECTION_ID).plays
            expectEqual(inferior.window, 'afterBlocksDeclined', 'window')
            expectEqual(findEffect(inferior.effects, 'bounce').lockReactor, true, 'inferior locks')
            expectEqual(
                findEffect(superior.effects, 'bounce').lockReactor,
                false,
                'superior does not',
            )
            expectEqual(inferior.roles.join(), 'bounce', 'roles')

            const quiVive = summaryOf(QUI_VIVE_ID).plays[0]
            expectEqual(quiVive.window, 'beforeBlock', 'wake window')
            expectEqual(quiVive.roles.join(), 'wake', 'wake role')
            expectEqual(quiVive.ways[0].length, 0, 'no discipline')
        },
    },
    {
        name: 'Summary: an intercept needs a block attempt to stand, unless the play starts the attempt',
        run() {
            const warrens = summaryOf(WARRENS_ID).plays[0]
            expectEqual(warrens.window, 'blockAttemptStands', 'Warrens')
            expectEqual(warrens.roles.join(), 'intercept', 'Warrens roles')
            const conditional = warrens.effects.filter(effect => effect.when)
            expectEqual(conditional.length, 2, 'the two amounts depend on the title of the reactor')

            const resistance = summaryOf(ORGANIZED_RESISTANCE_ID).plays[0]
            expectEqual(resistance.window, 'beforeBlock', 'Organized Resistance starts the attempt')
            expectEqual(resistance.roles.join(), 'wake,intercept', 'wake and intercept')
            expectEqual(findEffect(resistance.effects, 'unlockAndBlock').intercept, 1, 'intercept')
        },
    },
    {
        name: 'Summary: a play with several effects has every role, a trigger gives its own',
        run() {
            const faceless = summaryOf(FACELESS_NIGHT_ID).plays[1]
            expectEqual(faceless.roles.join(), 'stealth,punishBlock', 'Faceless Night superior')
            const trigger = findEffect(faceless.effects, 'trigger')
            expectEqual(trigger.armed, true, 'armed for the action')
            expectEqual(trigger.effects[0].type, 'lockFailedBlocker', 'locks the failed blocker')

            const dogs = summaryOf(GUARD_DOGS_ID).plays
            expectEqual(dogs[0].roles.join(), 'wake', 'Guard Dogs inferior')
            expectEqual(dogs[1].roles.join(), 'wake,maneuver', 'Guard Dogs superior')
        },
    },
    {
        name: 'Summary: equipment and retainers say what they do attached',
        run() {
            const magnum = summaryOf(MAGNUM_ID).plays[0]
            expectEqual(magnum.staysInPlay, 'onMinion', 'stays on a minion')
            expectEqual(magnum.attachTo, 'this', 'on the acting minion')
            const strike = findEffect(magnum.attached, 'weaponStrike')
            expectEqual(strike.damage, 2, 'damage')
            expectEqual(strike.ranged, true, 'ranged')
            expectEqual(magnum.roles.join(), 'strike,maneuver,attachment', 'roles')

            const raven = summaryOf(RAVEN_SPY_ID).plays
            expectEqual(findEffect(raven[0].attached, 'life').amount, 1, 'life')
            expectEqual(findEffect(raven[1].attached, 'life').amount, 2, 'superior life')
            expectEqual(raven[0].roles.join(), 'intercept,soak,attachment', 'roles')

            // The stealth of the action that puts the card on is the action's own
            const strength = summaryOf(PRETERNATURAL_ID).plays[0]
            expectEqual(strength.roles.join(), 'strength,attachment', 'roles')
            findEffect(strength.attached, 'restrictPlay')
            expectEqual(strength.onePerMinion, true, 'one per minion')
        },
    },
    {
        name: 'Summary: a card in play says its abilities, with the window, the lock and the cost',
        run() {
            const labyrinth = summaryOf(LABYRINTH_ID).plays[0].abilities[0]
            expectEqual(labyrinth.activate, 'lockForAction', 'activate')
            expectEqual(labyrinth.windows.join(), 'ownAction', 'window')
            expectEqual(labyrinth.locks, true, 'locks the card')
            expectEqual(labyrinth.roles.join(), 'stealth', 'a stealth source')

            const [draw, burn] = summaryOf(WIDER_VIEW_ID).plays[0].abilities
            expectEqual(draw.transfers, 1, 'one transfer')
            expectEqual(draw.roles.join(), 'cycling', 'cycles the crypt')
            expectEqual(burn.transfers, 4, 'four transfers')
            expectEqual(burn.roles.join(), 'poolGain', 'pool')

            const barrens = summaryOf(BARRENS_ID).plays[0].abilities[0]
            expectEqual(barrens.locks, true, 'locks')
            expectEqual(barrens.windows.join(), 'masterPhase,discardPhase', 'windows')
        },
    },
    {
        name: 'Summary: a crypt card adds what the catalog says, a vanilla one nothing',
        run() {
            const aline = summaryOf(ALINE_ID)
            const trigger = findEffect(aline.cryptEffects, 'trigger')
            expectEqual(trigger.costBlood, 1, 'burns a blood')
            expectEqual(trigger.oncePerTurn, true, 'once per turn')
            expectEqual(trigger.optional, true, 'a decision')
            expectEqual(aline.roles.join(), 'unlock', 'roles')

            const theo = summaryOf(THEO_BELL_ID)
            expectEqual(theo.roles.join(), 'combatStarter,strength', 'Theo Bell')

            const vanilla = summaryOf('201537')
            expectEqual(vanilla.cryptEffects.length, 0, 'nothing to add')
            expectEqual(vanilla.catalogued, true, 'catalogued')
        },
    },
    {
        name: 'Summary: a card the catalog does not describe is known by its name and cost only',
        run() {
            const summary = summaryOf('101895')
            expectEqual(summary.name, 'Sudario Refraction', 'name')
            expectEqual(summary.catalogued, false, 'not catalogued')
            expectEqual(summary.plays.length, 0, 'no play')
            expectEqual(summary.roles.length, 0, 'no role')
            expectEqual(summarizeCardId('999999'), undefined, 'unknown id')
        },
    },
    {
        name: 'Summary: a way is usable by a vampire with every discipline at the level it asks',
        run() {
            const [inferior, superior] = summaryOf(DEFLECTION_ID).plays
            const dominate: Partial<Disciplines> = {
                [Discipline.Dominate]: DisciplineLevel.INFERIOR,
            }
            const obfuscate: Partial<Disciplines> = {
                [Discipline.Obfuscate]: DisciplineLevel.SUPERIOR,
            }
            expectEqual(waysUsableBy(inferior.ways, dominate).length, 1, 'inferior with Dominate')
            expectEqual(waysUsableBy(superior.ways, dominate).length, 0, 'superior needs the level')
            expectEqual(waysUsableBy(inferior.ways, obfuscate).length, 0, 'wrong discipline')
            const both: Partial<Disciplines> = { [Discipline.Dominate]: DisciplineLevel.SUPERIOR }
            expectEqual(waysUsableBy(superior.ways, both).length, 1, 'superior')
        },
    },
    {
        name: 'Summary: Minion Tap is pool for me, from the blood of a vampire, and Life in the City is not',
        run() {
            const tap = summaryOf(MINION_TAP_ID).plays[0]
            expectEqual(tap.roles.join(), 'poolGain,master', 'roles of Minion Tap')
            expectEqual(
                tap.effects.map(effect => effect.type).join(),
                'bloodToPool',
                'effects of Minion Tap',
            )
            expectEqual(
                summaryOf(LIFE_IN_THE_CITY_ID).plays[0].roles.includes('poolGain'),
                false,
                'Life in the City',
            )
        },
    },
    {
        name: 'Summary: Villein is pool for me, stays on a vampire, and makes the cards of the same family cost more there',
        run() {
            const villein = summaryOf(VILLEIN_ID).plays[0]
            expectEqual(villein.roles.join(), 'poolGain,attachment,master', 'roles of Villein')
            expectEqual(
                villein.effects.map(effect => JSON.stringify(effect)).join(),
                '{"type":"bloodToPool","min":2,"max":5}',
                'effects of Villein',
            )
            expectEqual(
                villein.attached.map(effect => effect.type).join(),
                'raisePlayCost',
                'what it does while attached',
            )
        },
    },
    {
        name: 'Summary: every catalogued play has a role',
        run() {
            const without = CARD_DEFS.flatMap(def =>
                summaryOf(def.id).plays.some(play => play.roles.length == 0) ? [def.name] : [],
            )
            expectEqual(without.join(), '', 'cards with a play with no role')
        },
    },
]
