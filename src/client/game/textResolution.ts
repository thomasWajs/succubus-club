import Phaser from 'phaser'
import { getPixelRatio } from '@/client/game/hiDpi.ts'

// Phaser rasterizes every Text once onto a canvas texture, which is then scaled
// by its parent containers and by the camera. A text is sharpest when rasterized
// at exactly the scale it ends up drawn at : magnified bitmaps are blurry, and
// so are minified ones ( bilinear sampling, no mipmaps ).
const MIN_RESOLUTION = 0.5
const MAX_RESOLUTION = 4
// Below this difference, a re-rasterization isn't worth it
const RESOLUTION_TOLERANCE = 0.002
// Re-rasterizing texts is costly : wait for the zoom to stop moving ( the sweep then runs
// right away ), and otherwise only sweep periodically ( container scales and camera
// assignment change rarely, and texts are created before they are attached to their
// final container )
const SETTLE_DELAY_MS = 60
const SWEEP_INTERVAL_MS = 250

const UI_CAMERA_NAME = 'FreeTableUI'

// A new text is checked on each of its first frames, as its parent containers are
// attached right after its creation
const NEW_TEXT_FRAMES = 30

const texts = new Set<Phaser.GameObjects.Text>()
const newTexts = new Map<Phaser.GameObjects.Text, number>()
const worldMatrix = new Phaser.GameObjects.Components.TransformMatrix()
const parentMatrix = new Phaser.GameObjects.Components.TransformMatrix()

let scene: Phaser.Scene | undefined
let observedZoom = 0
let lastZoomChangeTime = 0
let lastSweepTime = 0
let zoomSettling = false

/**
 * Free Table pins some containers ( Hand, wield window ) to the UI camera by
 * flagging them as ignored by the main one, on the container and not on its
 * children.
 */
function getRenderingCamera(
    text: Phaser.GameObjects.Text,
    main: Phaser.Cameras.Scene2D.Camera,
): Phaser.Cameras.Scene2D.Camera {
    let current: Phaser.GameObjects.GameObject | null = text
    while (current) {
        if (current.cameraFilter & main.id) {
            return scene?.cameras.getCamera(UI_CAMERA_NAME) ?? main
        }
        current = current.parentContainer
    }
    return main
}

function targetResolution(
    text: Phaser.GameObjects.Text,
    main: Phaser.Cameras.Scene2D.Camera,
): number {
    const camera = getRenderingCamera(text, main)
    text.getWorldTransformMatrix(worldMatrix, parentMatrix)
    const { scaleX, scaleY } = worldMatrix.decomposeMatrix()
    const scale = Math.max(Math.abs(scaleX), Math.abs(scaleY)) * camera.zoom * getPixelRatio()
    // Not quantized : the canvas size is truncated to whole pixels, so a resolution equal
    // to the real scale gives a quad of whole screen pixels ( 1:1 texel mapping )
    return Phaser.Math.Clamp(scale, MIN_RESOLUTION, MAX_RESOLUTION)
}

function applyTarget(text: Phaser.GameObjects.Text, main: Phaser.Cameras.Scene2D.Camera) {
    const target = targetResolution(text, main)
    if (Math.abs(target - text.style.resolution) > RESOLUTION_TOLERANCE) {
        text.setResolution(target)
    }
}

function onAddedToScene(gameObject: Phaser.GameObjects.GameObject) {
    if (!(gameObject instanceof Phaser.GameObjects.Text) || texts.has(gameObject)) {
        return
    }
    texts.add(gameObject)
    newTexts.set(gameObject, NEW_TEXT_FRAMES)
    gameObject.once(Phaser.GameObjects.Events.DESTROY, () => {
        texts.delete(gameObject)
        newTexts.delete(gameObject)
    })
}

function onUpdate(time: number) {
    if (!scene) {
        return
    }
    const main = scene.cameras.main
    // Update runs before rendering : a text that just appeared ( hover buttons ) is fixed
    // before its first draw, once its final container is known
    for (const [text, frames] of newTexts) {
        applyTarget(text, main)
        if (frames > 1) {
            newTexts.set(text, frames - 1)
        } else {
            newTexts.delete(text)
        }
    }
    if (main.zoom !== observedZoom) {
        observedZoom = main.zoom
        lastZoomChangeTime = time
        zoomSettling = true
        return
    }
    const settled = zoomSettling && time - lastZoomChangeTime >= SETTLE_DELAY_MS
    if (!settled && time - lastSweepTime < SWEEP_INTERVAL_MS) {
        return
    }
    zoomSettling = false
    lastSweepTime = time
    for (const text of texts) {
        applyTarget(text, main)
    }
}

function teardown() {
    newTexts.clear()
    scene?.sys?.events?.off(Phaser.Scenes.Events.ADDED_TO_SCENE, onAddedToScene)
    scene?.sys?.events?.off(Phaser.Scenes.Events.UPDATE, onUpdate)
    scene = undefined
    texts.clear()
}

/** Keep every Text of the scene rasterized at the scale it is displayed at. */
export function setupTextResolution(_scene: Phaser.Scene) {
    teardown()
    scene = _scene
    observedZoom = 0
    lastZoomChangeTime = 0
    lastSweepTime = 0
    zoomSettling = false
    scene.sys.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, onAddedToScene)
    scene.sys.events.on(Phaser.Scenes.Events.UPDATE, onUpdate)
    scene.sys.events.once(Phaser.Scenes.Events.SHUTDOWN, teardown)
}
