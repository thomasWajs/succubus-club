import { computed, Ref, ref } from 'vue'
import Phaser, { GameObjects } from 'phaser'
import RectangleToRectangle = Phaser.Geom.Intersects.RectangleToRectangle
import { useGameBusStore } from '@/store/bus.ts'
import { CARD_OUTLINE_COLOR_HOVER, CARD_OUTLINE_COLOR_SELECTED } from '@/game/const.ts'
import { Card } from '@/model/Card.ts'
import { useScene } from 'phavuer'

export function useCardOutline(
    card: Card,
    image: Ref<GameObjects.Image | undefined>,
    withSelectionArea: boolean,
) {
    const scene = useScene()
    const gameBus = useGameBusStore()

    const isHovered = ref(false)

    const isUnderSelectionArea = () => {
        if (!withSelectionArea) {
            return false
        }
        if (!image.value || !gameBus.selectionArea.show) {
            return false
        }

        return RectangleToRectangle(gameBus.selectionAreaRect, image.value.getBounds())
    }

    function onPointerOver() {
        isHovered.value = true
        gameBus.setCloseUpCard(card)
    }

    function onPointerOut() {
        isHovered.value = false
    }

    // Remove outline when the pointer is on an HTML overlay
    scene.input.on('gameout', () => {
        isHovered.value = false
    })

    const getCardOutlineColor = computed(() => {
        if (isHovered.value || isUnderSelectionArea()) {
            return CARD_OUTLINE_COLOR_HOVER.color
        } else {
            return card.isSelected() ? CARD_OUTLINE_COLOR_SELECTED.color : undefined
        }
    })

    return { isUnderSelectionArea, onPointerOver, onPointerOut, getCardOutlineColor }
}
