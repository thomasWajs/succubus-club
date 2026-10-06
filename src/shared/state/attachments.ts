import { Card, Minion } from '@/shared/model/Card.ts'
import { CARD_WIDTH, GRID_SIZE } from '@/shared/const/game.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { cardHalfExtents, getTableCardScale } from '@/shared/state/cardPlacement.ts'

/**
 * Cards attached to a minion ( equipment, retainers ). The link lives in GameState.attachments;
 * an attached card stays in play in the region of its minion, under it, shifted to its top-right.
 * Only bots attach cards for now.
 */

// How far an attached card sticks out of its minion, to the top and to the right
const ATTACHMENT_SHIFT = 2 * GRID_SIZE

// The minion the card is attached to
export function getHost(card: Card): Minion | undefined {
    const hostOid = card.gameState.attachments[card.oid]
    const host = hostOid ? card.gameState.cards[hostOid] : undefined
    return host?.isMinion() ? host : undefined
}

export function isAttached(card: Card): boolean {
    return getHost(card) !== undefined
}

export function getAttachedCards(host: Card): Card[] {
    const gameState = host.gameState
    return Object.entries(gameState.attachments).flatMap(([attachedOid, hostOid]) => {
        const attached = gameState.cards[attachedOid]
        return hostOid == host.oid && attached ? [attached] : []
    })
}

// The nth card attached to the host: each one sticks out a little further than the previous
function getAttachmentPosition(host: Card, index: number): { x: number; y: number } {
    const scale = getTableCardScale(host.region)
    const { halfWidth } = cardHalfExtents(host, scale)
    const shift = ATTACHMENT_SHIFT * (index + 1)
    // Right-aligned with the minion, whether it is locked ( rotated ) or not
    return {
        x: host.x + 2 * halfWidth - CARD_WIDTH * scale + shift,
        y: Math.max(0, host.y - shift),
    }
}

/**
 * Puts the cards attached to the host where they belong: in its region, under it. To call after
 * the host moved. A host that is out of play burns what is attached to it.
 */
export function syncAttachedCards(gameState: GameState, host: Card): void {
    const attached = getAttachedCards(host)
    attached.forEach((card, index) => {
        if (!host.isIn.controlled) {
            gameState.detachCard(card.oid)
            if (card.isIn.play) {
                gameState.moveCardToRegion(card, card.owner.ashHeap)
            }
            return
        }
        if (card.region.oid != host.region.oid) {
            gameState.moveCardToRegion(card, host.region)
        }
        // Before the host in the region: drawn under it
        host.region.move(card, host.position)
        const { x, y } = getAttachmentPosition(host, index)
        card.setCoordinates(x, y)
    })
}
