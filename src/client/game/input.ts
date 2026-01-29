import { markRaw } from 'vue'
import { useGameBusStore } from '@/client/store/bus.ts'
import Phaser, { GameObjects } from 'phaser'
import { DRAG_DISTANCE_THRESHOLD } from '@/shared/const/game.ts'
import { useCommands } from '@/client/game/composables/useCommands.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { PhaserDataKey, RegionCategory } from '@/client/game/types.ts'
import { getCardDragged, getCardRegionDraggedOver, getWorldPoint } from '@/client/game/utils.ts'
import { resetDeclaration, validateTargetDeclaration } from '@/client/game/declaration.ts'
import Pointer = Phaser.Input.Pointer

/**
 * Pointer Inputs
 */

export function setupPointerHandlers(scene: Phaser.Scene) {
    scene.input.dragDistanceThreshold = DRAG_DISTANCE_THRESHOLD

    scene.input.on(Phaser.Input.Events.POINTER_DOWN, onPointerDown)
    scene.input.on(Phaser.Input.Events.POINTER_UP, onPointerUp)
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, onPointerMove)

    scene.input.on(Phaser.Input.Events.DRAG_START, onDragStart)
    scene.input.on(Phaser.Input.Events.DRAG_ENTER, onDragEnter)
    scene.input.on(Phaser.Input.Events.DRAG_LEAVE, onDragLeave)
    scene.input.on(Phaser.Input.Events.DRAG_END, onDragEnd)
}

function resetSelectionArea() {
    const gameBus = useGameBusStore()

    gameBus.selectionArea.show = false
    gameBus.selectionArea.origin = null
}

function onPointerDown(pointer: Pointer, gameObjects: GameObjects.GameObject[]) {
    const gameBus = useGameBusStore()
    const gameState = useGameStateStore()

    // Spectators can't interact with the game
    if (gameState.isSpectator) {
        return
    }

    // Browsers won't blur inputs when the canvas is clicked.
    // Do it manually here.
    if (
        document.activeElement &&
        document.activeElement != document.body &&
        document.activeElement instanceof HTMLElement
    ) {
        document.activeElement.blur()
    }

    // Hide contextMenu when clicking outside of it
    if (!pointer.rightButtonDown()) {
        gameBus.hideContextMenu()
    }

    const gameObject: GameObjects.GameObject | undefined = gameObjects[0]
    const type = gameObject?.type
    const name = gameObject?.name

    if (name == 'cardGroupIcon' || name == 'separator') {
        // nothing more to do, but prevent the default behavior of the click event.
        // This is more legible than a complex if condition
        return
    }

    // Here we handle other clicks outside a CardGO

    // Handle declaring player as a target
    if (
        gameBus.declaringTargetOrigin &&
        gameObjects.length == 1 &&
        type == 'Rectangle' &&
        pointer.leftButtonDown()
    ) {
        const player = gameObject?.parentContainer?.getData(PhaserDataKey.Player)
        if (player && player != gameState.selfPlayer) {
            validateTargetDeclaration(player)
        }
    } else if (gameObjects.length == 0 || type != 'Image') {
        // Here it's a click outside a card :
        // clear card selection, context menu, declaring target,
        gameBus.selectedCards = []
        gameBus.contextMenu.cards = []
        gameBus.hideContextMenu()
        gameBus.cardGroupCandidate = null
        gameBus.cardPendingIntoGroup = null
        resetDeclaration()

        // Start a selection area on left click
        if (pointer.leftButtonDown()) {
            gameBus.selectionArea.show = true
            // Expressed in world coordinates
            gameBus.selectionArea.origin = getWorldPoint(pointer.x, pointer.y)
        }
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
    // Expressed in world coordinates
    useGameBusStore().pointerPosition = getWorldPoint(pointer.x, pointer.y)
}

function onDragStart({}, cardImage: GameObjects.Image) {
    const card = getCardDragged(cardImage)
    if (!card) {
        return
    }

    const gameBus = useGameBusStore()
    gameBus.dragOver = {
        card,
        gameObjects: markRaw({
            cardImage,
        }),
    }
    gameBus.alignmentGuides = []
}

function onDragEnter({}, {}, target: GameObjects.GameObject) {
    const gameBus = useGameBusStore()
    if (gameBus.dragOver) {
        gameBus.dragOver.gameObjects.target = target
        gameBus.dragOver.cardRegion = getCardRegionDraggedOver(target) ?? undefined
        gameBus.dragOver.regionCategory =
            (target.getData(PhaserDataKey.RegionCategory) as RegionCategory) ?? undefined
    }
}

function onDragLeave() {
    const gameBus = useGameBusStore()
    if (gameBus.dragOver) {
        gameBus.dragOver.gameObjects.target = undefined
        gameBus.dragOver.cardRegion = undefined
    }
}

function onDragEnd() {
    const gameBus = useGameBusStore()
    gameBus.dragOver = null
    gameBus.alignmentGuides = []
}
/**
 * Keyboard Inputs
 */

export function setupKeyboardHandlers(scene: Phaser.Scene) {
    const gameState = useGameStateStore()
    const commands = useCommands()

    if (!scene.input.keyboard) {
        return
    }
    // Spectators can't interact with the game
    if (gameState.isSpectator) {
        return
    }

    // reset keys, so multiple calls can update the key bindings properly
    scene.input.keyboard.removeAllKeys()

    for (const command of Object.values(commands)) {
        for (const keyCode of command.keyCodes) {
            const key = scene.input.keyboard.addKey(keyCode, false)
            key.on('down', () => {
                if (!command.isDisabled()) {
                    command.trigger()
                }
            })
        }
    }
}
