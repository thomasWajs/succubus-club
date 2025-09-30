import { useGameStateStore } from '@/store/gameState.ts'
import { Card } from '@/model/Card.ts'
import { Player } from '@/model/Player.ts'
import { CardRegionVisibility, RegionName } from '@/model/const.ts'
import {
    CardRevelationTarget,
    CardRevelationViewer,
    getViewerKey,
    PlayerVision,
} from '@/state/types.ts'

/**
 * Tell if a target (Card or CardRegion) is revealed
 * for a given viewer ( Player or ALL_PLAYERS )
 */
export function isRevealedToViewer(target: CardRevelationTarget, viewer: CardRevelationViewer) {
    const targetRevelation = useGameStateStore().revelations[target.oid] ?? {}
    return targetRevelation[getViewerKey(viewer)]
}

/**
 * Tell if a target (Card or CardRegion) is revealed to a given player
 */
export function isRevealedToPlayer(target: CardRevelationTarget, player: Player) {
    const revelation = useGameStateStore().revelations[target.oid] ?? {}
    return revelation.all || revelation[player.oid]
}

export function canSee(player: Player, card: Card) {
    // Flipping a card allow only to hide it while in play,
    // to not mess with visibility in the other regions
    if (
        card.isFlipped &&
        [RegionName.Controlled, RegionName.Torpor, RegionName.Uncontrolled].includes(
            card.region.name,
        )
    ) {
        return false
    }

    // Check revelations
    if (isRevealedToPlayer(card, player) || isRevealedToPlayer(card.region, player)) {
        // CardRegion or Card was revealed, we can see the Card.
        return true
    }

    // No revelations, let's check normal visibility rules
    return (
        card.region.visibility == CardRegionVisibility.VisibleToAll ||
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
    return Object.fromEntries(
        Object.values(useGameStateStore().players).map(player => [
            player.oid,
            canSeeOrPeek(player, card),
        ]),
    )
}
