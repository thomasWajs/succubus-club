import { reactive, ref } from 'vue'
import Phaser, { GameObjects } from 'phaser'
import { Point2D } from '@/shared/types/model.ts'

/**
 * Drag to reposition a Free Table widget ( PlayerWidget, TheEdgeWidget ).
 * Shared by both : same reactive drag position, same guarded interactive
 * setup, same drag-start/drag/drag-end wiring - only who's allowed to drag,
 * where the widget currently sits, and what happens once it's dropped differ.
 */
export function useWidgetDrag(options: {
    canDrag: boolean
    getPosition: () => Point2D
    onMoved: (position: Point2D) => void
    width: number
    height: number
}) {
    const isDragging = ref(false)
    const dragPos = reactive({ x: 0, y: 0 })

    // Only bind drag listeners when the local player can actually drag :
    // Phavuer auto-detects drag events from the template and, on any
    // GameObject that has them, falls back to a bare `setInteractive()` if
    // `onCreate` hasn't already made one interactive. That bare call never
    // creates Phaser's input component on a Container ( no default hit area ),
    // so `scene.input.setDraggable` then throws on a widget the local player
    // can't drag. Omitting the listeners entirely keeps Phavuer from touching
    // it.
    const dragHandlers =
        options.canDrag ? { onDragstart: onDragStart, onDrag, onDragend: onDragEnd } : {}

    function onCreate(gameObject: GameObjects.GameObject) {
        if (!options.canDrag) {
            return
        }
        gameObject.setInteractive({
            hitArea: new Phaser.Geom.Rectangle(
                -options.width / 2,
                -options.height / 2,
                options.width,
                options.height,
            ),
            hitAreaCallback: Phaser.Geom.Rectangle.Contains,
            draggable: true,
            cursor: 'move',
        })
    }

    function onDragStart() {
        isDragging.value = true
        const position = options.getPosition()
        dragPos.x = position.x
        dragPos.y = position.y
    }

    function onDrag({}, dragX: number, dragY: number) {
        dragPos.x = dragX
        dragPos.y = dragY
    }

    function onDragEnd() {
        isDragging.value = false
        options.onMoved({ x: dragPos.x, y: dragPos.y })
    }

    return { isDragging, dragPos, dragHandlers, onCreate }
}
