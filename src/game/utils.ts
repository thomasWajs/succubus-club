import { CARD_HEIGHT, CARD_IN_PLAY_SCALE, CARD_WIDTH, GRID_SIZE } from '@/game/const.ts'
import Phaser, { GameObjects } from 'phaser'
import Pointer = Phaser.Input.Pointer
import { display } from '@/game/display.ts'
import { PhaserDataKey } from '@/game/types.ts'
import { AnyCardRegion, CardRegionOid } from '@/model/CardRegion.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { CardOid } from '@/model/Card.ts'

export function dropCoordinates(pointer: Pointer, toContainer: GameObjects.Container) {
    return toContainer.getLocalPoint(pointer.x / display.scale, pointer.y / display.scale)
}

export function dropCoordinatesSnapped(pointer: Pointer, toContainer: GameObjects.Container) {
    const coord = dropCoordinates(pointer, toContainer)

    // Snap the center of the card to the grid
    return {
        x: Phaser.Math.Snap.To(
            coord.x - (CARD_WIDTH / 2) * CARD_IN_PLAY_SCALE * toContainer.scaleX,
            GRID_SIZE,
        ),
        y: Phaser.Math.Snap.To(
            coord.y - (CARD_HEIGHT / 2) * CARD_IN_PLAY_SCALE * toContainer.scaleY,
            GRID_SIZE,
        ),
    }
}

export function positionContextMenu(
    x: number,
    top: number,
    bottom: number,
    selector: string,
    set: (x: number, y: number) => void,
) {
    // Get window dimensions
    const windowHeight = window.innerHeight

    let y = top
    const tempX = x
    const tempY = y

    // Temporarily show submenu off-screen to measure its height
    set(-9999, -9999)

    // Wait for next tick to measure
    setTimeout(() => {
        const submenuElement = document.querySelector<HTMLElement>(selector)
        const submenuHeight = submenuElement?.offsetHeight || 200

        // Reset temporary values
        x = tempX
        y = tempY

        // Check if submenu would overflow bottom of window
        if (y + submenuHeight > windowHeight) {
            // Position submenu to align its bottom with the button's bottom
            y = bottom - submenuHeight
        }

        // If submenu overflows the top, clamp it to the top of the window
        if (y < 0) {
            y = 0
        }

        set(x, y)
    }, 0)
}

export function getDropCardRegion(droppedOn: GameObjects.GameObject): AnyCardRegion | null {
    const gameState = useGameStateStore()

    const cardRegionOid = droppedOn.getData(PhaserDataKey.CardRegionOid) as CardRegionOid
    // Not dropped on any region
    if (!cardRegionOid) {
        return null
    }

    const cardRegion = gameState.cardRegions[cardRegionOid] as AnyCardRegion
    // Dropped on a region that doesn't exist in the game state, that should never happen
    if (!cardRegion) {
        throw new Error(`onDrop: targetCardRegion not found for oid ${cardRegionOid}`)
    }

    return cardRegion
}

export function getDraggedCard(cardImage: GameObjects.Image) {
    const gameState = useGameStateStore()

    const cardOid = cardImage.getData(PhaserDataKey.CardOid) as CardOid
    if (!cardOid) {
        throw new Error(`getDraggedCard: cardImage does not have a valid CardOid`)
    }

    const card = gameState.cards[cardOid]
    // Dropped on a region that doesn't exist in the game state, that should never happen
    if (!card) {
        throw new Error(`onDrop: card not found for oid ${cardOid}`)
    }

    return card
}
