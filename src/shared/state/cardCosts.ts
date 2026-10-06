import { LibraryCard, Minion } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { Invalid, VALID, Validity } from '@/shared/types/state.ts'

/**
 * Costs of the library cards, checked and paid in one place.
 *
 * When a cost is paid depends on the kind of card: an action pays when it
 * resolves ( a blocked action never pays ), the other cards ( action modifier,
 * reaction, combat ) pay as soon as they are played.
 */

// Resolve a card's raw cost ( which may be the variable "X" ) to the number to
// actually spend. A declared X value is used when the cost is "X" ; an undeclared
// X falls back to 0.
export function resolveCost(cost: number | 'X', declaredX?: number): number {
    return cost == 'X' ? (declaredX ?? 0) : cost
}

// Whether the minion and its controller can afford the card. A variable "X" cost can only be
// afforded for a declared X. The pool is never emptied by a card.
export function canPayCosts(minion: Minion, card: LibraryCard, declaredX?: number): boolean {
    if ((card.bloodCost == 'X' || card.poolCost == 'X') && declaredX === undefined) {
        return false
    }
    return (
        minion.blood >= resolveCost(card.bloodCost, declaredX) &&
        minion.controller.pool > resolveCost(card.poolCost, declaredX)
    )
}

// For the cards played by a Methuselah with no minion ( master cards ) : only the pool counts
export function canPayPoolCost(player: Player, card: LibraryCard): boolean {
    return card.poolCost != 'X' && player.pool > card.poolCost
}

function payPoolCost(player: Player, card: LibraryCard, declaredX?: number): Validity {
    const poolCost = resolveCost(card.poolCost, declaredX)
    if (poolCost > 0) {
        const validity = gameMutations.changePool.act(player, { player, amount: -poolCost })
        if (!validity.isValid) {
            return Invalid(`card pool cost: ${validity.reason}`)
        }
    }
    return VALID
}

// The blood is paid by the minion, the pool by its controller. Stops at the first
// payment the engine refuses and returns why.
export function payCardCosts(minion: Minion, card: LibraryCard, declaredX?: number): Validity {
    const player = minion.controller

    const bloodCost = resolveCost(card.bloodCost, declaredX)
    if (bloodCost > 0) {
        const validity = gameMutations.changeBlood.act(player, {
            card: minion,
            amount: -bloodCost,
        })
        if (!validity.isValid) {
            return Invalid(`card blood cost: ${validity.reason}`)
        }
    }

    return payPoolCost(player, card, declaredX)
}

export function payMasterCardCosts(player: Player, card: LibraryCard): Validity {
    return payPoolCost(player, card)
}
