import { CARD_HEIGHT, CARD_IN_PLAY_SCALE, CARD_WIDTH, GRID_SIZE } from '@/game/const.ts'
import Phaser, { GameObjects } from 'phaser'
import Vector2Like = Phaser.Types.Math.Vector2Like
import TransformXY = Phaser.Math.TransformXY
import Pointer = Phaser.Input.Pointer
import { display } from '@/game/display.ts'

export function dropCoordinates(pointer: Pointer, toContainer: GameObjects.Container) {
    return TransformXY(
        pointer.x / display.scale,
        pointer.y / display.scale,
        toContainer.x,
        toContainer.y,
        toContainer.rotation,
        toContainer.scaleX,
        toContainer.scaleY,
    ) as Vector2Like
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
