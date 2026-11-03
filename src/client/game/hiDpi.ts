import Phaser from 'phaser'

// Phaser 3.90 ties the drawing buffer size to the game size, so a HiDPI screen gets
// a CSS-sized canvas that the browser upsamples ( blurry ). The scene, the cameras
// and the pointer all stay in CSS pixels ; only the drawing buffer is made larger,
// and the few places where Phaser hands pixel values to WebGL are scaled to match.

type WebGLRenderer = Phaser.Renderer.WebGL.WebGLRenderer
type TransformMatrix = Phaser.GameObjects.Components.TransformMatrix

let pixelRatio = 1
let quadRoundingPatched = false

/** Drawing buffer pixels per CSS pixel. */
export function getPixelRatio() {
    return pixelRatio
}

// Camera.roundPixels snaps quads to whole CSS pixels, which are not whole device pixels
// when the ratio is fractional ( 1.5 ) : snap to the device grid instead.
function patchQuadRounding() {
    if (quadRoundingPatched) {
        return
    }
    quadRoundingPatched = true
    const prototype = Phaser.GameObjects.Components.TransformMatrix.prototype
    const setQuad = prototype.setQuad
    prototype.setQuad = function (
        this: TransformMatrix,
        x: number,
        y: number,
        xw: number,
        yh: number,
        roundPixels?: boolean,
        quad?: Float32Array,
    ) {
        if (!roundPixels || pixelRatio === 1) {
            return setQuad.call(this, x, y, xw, yh, roundPixels, quad)
        }
        const result = setQuad.call(this, x, y, xw, yh, false, quad)
        const dx = Math.floor(result[0] * pixelRatio + 0.5) / pixelRatio - result[0]
        const dy = Math.floor(result[1] * pixelRatio + 0.5) / pixelRatio - result[1]
        for (let i = 0; i < 8; i += 2) {
            result[i] += dx
            result[i + 1] += dy
        }
        return result
    }
}

type Box = [x: number, y: number, width: number, height: number]

// Phaser works in CSS pixels, so the viewport and scissor ( drawing buffer pixels ) it
// computes for the screen framebuffer are scaled here. Off-screen framebuffers have
// their own size and are left alone.
// Phaser often sets the viewport before ( or without ) updating its own idea of the current
// framebuffer, so the framebuffer really bound is tracked here, and the last viewport and
// scissor it asked for are applied again each time the binding changes.
function patchContext(renderer: WebGLRenderer) {
    const gl = renderer.gl
    const viewport = gl.viewport.bind(gl)
    const scissor = gl.scissor.bind(gl)
    const bindFramebuffer = gl.bindFramebuffer.bind(gl)
    let onScreen = true
    let viewportBox: Box | undefined
    let scissorBox: Box | undefined

    const apply = (set: (...box: Box) => void, box: Box | undefined) => {
        if (box) {
            const ratio = onScreen ? pixelRatio : 1
            set(
                Math.round(box[0] * ratio),
                Math.round(box[1] * ratio),
                Math.round(box[2] * ratio),
                Math.round(box[3] * ratio),
            )
        }
    }

    gl.viewport = (x, y, width, height) => {
        viewportBox = [x, y, width, height]
        apply(viewport, viewportBox)
    }
    gl.scissor = (x, y, width, height) => {
        scissorBox = [x, y, width, height]
        apply(scissor, scissorBox)
    }
    gl.bindFramebuffer = (target, framebuffer) => {
        bindFramebuffer(target, framebuffer)
        if (target === gl.FRAMEBUFFER) {
            onScreen = framebuffer === null
            apply(viewport, viewportBox)
            apply(scissor, scissorBox)
        }
    }

    // Phaser flips scissor Y coordinates against these
    Object.defineProperty(gl, 'drawingBufferWidth', {
        configurable: true,
        get: () => renderer.width,
    })
    Object.defineProperty(gl, 'drawingBufferHeight', {
        configurable: true,
        get: () => renderer.height,
    })
}

function applyPixelRatio(game: Phaser.Game, renderer: WebGLRenderer) {
    pixelRatio = Math.max(window.devicePixelRatio, 1)

    const { width, height } = game.scale.baseSize
    const { canvas } = game
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    canvas.width = Math.round(width * pixelRatio)
    canvas.height = Math.round(height * pixelRatio)

    // Resets the projection, viewport and scissor for the new buffer
    renderer.resize(width, height)

    // The Scale Manager measured the canvas before its CSS size was updated above, and
    // derives the pointer scale from that stale measure : redo it
    const { scale } = game
    scale.updateBounds()
    scale.displayScale.set(width / scale.canvasBounds.width, height / scale.canvasBounds.height)
}

// The ratio changes without any resize when the window is dragged to another screen
function watchPixelRatio(game: Phaser.Game, apply: () => void) {
    let query: MediaQueryList

    function listen() {
        query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
        query.addEventListener('change', onChange, { once: true })
    }

    function onChange() {
        apply()
        listen()
    }

    listen()
    game.events.once(Phaser.Core.Events.DESTROY, () => {
        query.removeEventListener('change', onChange)
        pixelRatio = 1
    })
}

function install(game: Phaser.Game) {
    const renderer = game.renderer
    if (!(renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) {
        return
    }
    const apply = () => applyPixelRatio(game, renderer)

    patchQuadRounding()
    patchContext(renderer)
    // Registered after the renderer's own listener, so it overrides the buffer size
    // the Scale Manager has just reset to the CSS one
    game.scale.on(Phaser.Scale.Events.RESIZE, apply)
    watchPixelRatio(game, apply)
    apply()
}

/** Render the game at the native resolution of HiDPI screens. */
export function setupHiDpi(game: Phaser.Game) {
    if (game.isBooted) {
        install(game)
    } else {
        game.events.once(Phaser.Core.Events.BOOT, () => install(game))
    }
}
