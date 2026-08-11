import { Card } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { CardRegionVisibility } from '@/shared/const/model.ts'
import {
    CardRevelationTarget,
    CardRevelationViewer,
    getViewerKey,
    PlayerVision,
} from '@/shared/types/state.ts'

/**
 * Tell if a target (Card or CardRegion) is revealed
 * for a given viewer ( Player or ALL_PLAYERS )
 */
export function isRevealedToViewer(target: CardRevelationTarget, viewer: CardRevelationViewer) {
    const gameState = target.gameState
    const targetRevelation = gameState.revelations[target.oid] ?? {}
    return targetRevelation[getViewerKey(viewer)]
}

/**
 * Tell if a target (Card or CardRegion) is revealed to a given player
 */
export function isRevealedToPlayer(target: CardRevelationTarget, player: Player) {
    const gameState = target.gameState
    const revelation = gameState.revelations[target.oid] ?? {}
    return revelation.all || revelation[player.oid]
}

export function anyoneCanSee(card: Card) {
    // Flipping a card allow only to hide it while in play,
    // to not mess with visibility in the other regions
    if (card.isFlipped && card.isIn.play) {
        return false
    }

    // Special case for uncontrolled region, where non vampire minion cards are always visible
    if (card.isIn.uncontrolled && !card.isCrypt && !card.isVampire()) {
        return true
    }

    return card.region.visibility == CardRegionVisibility.VisibleToAll
}

export function canSee(player: Player, card: Card) {
    // Flipping a card allow only to hide it while in play,
    // to not mess with visibility in the other regions
    if (card.isFlipped && card.isIn.play) {
        return false
    }

    // Check revelations
    if (isRevealedToPlayer(card, player) || isRevealedToPlayer(card.region, player)) {
        // CardRegion or Card was revealed, we can see the Card.
        return true
    }

    // No revelations, let's check normal visibility rules
    return (
        anyoneCanSee(card) ||
        (card.region.visibility == CardRegionVisibility.VisibleToController &&
            card.controllerOid == player.oid)
    )
}

export function canPeek(player: Player, card: Card) {
    return card.region.visibility != CardRegionVisibility.Hidden && card.controllerOid == player.oid
}

export function canSeeOrPeek(player: Player, card: Card) {
    return canSee(player, card) || canPeek(player, card)
}

export function getPlayerVision(card: Card): PlayerVision {
    const gameState = card.gameState
    return {
        public: anyoneCanSee(card),
        ...Object.fromEntries(
            Object.values(gameState.players).map(player => [
                player.oid,
                canSeeOrPeek(player, card),
            ]),
        ),
    }
}

export function secureName(target: Card | Player, viewer?: Player) {
    if (target instanceof Card) {
        const visible = viewer ? canSeeOrPeek(viewer, target) : anyoneCanSee(target)
        return visible ? target.name : 'Hidden Card'
    } else {
        return target.name
    }
}
