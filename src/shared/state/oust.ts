import { Player } from '@/shared/model/Player.ts'

// What an oust ( or its cancellation ) did to the predator. Plain data: it goes
// to the mutation's previousState and is serialized with it.
export type OustChange = {
    type: 'oust' | 'deoust'
    ousted: string
    predator: string
    vp: number // Signed
    pool: number // Signed
    predatorVp: number // After the change
    predatorPool: number // After the change
}

export function describeOustChange(
    ousted: Player,
    predator: Player,
    type: OustChange['type'],
    vp: number,
    pool: number,
): OustChange {
    return {
        type,
        ousted: ousted.name,
        predator: predator.name,
        vp,
        pool,
        predatorVp: predator.victoryPoints,
        predatorPool: predator.pool,
    }
}

// Log text for the mutations that can oust a player, appended to their own line
export function formatOustChange(change: OustChange | undefined): string {
    if (!change) {
        return ''
    }
    const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`
    const pool =
        change.pool != 0 ? ` ${signed(change.pool)} pool (now: ${change.predatorPool})` : ''
    const verb = change.type == 'oust' ? 'ousted' : 'back in the game'
    return ` | ${change.ousted} ${verb}: ${change.predator} ${signed(change.vp)} VP (now: ${change.predatorVp})${pool}`
}
