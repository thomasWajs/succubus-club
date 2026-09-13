import { nextTick, ref, watch } from 'vue'
import Phaser from 'phaser'
import { display, layout } from '@/client/game/display.ts'
import { WorldAlignment } from '@/client/gateway/db.ts'
import { useUIFeatures } from '@/client/game/composables/useUIFeatures.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import {
    FREE_TABLE_BOTTOM_MARGIN,
    FREE_TABLE_HEIGHT,
    FREE_TABLE_TOP_MARGIN,
    FREE_TABLE_WIDGET_RADIUS,
    FREE_TABLE_WIDTH,
    TOP_AREA_WIDTH,
} from '@/shared/const/game.ts'
import { Point2D } from '@/shared/types/model.ts'
import {
    PLAY_AREA_CENTER,
    rotatePoint,
    rotatedAabbHalfExtents,
} from '@/shared/state/freeTableLayout.ts'
import Pointer = Phaser.Input.Pointer

const ZOOM_SPEED = 0.001
const FREE_TABLE_MIN_ZOOM = 0.3
const FREE_TABLE_MAX_ZOOM = 2
let tabletopScene: Phaser.Scene | undefined
let freeTableUICamera: Phaser.Cameras.Scene2D.Camera | undefined
// Camera.rotation is a private runtime property ( no public getter ), so the
// value set by resetFreeTableCamera is tracked here for clampFreeTableCamera
// to read back.
let freeTableCameraRotation = 0

// The current Free Table camera rotation. Content that must stay upright for
// the local viewer regardless of pan/rotate ( e.g. each PlayerWidget's body )
// counter-rotates by the negative of this. Pair reads with `void
// cameraTick.value` to stay reactive, since the value lives outside Vue.
export function getFreeTableCameraRotation() {
    return freeTableCameraRotation
}

// getScreenPoint() reads scroll/zoom/rotation straight off the
// ( non-reactive ) Phaser camera, so Vue computeds relying on it ( floating
// actions, vote boxes, drop tooltip... ) never re-ran on Free Table's free
// pan/zoom. Bumped on every camera change below, purely so getScreenPoint()
// callers register it as a Vue dependency.
export const cameraTick = ref(0)

export function setupCamera(_tabletopScene: Phaser.Scene) {
    tabletopScene = _tabletopScene
    const gameState = useGameStateStore()

    // Free Table's freely pannable/zoomable camera is independent from
    // standard mode's fixed, fit-to-HUD one below, and isn't gated behind
    // VITE_ENABLE_CAMERA : that gate exists because the standard camera fights
    // the fixed per-player HUD layout ( issue #12 ), which Free Table lacks.
    if (gameState.isFreeTable) {
        resetFreeTableCamera()
        tabletopScene.scale.on('resize', resetFreeTableCamera)
        setupCameraControls(tabletopScene)
        return
    } else {
        const { worldAlignment } = useUIFeatures()
        resetCamera()
        // Keep Camera scaled on resize
        tabletopScene.scale.on('resize', resetCamera)
        watch(worldAlignment, resetCamera)
    }

    watchRightColumnResize()
}

