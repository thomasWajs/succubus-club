import { Card, UNKNOWN_MINION_ATTRS, UNKNOWN_VAMPIRE_ATTRS } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { CardRegionVisibility } from '@/shared/const/model.ts'
import {
    CardRevelationTarget,
    CardRevelationViewer,
    getViewerKey,
    KnownCards,
    PlayerVision,
} from '@/shared/types/state.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { SerializedCard } from '@/shared/types/multiplayer.ts'

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

/**
 * The cards a viewer knows, as the krcgId of each. `viewer` undefined means
 * "only what everyone can see" ; `seeAll` is for a judge, who sees every card.
 */
export function getKnownCards(
    gameState: GameState,
    viewer: Player | undefined,
    seeAll = false,
): KnownCards {
    const knownCards: KnownCards = {}
    for (const card of Object.values(gameState.cards)) {
        if (
            card.krcgId &&
            (seeAll || anyoneCanSee(card) || (viewer && canSeeOrPeek(viewer, card)))
        ) {
            knownCards[card.oid] = card.krcgId
        }
    }
    return knownCards
}

/**
 * Hide the attributes of a serialized card the viewer doesn't know, to avoid
 * leaking info on hidden cards. Does nothing for a card they know.
 *
 * A crypt card keeps the UNKNOWN markers : everyone can see it's a crypt card, and
 * that's exactly the state CryptCard builds by default. It also has to keep them, as
 * initMinionAttrs only refills attrs that hold the marker.
 * A library card drops them entirely : being an ally is hidden information, and
 * LibraryCard.initMinionAttrs recreates them on reveal.
 */
export function redactUnknownCard(card: SerializedCard, knownCards: KnownCards) {
    if (card.oid in knownCards) {
        return
    }

    if (card.isCrypt) {
        card.minionAttrs = UNKNOWN_MINION_ATTRS
        card.vampireAttrs = UNKNOWN_VAMPIRE_ATTRS
    } else {
        delete card.minionAttrs
        delete card.vampireAttrs
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
