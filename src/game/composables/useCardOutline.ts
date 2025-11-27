import { computed, Ref, ref } from 'vue'
import Phaser, { GameObjects } from 'phaser'
import RectangleToRectangle = Phaser.Geom.Intersects.RectangleToRectangle
import { useGameBusStore } from '@/store/bus.ts'
import {
    CARD_GROUP_OUTLINE_COLOR,
    CARD_OUTLINE_COLOR_HOVER,
    CARD_OUTLINE_COLOR_INDIRECT_HOVER,
    CARD_OUTLINE_COLOR_SELECTED,
} from '@/game/const.ts'
import { Card } from '@/model/Card.ts'
import { useScene } from 'phavuer'

export function useCardOutline(
    cardRef: Ref<Card>,
    image: Ref<GameObjects.Image | undefined>,
    withSelectionArea: boolean,
) {
    const scene = useScene()
    const gameBus = useGameBusStore()

    const isHovered = ref(false)

    const isUnderSelectionArea = () => {
        if (!withSelectionArea || !image.value || !gameBus.selectionAreaRect) {
            return false
        }

        return RectangleToRectangle(gameBus.selectionAreaRect, image.value.getBounds())
    }

    function onPointerOver() {
        isHovered.value = true
        gameBus.hoveredCard = cardRef.value
        gameBus.setCloseUpCard(cardRef.value)
    }

    function onPointerOut() {
        isHovered.value = false
        gameBus.hoveredCard = null
    }

    // Remove outline when the pointer is on an HTML overlay
    scene.input.on('gameout', () => {
        isHovered.value = false
        gameBus.hoveredCard = null
    })

    const isInCardGroupCandidate = computed(() => {
        return gameBus.cardGroupCandidate && gameBus.cardGroupCandidate.has(cardRef.value.oid)
    })
    const isIndirectHovered = computed(() => {
        return gameBus.indirectHoveredCards.includes(cardRef.value.oid)
    })

    const getCardOutlineColor = computed(() => {
        const card = cardRef.value
        if (isInCardGroupCandidate.value) {
            return CARD_GROUP_OUTLINE_COLOR.color
        } else if (isHovered.value || isUnderSelectionArea()) {
            return CARD_OUTLINE_COLOR_HOVER.color
        } else if (isIndirectHovered.value) {
            return CARD_OUTLINE_COLOR_INDIRECT_HOVER.color
        } else if (card.isSelected()) {
            return CARD_OUTLINE_COLOR_SELECTED.color
        }
        return undefined
    })

    return {
        isHovered,
        isUnderSelectionArea,
        onPointerOver,
        onPointerOut,
        getCardOutlineColor,
    }
}
