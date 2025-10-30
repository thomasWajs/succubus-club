import { useGameBusStore } from '@/store/bus.ts'
import Pointer = Phaser.Input.Pointer
import Phaser, { GameObjects } from 'phaser'
import { DRAG_DISTANCE_THRESHOLD } from '@/game/const.ts'
import { useCommands } from '@/game/composables/useCommands.ts'
import { display } from '@/game/display.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { gameMutations } from '@/state/gameMutations.ts'
import { PhaserDataKey } from '@/game/types.ts'

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
    gameBus.selectionArea.origin = null
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

    // Handle declaring player as a target
    if (
        gameBus.declaringTargetOrigin &&
        gameObjects.length == 1 &&
        gameObjects[0].type == 'Rectangle' &&
        gameObjects[0].name != 'cardButton' &&
        pointer.leftButtonDown()
    ) {
        const gameObject = gameObjects[0]
        const player = gameObject?.parentContainer?.getData(PhaserDataKey.Player)
        if (player) {
            gameMutations.UI_arrowAdd.actSelf({
                origin: gameBus.declaringTargetOrigin,
                target: player,
            })
            gameBus.declaringTargetOrigin = null
        }
    }

    // Here we handle other clicks outside a CardGO
    else if (gameObjects.length == 0 || gameObjects[0].type != 'Image') {
        // Here it's a click outside a card :
        // clear card selection, context menu, declaring target,
        gameBus.selectedCards = []
        gameBus.declaringTargetOrigin = null
        gameBus.contextMenu.cards = []
        gameBus.hideContextMenu()

        // Start a selection area on left click
        if (pointer.leftButtonDown()) {
            gameBus.selectionArea.show = true
            gameBus.selectionArea.origin = {
                x: pointer.x / display.scale,
                y: pointer.y / display.scale,
            }
        }
    }

    // Hide contextMenu when clicking outside of it
    if (!pointer.rightButtonDown()) {
        gameBus.hideContextMenu()
    }
}

function onPointerUp({}, {}) {
    const gameBus = useGameBusStore()
    const gameState = useGameStateStore()

    // If we're currently making a selection area...
    if (gameBus.selectionArea.show) {
        // ...select all cards under the selection area
        gameBus.selectedCards = Object.values(gameBus.cardsInGame)
            .filter(hc => hc.isUnderSelectionArea())
            .map(hc => gameState.cards[hc.cardOid])
        // then reset it
        resetSelectionArea()
    }
}

function onPointerMove(pointer: Pointer, {}) {
    useGameBusStore().pointerPosition = {
        x: pointer.x / display.scale,
        y: pointer.y / display.scale,
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
