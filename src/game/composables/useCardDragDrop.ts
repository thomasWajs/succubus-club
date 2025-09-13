import { Card } from '@/model/Card.ts'
import { ComputedRef, reactive, ref, Ref } from 'vue'
import Phaser, { GameObjects } from 'phaser'
import Pointer = Phaser.Input.Pointer
import { PhaserDataKey } from '@/game/types.ts'
import { AnyCardRegion } from '@/model/CardRegion.ts'
import { CardMovement, gameMutations } from '@/state/gameMutations.ts'
import { useGameBusStore } from '@/store/bus.ts'
import { dropCoordinatesSnapped } from '@/game/utils.ts'

export function useCardDragDrop(
    card: Card,
    cardAttrs: ComputedRef<{ x: number; y: number }>,
    image: Ref<GameObjects.Image | undefined>,
    cardOutline: Ref<GameObjects.Rectangle | undefined>,
) {
    const gameBus = useGameBusStore()

    /**
     * Dragging
     */

    // Track if we're currently dragging this card
    const isDragging = ref(false)
    const dragPosition = reactive({ x: 0, y: 0 })

    function onDragStart() {
        if (!image.value) {
            return
        }

        isDragging.value = true

        dragPosition.x = cardAttrs.value.x
        dragPosition.y = cardAttrs.value.y

        const container = image.value.parentContainer
        container.bringToTop(image.value)
        if (cardOutline.value) {
            container.bringToTop(cardOutline.value)
        }
    }

    function onDrag({}, dragX: number, dragY: number) {
        dragPosition.x = dragX
        dragPosition.y = dragY
    }

    function onDragEnd() {
        isDragging.value = false
    }

    /**
     * Drop on new position
     */

    function onDrop(pointer: Pointer, droppedOn: GameObjects.Rectangle) {
        const targetCardRegion = droppedOn.getData(PhaserDataKey.CardRegion) as AnyCardRegion

        // Not dropped on any region, abort
        if (!targetCardRegion) {
            return
        }

        const fromContainer = image.value?.parentContainer
        const toContainer = droppedOn.parentContainer
        // Compute new card position in the target container referential
        const coord = dropCoordinatesSnapped(pointer, toContainer)

        const movement: CardMovement = {
            card,
            x: coord.x,
            y: coord.y,
            position: gameBus.handDropGapPosition ?? 0,
        }

        if (toContainer == fromContainer) {
            gameMutations.moveCard.actSelf(movement)
        } else {
            gameMutations.moveCardToRegion.actSelf({
                fromCardRegion: card.region,
                toCardRegion: targetCardRegion,
                ...movement,
            })
        }
    }

    return { isDragging, dragPosition, onDragStart, onDrag, onDragEnd, onDrop }
}