// When the user drags the right-column handle, the flex layout resizes the
// canvas. Phaser only polls its parent size every ~500ms (ScaleManager's
// resizeInterval), which lags behind the drag, so sync it explicitly once
// the DOM has reflowed. In RESIZE mode refresh() reuses the cached
// parentSize, so getParentBounds() must run first to read the new DOM size ;
// refresh() then resizes the canvas and emits 'resize', re-running whichever
// reset function is active for the current mode.
function watchRightColumnResize() {
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
 * Free Table camera
 */

// Fit the whole shared table into the viewport, centered, rotated so the
// local player's own PlayerWidget renders at the bottom of their screen
// ( mirroring structured mode's "you're always at the bottom" convention ).
// Used both for the initial camera position and as the resize handler.
export function resetFreeTableCamera() {
    if (!tabletopScene) {
        return
    }
    const players = usePlayersStore()
    const camera = tabletopScene.cameras.main

    // Spectators ( no self player ) get the unrotated overview. Rotating by
    // the exact opposite of the self widget's facing rotation cancels it out
    // visually and swings it to the bottom of the screen, since centerOn()
    // below pivots on the seats' own center.
    const cameraRotation = -(players.selfPlayer?.widgetRotation ?? 0)

    // Fit to the actual bounding box of every seat's widget rather than the
    // fixed pentagon they're laid out around, so the view follows widgets
    // dragged off their initial layout ( FT_movePlayerWidget ).
    const { center, halfWidth, halfHeight } = getSeatsBoundingBox(
        players.orderedPlayers.map(player => player.widgetPosition),
    )

    // Rotated-AABB fit, so the seats stay on screen at any rotation.
    const { halfWidth: rotatedHalfWidth, halfHeight: rotatedHalfHeight } = rotatedAabbHalfExtents(
        halfWidth,
        halfHeight,
        cameraRotation,
    )

    // Fit into a "safe" rectangle rather than the full screen, clear of the
    // fixed UI pinned around the viewport ( Hand, top margin, GameTopArea ).
    const safeLeft = TOP_AREA_WIDTH / 2
    const safeRight = display.actualWidth
    const safeTop = FREE_TABLE_TOP_MARGIN
    const safeBottom = display.actualHeight - FREE_TABLE_BOTTOM_MARGIN
    const safeWidth = safeRight - safeLeft
    const safeHeight = safeBottom - safeTop

    camera.setZoom(
        Math.min(safeWidth / (2 * rotatedHalfWidth), safeHeight / (2 * rotatedHalfHeight)),
    )
    camera.setRotation(cameraRotation)
    freeTableCameraRotation = cameraRotation

    // Center the seats on the safe rectangle instead of the full screen :
    // centerOn(wx, wy) maps world point (wx, wy) to screen center, so to land
    // `center` on the safe rectangle's center instead, offset it by the
    // ( rotation- and zoom-adjusted ) screen-space gap between the two.
    const safeCenterScreen = {
        x: (safeLeft + safeRight) / 2,
        y: (safeTop + safeBottom) / 2,
    }
    const screenCenter = { x: display.actualWidth / 2, y: display.actualHeight / 2 }
    const shift = rotatePoint(
        {
            x: (safeCenterScreen.x - screenCenter.x) / camera.zoom,
            y: (safeCenterScreen.y - screenCenter.y) / camera.zoom,
        },
        -cameraRotation,
    )
    camera.centerOn(center.x - shift.x, center.y - shift.y)
    cameraTick.value++
}

// A widget-disc's diameter of breathing room around the seats' bounding box,
// so the fit doesn't crop the widgets themselves ( widgetPosition is each
// widget's center, and the disc extends one radius around it, see
// PlayerWidget.vue ). Falls back to the table's own center/pentagon-ish extent
// when there are no seats yet ( e.g. camera setup runs before players are
// loaded ).
const SEATS_BOUNDING_BOX_PADDING = 2 * FREE_TABLE_WIDGET_RADIUS

function getSeatsBoundingBox(seatPositions: Point2D[]): {
    center: Point2D
    halfWidth: number
    halfHeight: number
} {
    if (seatPositions.length === 0) {
        return {
            center: { x: FREE_TABLE_WIDTH / 2, y: FREE_TABLE_HEIGHT / 2 },
            halfWidth: FREE_TABLE_WIDTH / 4,
            halfHeight: FREE_TABLE_HEIGHT / 4,
        }
    }

    const xs = seatPositions.map(position => position.x)
    const ys = seatPositions.map(position => position.y)
    const minX = Math.min(...xs) - SEATS_BOUNDING_BOX_PADDING
    const maxX = Math.max(...xs) + SEATS_BOUNDING_BOX_PADDING
    const minY = Math.min(...ys) - SEATS_BOUNDING_BOX_PADDING
    const maxY = Math.max(...ys) + SEATS_BOUNDING_BOX_PADDING

    return {
        center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
        halfWidth: (maxX - minX) / 2,
        halfHeight: (maxY - minY) / 2,
    }
}

// A second camera, layered on top of the main ( pannable / zoomable ) one,
// meant to render HUD elements ( the player's hand, the stack browser ) pinned
// to the screen regardless of the main camera's pan/zoom. Consumed by
// FreeTable.vue once its display list exists : the caller must `ignore()` the
// table's world objects on this camera, and `ignore()` the pinned HUD objects
// on `camera.main`, so each camera only renders its own layer.
export function createFreeTableUICamera(scene: Phaser.Scene): Phaser.Cameras.Scene2D.Camera {
    const uiCamera = scene.cameras.add(0, 0, scene.scale.width, scene.scale.height)
    uiCamera.setName('FreeTableUI')
    scene.scale.on('resize', () => {
        uiCamera.setSize(scene.scale.width, scene.scale.height)
    })
    freeTableUICamera = uiCamera
    return uiCamera
}

// Content pinned to the screen through the Free Table UI camera ( Hand,
// WieldCardStack ) sits at zoom 1 / scroll (0,0) in that camera's own view,
// unrelated to the main camera's pan/zoom over the table. Its world
// coordinates are therefore raw screen pixels : the WieldCardStack anchors to
// the top ( WIELD_Y = 0 ), the Hand anchors to the bottom by being positioned
// at actualHeight - HAND_HEIGHT ( see FreeTable.vue ) rather than by scrolling
// this camera, which would shift the top-anchored content off screen too.
// Anything converting pointer <-> world coordinates for that content ( see
// getWorldPoint(), dropCoordinates() in utils.ts ) must go through this camera
// specifically, not the default main one.
export function getFreeTableUICamera() {
    if (!freeTableUICamera) {
        throw new Error('Free Table UI camera not initialized.')
    }
    return freeTableUICamera
}

/**
 * Camera controls
 *
 * Pan ( middle-drag ), zoom-to-cursor ( wheel ), and free rotate ( shift +
 * left- or middle-drag ). Shift + left-drag was picked because plain left is
 * already claimed for card selection/drag/area-select
 * and plain middle for panning ; plain shift + click is also already
 * multi-select ( useCardClick.ts ), so rotate only engages once the pointer
 * actually moves while shift is held, and input.ts's area-select start is
 * gated off while shift is held so it doesn't also kick in underneath.
 * Rotating a card under the pointer can still also add it to the selection
 * ( the scene-wide pointerdown below fires alongside the card's own ), which
 * is an accepted rough edge for now rather than hit-testing for an empty
 * table area first.
 *
 * Rotate pivots around PLAY_AREA_CENTER ( freeTableLayout.ts's seat-layout
 * center, a fixed world point ) rather than wherever the player has panned to
 * : Phaser itself only ever pivots around the world point at screen center,
 * so scroll is re-derived on every rotate step to keep PLAY_AREA_CENTER's own
 * screen position fixed instead - see the pointermove handler below.
 *
 * Card drag/drop coordinates ( useCardDragDrop.ts )
 * need no camera-awareness fix of their own : Phaser's drag plugin already
 * derives dragX/dragY from `pointer.positionToCamera()`, which accounts for
 * the active camera's scroll, zoom, AND rotation internally. Likewise,
 * ContextMenu.vue positions itself from raw pointer.x/y ( already
 * screen-space, camera-independent ), and alignment guides render as Phaser
 * GameObjects inside worldContainer, so the engine transforms them with the
 * main camera automatically. HandGO.vue / WieldCardStack.vue's own reorder-
 * on-drag logic isn't automatic though : it manually converts pointer
 * position to world coordinates via getWorldPoint() / dropCoordinates(), which
 * must be told to use getFreeTableUICamera() there, since both live in the
 * pinned Container ( not worldContainer ) in Free Table. The one remaining
 * gap is ChangePoolMenu.vue, which computes its DOM position from a hardcoded
 * standard-mode world anchor via a fixed `display.scale` multiply, ignoring
 * camera scroll entirely : that's addressed in Task 6.1, once Free Table has
 * an actual world anchor ( the clicked PoolWidget ) to convert, and can go
 * through the existing `getScreenPoint()` ( utils.ts ), which already
 * inverts scroll/zoom/rotation correctly.
 */

function setupCameraControls(scene: Phaser.Scene) {
    const camera = scene.cameras.main
    let cameraDragStartX: number
    let cameraDragStartY: number
    let cameraRotateStartAngle: number
    let cameraRotateStartRotation: number
    let cameraRotateStartScrollX: number
    let cameraRotateStartScrollY: number

    // Shift held with either drag button rotates instead of panning ( shift +
    // left is free - plain left drags cards/selects, and plain shift + click
    // is already multi-select, see useCardClick.ts and input.ts's
    // selection-area gating - and shift + middle keeps the "rotate" meaning
    // consistent regardless of which button a player reaches for ).
    function isRotateDrag(pointer: Pointer): boolean {
        return pointer.event.shiftKey && (pointer.leftButtonDown() || pointer.middleButtonDown())
    }

    function isPanDrag(pointer: Pointer): boolean {
        return pointer.middleButtonDown() && !pointer.event.shiftKey
    }

    scene.input.on('pointerdown', (pointer: Pointer) => {
        if (isPanDrag(pointer)) {
            // World point under the cursor at drag start ( via getWorldPoint(), not
            // pointer.x / zoom ) : the camera can be rotated per-player ( see
            // resetFreeTableCamera ), and a raw pointer.x/zoom offset only maps to
            // world space along unrotated screen axes - it drags the wrong way for
            // any player whose camera isn't rotation 0.
            const worldPoint = camera.getWorldPoint(pointer.x, pointer.y)
            cameraDragStartX = worldPoint.x
            cameraDragStartY = worldPoint.y
        } else if (isRotateDrag(pointer)) {
            // Angle from the screen center to the pointer at drag start, so
            // pointermove below can measure how far the pointer has swept
            // around that pivot since ( this is just for measuring the drag
            // gesture - the camera itself pivots around the play area's
            // center, see pointermove below ).
            const { x: centerX, y: centerY } = getCameraScreenCenter(camera)
            cameraRotateStartAngle = Math.atan2(pointer.y - centerY, pointer.x - centerX)
            cameraRotateStartRotation = freeTableCameraRotation
            cameraRotateStartScrollX = camera.scrollX
            cameraRotateStartScrollY = camera.scrollY
        }
    })

    scene.input.on('pointermove', (pointer: Pointer) => {
        if (isPanDrag(pointer)) {
            // Re-anchor : shift scroll ( world-space ) by however far the world
            // point currently under the pointer ( still under the pre-shift scroll )
            // has drifted from the drag-start anchor, same technique as the wheel
            // handler's zoom-to-cursor below.
            const worldPoint = camera.getWorldPoint(pointer.x, pointer.y)
            camera.scrollX += cameraDragStartX - worldPoint.x
            camera.scrollY += cameraDragStartY - worldPoint.y
            clampFreeTableCamera(camera)
            cameraTick.value++
        } else if (isRotateDrag(pointer)) {
            const { x: centerX, y: centerY } = getCameraScreenCenter(camera)
            const currentAngle = Math.atan2(pointer.y - centerY, pointer.x - centerX)
            const rotation = cameraRotateStartRotation + (currentAngle - cameraRotateStartAngle)

            // Phaser's forward transform is screen = screenCenter + zoom * R(rotation)
            // * (world - screenCenterWorldPoint), with screenCenterWorldPoint =
            // scroll + camera.width/height / 2 ( see clampFreeTableCamera's own
            // comment on that same identity ). Solving screen_P(rotation) ==
            // screen_P(cameraRotateStartRotation) for the new screenCenterWorldPoint
            // that keeps the play area's center P at that same screen position
            // gives R(-rotationDelta), not R(+rotationDelta) - easy to get backwards.
            const halfWidth = camera.width / 2
            const halfHeight = camera.height / 2
            const rotationDelta = rotation - cameraRotateStartRotation
            const pivotOffset = rotatePoint(
                {
                    x: PLAY_AREA_CENTER.x - cameraRotateStartScrollX - halfWidth,
                    y: PLAY_AREA_CENTER.y - cameraRotateStartScrollY - halfHeight,
                },
                -rotationDelta,
            )
            camera.scrollX = PLAY_AREA_CENTER.x - halfWidth - pivotOffset.x
            camera.scrollY = PLAY_AREA_CENTER.y - halfHeight - pivotOffset.y
            camera.setRotation(rotation)
            freeTableCameraRotation = rotation
            clampFreeTableCamera(camera)
            cameraTick.value++
        }
    })

    scene.input.on('wheel', (pointer: Pointer, {}, {}, deltaY: number) => {
        // Get the old world point under pointer.
        const oldWorldPoint = camera.getWorldPoint(pointer.x, pointer.y)
        const newZoom = camera.zoom - camera.zoom * ZOOM_SPEED * deltaY
        camera.zoom = Phaser.Math.Clamp(newZoom, FREE_TABLE_MIN_ZOOM, FREE_TABLE_MAX_ZOOM)
        // Update camera matrix, so `getWorldPoint` returns zoom-adjusted coordinates.
        camera.preRender()
        const newWorldPoint = camera.getWorldPoint(pointer.x, pointer.y)
        // Scroll the camera to keep the pointer under the same world point.
        camera.scrollX -= newWorldPoint.x - oldWorldPoint.x
        camera.scrollY -= newWorldPoint.y - oldWorldPoint.y
        clampFreeTableCamera(camera)
        cameraTick.value++
    })
}

// The screen-space point the camera rotates ( and, per resetFreeTableCamera,
// centers ) around - camera.width/height is the raw viewport size, same space
// as pointer.x/y, unlike the zoom-adjusted display size.
function getCameraScreenCenter(camera: Phaser.Cameras.Scene2D.Camera): Point2D {
    return { x: camera.width / 2, y: camera.height / 2 }
}

// Keep the main camera from scrolling far enough to show space outside the
// shared table. Phaser's Camera.setBounds() only clamps scroll set via
// startFollow(), not the manual scrollX/scrollY writes used above, so bounds
// are enforced by hand here. The camera can be rotated ( each player views
// their own seat "down" ), so clamp the rotated-AABB half-extents rather than
// the raw viewport size, or a rotated camera could peek past the table edge
// on the diagonal.
function clampFreeTableCamera(camera: Phaser.Cameras.Scene2D.Camera) {
    // scrollX/scrollY aren't world-space coordinates : the world point at
    // screen center is `scroll + camera.width / 2`, using the RAW ( unzoomed )
    // viewport size, not `camera.width / zoom` - only the *visible extent*
    // needs the zoom-adjusted half-size. Conflating the two used to miscompute
    // the center at any zoom other than 1, leaving dead space on one side of
    // the table and cutting the pan range short on the other.
    const originHalfWidth = camera.width / 2
    const originHalfHeight = camera.height / 2
    const halfViewWidth = camera.width / (2 * camera.zoom)
    const halfViewHeight = camera.height / (2 * camera.zoom)
    const rotation = freeTableCameraRotation
    const { halfWidth: rotatedHalfWidth, halfHeight: rotatedHalfHeight } = rotatedAabbHalfExtents(
        halfViewWidth,
        halfViewHeight,
        rotation,
    )

    const centerX = camera.scrollX + originHalfWidth
    const centerY = camera.scrollY + originHalfHeight

    const clampedCenterX = clampCameraCenter(centerX, rotatedHalfWidth, FREE_TABLE_WIDTH)
    const clampedCenterY = clampCameraCenter(centerY, rotatedHalfHeight, FREE_TABLE_HEIGHT)

    camera.scrollX = clampedCenterX - originHalfWidth
    camera.scrollY = clampedCenterY - originHalfHeight
}

// If the ( rotated ) view is wider/taller than the table itself ( zoomed out
// past FREE_TABLE_MIN_ZOOM's natural limit for this viewport ), there's no
// valid clamp range left on that axis : center on the table instead of
// picking an arbitrary edge.
function clampCameraCenter(center: number, halfExtent: number, tableSize: number): number {
    if (halfExtent * 2 >= tableSize) {
        return tableSize / 2
    }
    return Phaser.Math.Clamp(center, halfExtent, tableSize - halfExtent)
}
