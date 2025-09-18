import Phaser from 'phaser'
import Pointer = Phaser.Input.Pointer
import { display } from '@/game/display.ts'

const ZOOM_SPEED = 0.001
let scene: Phaser.Scene | undefined

export function setupCamera(_scene: Phaser.Scene) {
    scene = _scene

    resetCamera()
    // Keep Camera scaled on resize
    scene.scale.on('resize', resetCamera)

    // Commented pending camera fixes. See https://github.com/thomasWajs/succubus-club/issues/12
    // setupCameraControls(scene)
}

export function resetCamera() {
    if (!scene) {
        return
    }

    const camera = scene.cameras.main
    camera.setZoom(display.scale)
    // Stick the game to the top left corner of the display
    camera.scrollX = (display.actualWidth * (1 - display.scale)) / (2 * display.scale)
    camera.scrollY = (display.actualHeight * (1 - display.scale)) / (2 * display.scale)
}

/**
 * Camera controls
 */

function setupCameraControls(scene: Phaser.Scene) {
    const camera = scene.cameras.main
    let cameraDragStartX: number
    let cameraDragStartY: number

    scene.input.on('pointerdown', (pointer: Pointer) => {
        if (pointer.middleButtonDown()) {
            cameraDragStartX = camera.scrollX + pointer.x / camera.zoom
            cameraDragStartY = camera.scrollY + pointer.y / camera.zoom
        }
    })

    scene.input.on('pointermove', (pointer: Pointer) => {
        if (pointer.middleButtonDown()) {
            camera.scrollX = cameraDragStartX + -pointer.x / camera.zoom
            camera.scrollY = cameraDragStartY + -pointer.y / camera.zoom
        }
    })

    scene.input.on('wheel', (pointer: Pointer, {}, {}, deltaY: number) => {
        // Get the old world point under pointer.
        const oldWorldPoint = camera.getWorldPoint(pointer.x, pointer.y)
        camera.zoom = camera.zoom - camera.zoom * ZOOM_SPEED * deltaY
        // Update camera matrix, so `getWorldPoint` returns zoom-adjusted coordinates.
        camera.preRender()
        const newWorldPoint = camera.getWorldPoint(pointer.x, pointer.y)
        // Scroll the camera to keep the pointer under the same world point.
        camera.scrollX -= newWorldPoint.x - oldWorldPoint.x
        camera.scrollY -= newWorldPoint.y - oldWorldPoint.y
    })
}
