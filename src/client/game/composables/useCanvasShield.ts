import { onBeforeUnmount, onMounted } from 'vue'

/**
 * Keeps the mouse presses made on an HTML overlay away from Phaser.
 *
 * Phaser listens for the mouse on the window too, and hit-tests the pointer on
 * every press and release : an overlay sitting above the table would otherwise
 * select the card under a click on it, or light up its hover outline.
 *
 * The press is always stopped. The release is only stopped when its press
 * started on the overlay : a drag started on the table and released above the
 * overlay must still reach Phaser, or it would never end.
 *
 * Bind `onMouseDown` and `onMouseUp` on the root element of the overlay.
 */
export function useCanvasShield() {
    let pressedOnOverlay = false

    function onMouseDown(event: MouseEvent) {
        pressedOnOverlay = true
        event.stopPropagation()
    }

    function onMouseUp(event: MouseEvent) {
        if (pressedOnOverlay) {
            pressedOnOverlay = false
            event.stopPropagation()
        }
    }

    // A press on the overlay released elsewhere never reaches onMouseUp : the
    // window sees that release instead, which forgets the press
    function forgetPress() {
        pressedOnOverlay = false
    }

    onMounted(() => window.addEventListener('mouseup', forgetPress))
    onBeforeUnmount(() => window.removeEventListener('mouseup', forgetPress))

    return { onMouseDown, onMouseUp }
}
