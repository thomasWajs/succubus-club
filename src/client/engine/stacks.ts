/**
 * The stacks of a game with the rules engine ( GameType.Engine ) : a card in
 * play and the cards on it ( a minion's equipment, retainers, a card stored on a
 * location ). The cards on it rise above it, a title's height each in their
 * order of arrival, behind it ( see Projection.position ) : the bearer in front,
 * each title showing. Hover raises a card only while hovered, then its stack
 * goes back to that order. In torpor a stack rises into the ready region's
 * bottom row, its strips over the foot of the minions there ( the torpor region
 * is drawn over the ready one ) : any other way hides the titles.
 */

import { Card } from '@/shared/model/Card.ts'
import { CardOid } from '@/shared/types/model.ts'
import { useEngineStore } from '@/client/store/engine.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { getOverlappingCards } from '@/client/game/utils.ts'

// The bearer of the stack a card is in ( itself, if it bears cards )
function bearerOf(oid: CardOid): CardOid | undefined {
    const stacks = useEngineStore().stacks
    if (oid in stacks) {
        return oid
    }
    return Object.keys(stacks).find(bearer => stacks[bearer].includes(oid))
}

// Its cards furthest from it at the back, it in front
export function restoreStack(bearer: CardOid) {
    const gameState = useGameStateStore()
    const gameBus = useGameBusStore()
    const onIt = (useEngineStore().stacks[bearer] ?? [])
        .map(oid => gameState.cards[oid])
        .filter((card): card is Card => card !== undefined && card.region.is.play)
        .sort((a, b) => a.y - b.y)
    for (const card of onIt) {
        gameBus.cardsInGame[card.oid]?.bringToTop()
    }
    gameBus.cardsInGame[bearer]?.bringToTop()
}

// Once a card is no longer hovered : the stacks of it and of the cards it covers back in
// order, the other minions it covers on top ( as SC does )
export function restoreAround(card: Card) {
    const gameBus = useGameBusStore()
    const bearers = new Set<CardOid>()
    for (const other of [card, ...getOverlappingCards(card)]) {
        const bearer = bearerOf(other.oid)
        if (bearer !== undefined) {
            bearers.add(bearer)
        } else if (other.isMinion()) {
            gameBus.cardsInGame[other.oid]?.bringToTop()
        }
    }
    bearers.forEach(restoreStack)
}
