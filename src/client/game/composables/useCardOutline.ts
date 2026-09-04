import { computed, Ref, ref } from 'vue'
import Phaser, { GameObjects } from 'phaser'
import { useGameBusStore } from '@/client/store/bus.ts'
import { Colors } from '@/client/colors.ts'
import { Card } from '@/shared/model/Card.ts'
import { useScene } from 'phavuer'
import RectangleToRectangle = Phaser.Geom.Intersects.RectangleToRectangle

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
        gameBus.assignPinnedCloseUpCard()
    }

    // Remove outline when the pointer is on an HTML overlay
    scene.input.on('gameout', () => {
        isHovered.value = false
        gameBus.hoveredCard = null
    })

    const isInCardGroupCandidate = computed(() => {
        return gameBus.cardGroupCandidate && gameBus.cardGroupCandidate.has(cardRef.value.oid)
    })
    const isActingMinionCandidate = computed(() => {
        return gameBus.actingMinionCandidate?.oid == cardRef.value.oid
    })
    const isIndirectHovered = computed(() => {
        return gameBus.indirectHoveredCards.includes(cardRef.value.oid)
    })

    const getCardOutlineColor = computed(() => {
        const card = cardRef.value
        if (isActingMinionCandidate.value) {
            return Colors.ACTION_DECLARATION_OUTLINE.color
        } else if (isInCardGroupCandidate.value) {
            return Colors.CARD_GROUP_OUTLINE.color
        } else if (isHovered.value || isUnderSelectionArea()) {
            return Colors.CARD_OUTLINE_HOVER.color
        } else if (isIndirectHovered.value) {
            return Colors.CARD_OUTLINE_INDIRECT_HOVER.color
        } else if (gameBus.isCardSelected(card)) {
            return Colors.CARD_OUTLINE_SELECTED.color
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
