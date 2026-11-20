import Phaser from 'phaser'

// Phaser's own default font : the texts which keep it get the UI font
const PHASER_DEFAULT_FONT_FAMILY = 'Courier'
// Not the HTML font ( $ui-font ) : the canvas draws texts with grayscale antialiasing, and the
// player area texts are scaled down ( ~9 px labels ). Verdana, designed for small sizes on screen,
// stays crisp there where Source Sans 3 smears. A system font : nothing to load.
const UI_FONT_FAMILY = 'Verdana, Tahoma, sans-serif'

function onAddedToScene(gameObject: Phaser.GameObjects.GameObject) {
    // A text choosing its own font keeps it
    if (
        gameObject instanceof Phaser.GameObjects.Text &&
        gameObject.style.fontFamily === PHASER_DEFAULT_FONT_FAMILY
    ) {
        gameObject.setFontFamily(UI_FONT_FAMILY)
    }
}

/** Give the scene's texts the UI font. */
export function setupTextFont(scene: Phaser.Scene) {
    scene.sys.events.on(Phaser.Scenes.Events.ADDED_TO_SCENE, onAddedToScene)
    scene.sys.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
        scene.sys.events.off(Phaser.Scenes.Events.ADDED_TO_SCENE, onAddedToScene),
    )
}
