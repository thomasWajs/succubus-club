import Phaser from 'phaser'
import { AnyCardRegion, CardOid, Point2D } from '@/shared/types/model.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import Rectangle = Phaser.Geom.Rectangle

// Normalizes a drag's two opposite corners ( origin, current ) into a
// positive-width/height Rectangle, regardless of drag direction.
export function rectFromCorners(origin: Point2D, current: Point2D): Rectangle {
    let { x, y } = origin
    let [width, height] = [current.x - x, current.y - y]

    if (width < 0) {
        x += width
        width *= -1
    }
    if (height < 0) {
        y += height
        height *= -1
    }

    return new Rectangle(x, y, width, height)
}

/**
 * When some cards are selected in the opened wield stack, a shuffle only affects them.
 * A single card is not worth it : that would be a no-op.
 */
export function getShuffleSelection(cardRegion: AnyCardRegion): CardOid[] {
    const gameBus = useGameBusStore()
    if (!gameBus.wieldCardStack.show || gameBus.wieldCardStack.cardRegion?.oid != cardRegion.oid) {
        return []
    }
    const selected = gameBus.selectedCards
        .filter(card => card.region.oid == cardRegion.oid)
        .map(card => card.oid)
    return selected.length > 1 ? selected : []
}
