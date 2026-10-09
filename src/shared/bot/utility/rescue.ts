import { LEAVE_TORPOR_COST } from '@/shared/const/model.ts'
import { CardOid } from '@/shared/types/model.ts'
import { attackersOf } from '@/shared/bot/utility/defence.ts'
import { MinionProfile } from '@/shared/bot/utility/minionProfile.ts'
import { BotProfile } from '@/shared/bot/utility/profile.ts'
import {
    everyone,
    MethuselahSnapshot,
    readyMinions,
    TableSnapshot,
} from '@/shared/bot/utility/snapshot.ts'

/**
 * Torpor and the helpers. A Methuselah that is neither the prey nor the predator of another is often a
 * temporary helper, and may rescue its vampires: the rescue is directed at their Methuselah, who has no
 * reason to block it, and the vampire is ready at its next turn, able to act. So a Methuselah with all its
 * vampires in torpor can still be a menace, and a vampire of a helper is worth rescuing. Everything here
 * only reads the table snapshot ( .claude/docs/bot-ai-phase3.md, section 3b ).
 */

// A torpid vampire a helper may bring back before its Methuselah plays again
export type Return = {
    minion: MinionProfile
    // The chance it is back, with no help of mine: 0 when nobody at the table could pay for it
    chance: number
    // The blood it has once back: the rescuer pays the cost if it can, the vampire pays what is left
    blood: number
}

// The Methuselahs that may rescue a vampire of `owner` before it plays: not me ( what I do is my own
// decision ), not the owner, not its prey and not its predator
export function helpersOf(table: TableSnapshot, owner: MethuselahSnapshot): MethuselahSnapshot[] {
    const ring = everyone(table)
    const index = ring.indexOf(owner)
    const prey = ring[(index + 1) % ring.length]
    const predator = ring[(index - 1 + ring.length) % ring.length]
    return ring.filter(other => !other.isMe && other != owner && other != prey && other != predator)
}

// A minion can rescue a vampire when the two together hold the blood of the cost
function canRescue(rescuer: MinionProfile, vampire: MinionProfile): boolean {
    return rescuer.isVampire && rescuer.blood + vampire.blood >= LEAVE_TORPOR_COST
}

export function returnsOf(
    table: TableSnapshot,
    owner: MethuselahSnapshot,
    profile: BotProfile,
): Return[] {
    const helpers = helpersOf(table, owner)
    return owner.minions
        .filter(minion => minion.state == 'torpor')
        .map(minion => {
            const rescuers = helpers.map(helper =>
                readyMinions(helper).filter(rescuer => canRescue(rescuer, minion)),
            )
            const able = rescuers.filter(minions => minions.length > 0).length
            // The best-off rescuer pays what it can of the cost, the vampire pays what is left
            const paid = Math.min(
                LEAVE_TORPOR_COST,
                Math.max(0, ...rescuers.flat().map(rescuer => rescuer.blood)),
            )
            return {
                minion,
                chance: 1 - (1 - profile.helpers.rescueChance) ** able,
                blood: minion.blood - (LEAVE_TORPOR_COST - paid),
            }
        })
}

// What the return of a vampire is worth, in pool: its drain, if its Methuselah is still there to use it,
// raised by what keeps it in the game ( blood, equipment ), and cut when it comes back with no blood and
// must hunt first. `bloodAfter` is what is left once the cost is paid, so how the rescuer splits the cost
// changes the worth.
export function returnWorth(
    opening: { drain: number; survival: number; vampire: MinionProfile },
    bloodAfter: number,
    profile: BotProfile,
): number {
    const { bloodStay, equipmentStay, equipmentMax, hungryShare } = profile.helpers
    const { vampire } = opening
    const stay =
        1 +
        bloodStay * Math.min(1, Math.max(0, bloodAfter) / Math.max(1, vampire.capacity)) +
        equipmentStay * Math.min(vampire.attached.length, equipmentMax)
    return opening.drain * opening.survival * stay * (bloodAfter > 0 ? 1 : hungryShare)
}

// At most this many torpid vampires of a Methuselah are weighed: each one doubles the boards to play out
const MAX_RETURNS = 3

export type Board = {
    p: number
    // The minions of the Methuselah that can bleed on its next turn, the ones back from torpor included
    minions: MinionProfile[]
}

/**
 * The boards a Methuselah may attack with on its next turn, each with its chance: the ready minions
 * with blood, plus any subset of the vampires a helper may bring back. `forced` fixes one torpid vampire
 * as back ( rescued by whoever asks, paying the cost ) or as staying in torpor.
 */
export function boardsOf(
    table: TableSnapshot,
    owner: MethuselahSnapshot,
    profile: BotProfile,
    forced?: { oid: CardOid; returns: boolean },
): Board[] {
    const base = attackersOf(owner, 'nextTurn')
    const candidates = returnsOf(table, owner, profile)
        .map(back => {
            if (forced?.oid == back.minion.oid) {
                // The drain of a return is the one of a vampire able to bleed: what it lacks in blood is
                // priced apart ( returnWorth )
                return {
                    ...back,
                    chance: forced.returns ? 1 : 0,
                    blood: Math.max(1, back.minion.blood),
                }
            }
            return back
        })
        .filter(back => back.chance > 0 && back.blood > 0 && back.minion.bleed > 0)
        .toSorted(
            (a, b) =>
                Number(b.minion.oid == forced?.oid) - Number(a.minion.oid == forced?.oid) ||
                b.minion.bleed - a.minion.bleed,
        )
        .slice(0, MAX_RETURNS)

    let boards: Board[] = [{ p: 1, minions: base }]
    for (const back of candidates) {
        const returned = { ...back.minion, blood: back.blood, state: 'unlocked' as const }
        boards = boards.flatMap(board => [
            ...(back.chance < 1 ?
                [{ p: board.p * (1 - back.chance), minions: board.minions }]
            :   []),
            { p: board.p * back.chance, minions: [...board.minions, returned] },
        ])
    }
    return boards
}
