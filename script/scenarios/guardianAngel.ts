import { MinionActionType, CombatStep } from '@/shared/types/state.ts'
import { Discipline, DisciplineLevel } from '@/shared/const/model.ts'
import { getHost, isAttached } from '@/shared/state/attachments.ts'
import { getMinionIntercept } from '@/shared/cardImpl/catalog/attached.ts'
import { GovernAgent } from '../governAgent.ts'
import { AttachDeck } from '../attachDeck.ts'
import { applyOption } from '@/shared/bot/referee.ts'
import { stepBot } from '@/shared/bot/driver.ts'
import { DecisionPoint, optionsOfType } from '@/shared/bot/types.ts'
import {
    Fight,
    Scenario,
    attachInPlay,
    createFight,
    damageResolution,
    expectEqual,
    expectRegion,
    getCombat,
    passUntil,
    readyVampire,
} from './helpers.ts'
import { findAnyCard } from './attachment.ts'
import { getCombatDecision } from './combatCards.ts'
import { createDollTurn, playDoll } from './putOn.ts'
import { getMasterDecision } from './master.ts'
import { createCatalogBleed } from './catalog.ts'

export const GUARDIAN_ANGEL_ID = '100866'

// A fight where the defending vampire carries a Guardian Angel, in the damage resolution
function createAngelFight(regular: number, aggravated: number, defendingBlood = 3) {
    const fight = createFight(3, defendingBlood, AttachDeck)
    const angel = findAnyCard(fight.defendingPlayer, GUARDIAN_ANGEL_ID)
    attachInPlay(angel, fight.defending)
    damageResolution(fight, fight.defending, regular, aggravated)
    return { ...fight, angel }
}

const preventOptions = (decision: DecisionPoint) => optionsOfType(decision.options, 'combatPrevent')

const defenderDecision = (fight: Fight) => getCombatDecision(fight, fight.defendingPlayer)

export const GUARDIAN_ANGEL_SCENARIOS: Scenario[] = [
    {
        name: 'Guardian Angel costs 2 pool and is put on a ready vampire of the player, not on one in torpor',
        run() {
            const turn = createDollTurn([2, 3], GUARDIAN_ANGEL_ID)
            const targets = optionsOfType(getMasterDecision(turn).options, 'playMaster').map(
                option => option.target,
            )
            expectEqual(targets.length, 2, 'options')
            expectEqual(targets.includes(turn.torpid), false, 'not in torpor')
            const pool = turn.player.pool
            playDoll(turn, turn.vampires[1])
            expectEqual(getHost(turn.doll), turn.vampires[1], 'host')
            expectEqual(turn.player.pool, pool - 2, 'pool')
        },
    },
    {
        name: 'Guardian Angel gives +1 intercept against a bleed directed at its controller, not against another Methuselah nor a hunt',
        run() {
            const setup = {
                deck: AttachDeck,
                discipline: Discipline.Presence,
                level: DisciplineLevel.SUPERIOR,
                cards: [],
            }
            const bleed = createCatalogBleed(setup)
            const base = getMinionIntercept(bleed.blocker)
            attachInPlay(findAnyCard(bleed.bled, GUARDIAN_ANGEL_ID), bleed.blocker)
            expectEqual(getMinionIntercept(bleed.blocker), base + 1, 'bleed at its controller')

            const bystander = readyVampire(bleed.gameState, bleed.third, 3)
            const bystanderBase = getMinionIntercept(bystander)
            attachInPlay(findAnyCard(bleed.third, GUARDIAN_ANGEL_ID), bystander)
            expectEqual(getMinionIntercept(bystander), bystanderBase, 'bleed at another Methuselah')

            const hunt = createCatalogBleed({ ...setup, actionType: MinionActionType.Hunt })
            const huntBase = getMinionIntercept(hunt.blocker)
            attachInPlay(findAnyCard(hunt.bled, GUARDIAN_ANGEL_ID), hunt.blocker)
            expectEqual(getMinionIntercept(hunt.blocker), huntBase, 'hunt')
        },
    },
    {
        name: 'Guardian Angel prevents 1 regular damage once per combat, whatever the round',
        run() {
            const fight = createAngelFight(2, 0)
            const decision = defenderDecision(fight)
            const options = preventOptions(decision)
            expectEqual(options.length, 1, 'options')
            expectEqual(options[0].aggravated, false, 'regular')
            expectEqual(options[0].source, fight.angel, 'source')
            expectEqual(options[0].amount, 1, 'amount')

            applyOption(decision, options[0])
            expectEqual(getCombat(fight).defending.pendingDamage.regular, 1, 'damage left')
            expectEqual(preventOptions(defenderDecision(fight)).length, 0, 'once per combat')

            damageResolution(fight, fight.defending, 2, 0)
            expectEqual(
                preventOptions(defenderDecision(fight)).length,
                0,
                'not in the next round either',
            )
        },
    },
    {
        name: 'Guardian Angel prevents aggravated damage too, and nothing when there is no damage',
        run() {
            const fight = createAngelFight(0, 1)
            const decision = defenderDecision(fight)
            const options = preventOptions(decision)
            expectEqual(options.length, 1, 'options')
            expectEqual(options[0].aggravated, true, 'aggravated')
            applyOption(decision, options[0])
            expectEqual(getCombat(fight).defending.pendingDamage.aggravated, 0, 'damage left')

            const idle = createAngelFight(0, 0)
            expectEqual(preventOptions(defenderDecision(idle)).length, 0, 'no damage')
        },
    },
    {
        name: 'Guardian Angel: the Govern agent prevents the damage it can',
        run() {
            const fight = createAngelFight(2, 0)
            const step = stepBot(fight.defendingPlayer, new GovernAgent())
            expectEqual(step?.option.type, 'combatPrevent', 'option')
            expectEqual(getCombat(fight).defending.pendingDamage.regular, 1, 'damage left')
        },
    },
    {
        name: 'Guardian Angel is burned when its vampire goes to torpor, and stays while it is ready',
        run() {
            const spared = createAngelFight(1, 0, 3)
            passUntil(spared, CombatStep.EndOfRound)
            expectRegion(spared.defending, 'ready')
            expectEqual(getHost(spared.angel), spared.defending, 'still attached')

            const fight = createAngelFight(5, 0, 1)
            passUntil(fight, CombatStep.EndOfRound)
            expectRegion(fight.defending, 'torpor')
            expectEqual(fight.angel.isIn.ashHeap, true, 'burned')
            expectEqual(isAttached(fight.angel), false, 'attached')
        },
    },
]
