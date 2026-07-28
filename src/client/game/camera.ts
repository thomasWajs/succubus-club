import { nextTick, watch } from 'vue'
import Phaser from 'phaser'
import { display, layout } from '@/client/game/display.ts'
import { WorldAlignment } from '@/client/gateway/db.ts'
import { useUIFeatures } from '@/client/game/composables/useUIFeatures.ts'
import Pointer = Phaser.Input.Pointer

const ZOOM_SPEED = 0.001
let tabletopScene: Phaser.Scene | undefined

export function setupCamera(_tabletopScene: Phaser.Scene) {
    tabletopScene = _tabletopScene

    const { worldAlignment } = useUIFeatures()
    resetCamera()
    // Keep Camera scaled on resize
    tabletopScene.scale.on('resize', resetCamera)
    watch(worldAlignment, resetCamera)

    // When the user drags the right-column handle, the flex layout resizes the
    // canvas. Phaser only polls its parent size every ~500ms (ScaleManager's
    // resizeInterval), which lags behind the drag, so sync it explicitly once
    // the DOM has reflowed. In RESIZE mode refresh() reuses the cached
    // parentSize, so getParentBounds() must run first to read the new DOM size ;
    // refresh() then resizes the canvas and emits 'resize', re-running resetCamera.
    watch(
        () => layout.rightColumnWidth,
        () =>
            nextTick(() => {
                if (!tabletopScene) {
                    return
                }
                tabletopScene.scale.getParentBounds()
                tabletopScene.scale.refresh()
            }),
    )

    // Commented pending camera fixes. See https://github.com/thomasWajs/succubus-club/issues/12
    if (import.meta.env.VITE_ENABLE_CAMERA) {
        setupCameraControls(tabletopScene)
    }
}

export function getTabletopScene() {
    if (!tabletopScene) {
        throw new Error('Tabletop scene not initialized.')
    }
    return tabletopScene
}

export function resetCamera() {
    if (!tabletopScene) {
        return
    }

    const { worldAlignment } = useUIFeatures()
    const camera = tabletopScene.cameras.main
    camera.setZoom(display.scale)

    // Stick the game to the top right corner of the display
    const scrollToX0 = (display.actualWidth * (1 - display.scale)) / (2 * display.scale)
    const scrollToY0 = (display.actualHeight * (1 - display.scale)) / (2 * display.scale)

    if (worldAlignment.value == WorldAlignment.TopRight) {
        camera.scrollX = scrollToX0 - display.horizontalSpaceAvailable / display.scale
        // If there's some horizontal space left, add some padding
        camera.scrollX += display.horizontalPadding

        camera.scrollY = scrollToY0
    } else {
        camera.scrollX = scrollToX0 - display.horizontalSpaceAvailable / 2 / display.scale
        camera.scrollY = scrollToY0 - display.verticalSpaceAvailable / 2 / display.scale
    }
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
