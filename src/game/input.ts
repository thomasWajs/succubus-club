import { useGameBusStore } from '@/store/bus.ts'
import Pointer = Phaser.Input.Pointer
import Phaser, { GameObjects } from 'phaser'
import { DRAG_DISTANCE_THRESHOLD } from '@/game/const.ts'
import { useCommands } from '@/game/composables/useCommands.ts'
import { display } from '@/game/display.ts'

/**
 * Pointer Inputs
 */

export function setupPointerHandlers(scene: Phaser.Scene) {
    scene.input.dragDistanceThreshold = DRAG_DISTANCE_THRESHOLD

    scene.input.on(Phaser.Input.Events.POINTER_DOWN, onPointerDown)
    scene.input.on(Phaser.Input.Events.POINTER_UP, onPointerUp)
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, onPointerMove)
}

function resetSelectionArea() {
    const gameBus = useGameBusStore()

    gameBus.selectionArea.show = false
    gameBus.selectionArea.startX = 0
    gameBus.selectionArea.startY = 0
    gameBus.selectionArea.endX = 0
    gameBus.selectionArea.endY = 0
}

function onPointerDown(pointer: Pointer, gameObjects: GameObjects.GameObject[]) {
    const gameBus = useGameBusStore()

    // Browsers won't blur inputs when the canvas is clicked.
    // Do it manually here.
    if (
        document.activeElement &&
        document.activeElement != document.body &&
        document.activeElement instanceof HTMLElement
    ) {
        document.activeElement.blur()
    }

    // CardGO handle clicks on themselves.
    // Here we handle click outside a CardGO
    if (gameObjects.length == 0 || gameObjects[0].type != 'Image') {
        // Clear card selection and context menu after a click outside a card
        gameBus.selectedCards = []
        gameBus.contextMenu.cards = []
        gameBus.hideContextMenu()

        // Start a selection area on left click
        if (pointer.leftButtonDown()) {
            resetSelectionArea()
            gameBus.selectionArea.show = true
            gameBus.selectionArea.startX = gameBus.selectionArea.endX = pointer.x / display.scale
            gameBus.selectionArea.startY = gameBus.selectionArea.endY = pointer.y / display.scale
        }
    }

    // Hide contextMenu when clicking outside of it
    if (!pointer.rightButtonDown()) {
        gameBus.hideContextMenu()
    }
}

function onPointerUp({}, {}) {
    const gameBus = useGameBusStore()

    // If we're currently making a selection area...
    if (gameBus.selectionArea.show) {
        // ...select all cards under the selection area
        gameBus.selectedCards = [
            ...gameBus.handleableCards.filter(s => s.isUnderSelectionArea()).map(s => s.card),
        ]
        // then reset it
        resetSelectionArea()
    }
}

function onPointerMove(pointer: Pointer, {}) {
    const gameBus = useGameBusStore()

    if (gameBus.selectionArea.show) {
        gameBus.selectionArea.endX = pointer.x / display.scale
        gameBus.selectionArea.endY = pointer.y / display.scale
    }
}

/**
 * Keyboard Inputs
 */

export function setupKeyboardHandlers(scene: Phaser.Scene) {
    if (!scene.input.keyboard) {
        return
    }

    const commands = useCommands()
    const gameBus = useGameBusStore()

    for (const command of Object.values(commands)) {
        for (const keyCode of command.keyCodes) {
            const key = scene.input.keyboard.addKey(keyCode, false)
            key.on('down', () => {
                // Don't trigger the command by key when wield card stack is open
                if (gameBus.wieldCardStack.show) {
                    return
                }

                if (!command.isDisabled()) {
                    command.trigger()
                }
            })
        }
    }
}
