import { markRaw } from 'vue'
import { useGameBusStore } from '@/client/store/bus.ts'
import Phaser, { GameObjects } from 'phaser'
import { DRAG_DISTANCE_THRESHOLD } from '@/shared/const/game.ts'
import { useCommands } from '@/client/game/composables/useCommands.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { usePlayersStore } from '@/client/state/players.ts'
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
    gameBus.selectionArea.originScreen = null
    gameBus.selectionArea.currentScreen = null
}

function onPointerDown(pointer: Pointer, gameObjects: GameObjects.GameObject[]) {
    const gameBus = useGameBusStore()
    const players = usePlayersStore()

    // Spectators can't interact with the game
    if (players.isSpectator) {
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

    if (
        name == 'cardGroupIcon' ||
        name == 'separator' ||
        name == 'playButton' ||
        name == 'playerWidget'
    ) {
        // nothing more to do, but prevent the default behavior of the click event.
        // This is more legible than a complex if condition
        return
    }

    // Here we handle other clicks outside a CardGO

    // Handle declaring player as a target : the hit shape is a Rectangle in
    // structured mode ( the play-area outline ) and a circle ( Phaser type
    // 'Arc' ) in free table mode ( the player widget ), see PlayerWidget.vue.
    if (
        gameBus.declaringTargetOrigin &&
        gameObjects.length == 1 &&
        (type == 'Rectangle' || type == 'Arc') &&
        pointer.leftButtonDown()
    ) {
        const player = gameObject?.parentContainer?.getData(PhaserDataKey.Player)
        if (player && player != players.selfPlayer) {
            validateTargetDeclaration(player)
        }
    } else if (gameObjects.length == 0 || type != 'Image') {
        // Here it's a click outside a card :
        // clear card selection, context menu, declaring target,
        gameBus.selectedCards = []
        gameBus.contextMenu.cards = []
        gameBus.contextMenu.fromStackRegion = false
        gameBus.hideContextMenu()
        gameBus.cardGroupCandidate = null
        gameBus.cardPendingIntoGroup = null
        resetDeclaration()

        // Start a selection area on left click - not while shift is held,
        // which instead rotates the Free Table camera ( see camera.ts ).
        if (pointer.leftButtonDown() && !pointer.event.shiftKey) {
            gameBus.selectionArea.show = true
            // Expressed in world coordinates
            gameBus.selectionArea.origin = getWorldPoint(pointer.x, pointer.y)
            // Expressed in screen coordinates, see selectionArea.originScreen
            gameBus.selectionArea.originScreen = { x: pointer.x, y: pointer.y }
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
    const gameBus = useGameBusStore()

    // Expressed in world coordinates
    gameBus.pointerPosition = getWorldPoint(pointer.x, pointer.y)

    if (gameBus.selectionArea.show) {
        // Expressed in screen coordinates, see selectionArea.originScreen
        gameBus.selectionArea.currentScreen = { x: pointer.x, y: pointer.y }
    }
}

/**
 * Free Table drop-zone detection across cameras.
 *
 * Phaser's hitTestPointer() ( InputPlugin ) walks the cameras top-most first
 * and returns on the first camera with any hit, collecting drop zones only up
 * to that camera. In Free Table the Hand and the stack browser render through
 * the pinned UI camera ( on top ), while the table's drop zone renders through
 * the main camera ( below ). A card dragged out of the Hand keeps its image
 * under the pointer on the UI camera, so hitTestPointer stops there and never
 * reaches the main camera : the table drop zone is never seen, no DRAG_ENTER
 * fires for it, and the drop is reported as "not on a zone".
 *
 * Fix : while such a card is being dragged, make its image transparent to hit
 * testing ( it stays fully rendered and input-enabled, so DRAG_END still fires
 * ) by swapping its hit-area test to always-miss. The UI camera then finds
 * nothing under the pointer over the table and the walk falls through to the
 * main camera, exposing the table drop zone. Restored on drag end.
 */
const alwaysMissHitArea: Phaser.Types.Input.HitAreaCallback = () => false
let hitTestExcludedImage: GameObjects.Image | null = null
let savedHitAreaCallback: Phaser.Types.Input.HitAreaCallback | null = null

// True when the image is rendered exclusively by the pinned UI camera, i.e.
// one of its ancestors is excluded from the main camera ( see FreeTable.vue,
// which sets pinnedContainer.cameraFilter |= main.id ).
function isPinnedToUICamera(cardImage: GameObjects.Image): boolean {
    if (!useGameStateStore().isFreeTable) {
        return false
    }
    const mainCameraId = cardImage.scene.cameras.main.id
    let node: GameObjects.GameObject | null = cardImage
    while (node) {
        if (node.cameraFilter && (node.cameraFilter & mainCameraId) !== 0) {
            return true
        }
        node = node.parentContainer
    }
    return false
}

function excludeDraggedImageFromHitTest(cardImage: GameObjects.Image) {
    if (!cardImage.input || !isPinnedToUICamera(cardImage)) {
        return
    }
    hitTestExcludedImage = cardImage
    savedHitAreaCallback = cardImage.input.hitAreaCallback
    cardImage.input.hitAreaCallback = alwaysMissHitArea
}

function restoreDraggedImageHitTest() {
    if (hitTestExcludedImage?.input && savedHitAreaCallback) {
        hitTestExcludedImage.input.hitAreaCallback = savedHitAreaCallback
    }
    hitTestExcludedImage = null
    savedHitAreaCallback = null
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

    excludeDraggedImageFromHitTest(cardImage)
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
    restoreDraggedImageHitTest()

    const gameBus = useGameBusStore()
    gameBus.dragOver = null
    gameBus.alignmentGuides = []
}
/**
 * Keyboard Inputs
 */

export function setupKeyboardHandlers(scene: Phaser.Scene) {
    const players = usePlayersStore()
    const commands = useCommands()

    if (!scene.input.keyboard) {
        return
    }
    // Spectators can't interact with the game
    if (players.isSpectator) {
        return
    }

    // reset keys, so multiple calls can update the key bindings properly
    scene.input.keyboard.removeAllKeys()

    for (const command of Object.values(commands)) {
        for (const keyCode of command.keyCodes) {
            const key = scene.input.keyboard.addKey(keyCode, true)
            key.on('down', () => {
                if (!command.isDisabled()) {
                    command.onKeyDown()
                }
            })

            if (command.onKeyUp) {
                key.on('up', () => {
                    if (!command.isDisabled()) {
                        command.onKeyUp?.()
                    }
                })
            }
        }
    }
}
