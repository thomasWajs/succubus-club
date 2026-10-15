import { CardOid } from '@/shared/types/model.ts'
import { Assessment } from '@/shared/bot/utility/assessment.ts'
import { forecastFight, myFighter, theirFighter } from '@/shared/bot/utility/combatPosition.ts'
import { MinionProfile } from '@/shared/bot/utility/minionProfile.ts'
import { readyMinions } from '@/shared/bot/utility/snapshot.ts'

/**
 * The blood a vampire keeps rather than turn it into pool: the blood it keeps anyway, and the blood the worst fight
 * against a minion of my prey or my predator would take from it, times the fights a neighbour runs me into each
 * turn. A table of bleeders and thieves takes none, a table of fighters takes a vampire down to torpor.
 */

const KEEPS = new WeakMap<Assessment, Map<CardOid, number>>()

export function keepOf(assessment: Assessment, vampire: MinionProfile): number {
    const known = KEEPS.get(assessment) ?? new Map<CardOid, number>()
    KEEPS.set(assessment, known)
    const cached = known.get(vampire.oid)
    if (cached !== undefined) {
        return cached
    }
    const { table, profile, densities } = assessment
    const neighbours = new Set(table.others.filter(other => other.isPrey || other.isPredator))
    let lost = 0
    for (const neighbour of neighbours) {
        for (const fighter of readyMinions(neighbour)) {
            const fight = forecastFight(
                myFighter(table, vampire),
                theirFighter(neighbour, densities[neighbour.oid], fighter),
                profile,
            )
            lost = Math.max(lost, fight.acting.blood)
        }
    }
    const keep = profile.bloat.keep + lost * profile.hand.fightsPerTurn
    known.set(vampire.oid, keep)
    return keep
}
