import { botMutations } from '@/shared/state/botMutations.ts'
import { CombatStep } from '@/shared/types/state.ts'
import {
    Fight,
    Scenario,
    createFight,
    damageResolution,
    expectEqual,
    expectRegion,
    expectStep,
    getCombat,
    must,
    mustRefuse,
    pass,
} from './helpers.ts'

/**
 * The damage to a human minion is left to the human.
 */

function createHumanDefender(blood: number): Fight {
    const fight = createFight(3, blood)
    fight.defendingPlayer.permId = 'human'
    return fight
}

export const HUMAN_DAMAGE_SCENARIOS: Scenario[] = [
    {
        name: 'the damage to a human minion is not applied when the window closes',
        run() {
            const fight = createHumanDefender(1)
            damageResolution(fight, fight.defending, 3, 0)
            mustRefuse(
                botMutations.COMBAT_applyDamage.act(fight.actingPlayer, { minion: fight.acting }),
                'apply damage without damage or impulse',
            )
            pass(fight.defendingPlayer, 'pass')
            expectEqual(fight.defending.blood, 1, 'defending blood')
            expectRegion(fight.defending, 'ready')
            expectEqual(getCombat(fight).defending.pendingDamage.regular, 0, 'pending damage')
            expectEqual(getCombat(fight).step, CombatStep.AdditionalStrikes, 'step')
        },
    },
    {
        name: 'apply damage applies it to a human minion now, torpor included',
        run() {
            const fight = createHumanDefender(1)
            damageResolution(fight, fight.defending, 3, 0)
            must(
                botMutations.COMBAT_applyDamage.act(fight.defendingPlayer, {
                    minion: fight.defending,
                }),
                'apply damage',
            )
            expectEqual(fight.defending.blood, 0, 'defending blood')
            expectRegion(fight.defending, 'torpor')
            mustRefuse(
                botMutations.COMBAT_applyDamage.act(fight.defendingPlayer, {
                    minion: fight.defending,
                }),
                'apply damage twice',
            )
            pass(fight.defendingPlayer, 'pass')
            expectStep(fight, CombatStep.EndOfRound)
        },
    },
    {
        name: 'the damage to a bot minion is still applied automatically',
        run() {
            const fight = createFight(3, 1)
            damageResolution(fight, fight.defending, 3, 0)
            pass(fight.defendingPlayer, 'pass')
            expectRegion(fight.defending, 'torpor')
        },
    },
]
