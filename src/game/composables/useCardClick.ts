/**
 * Select/Deselect on simple click
 * Lock on double click
 * Context Menu on right click
 */
import { Ref } from 'vue'
import Phaser from 'phaser'
import Pointer = Phaser.Input.Pointer
import { useScene } from 'phavuer'
import { useGameBusStore } from '@/store/bus.ts'
import { gameMutations } from '@/state/gameMutations.ts'
import { positionContextMenu } from '@/game/utils.ts'
import { Card } from '@/model/Card.ts'
import { useGameStateStore } from '@/store/gameState.ts'

const DOUBLE_CLICK_DELAY = 300
let lastClickTime = 0

export function useCardClick(cardRef: Ref<Card>, invertLockOnDoubleClick: boolean) {
    const scene = useScene()
    const gameBus = useGameBusStore()
    const gameState = useGameStateStore()

    function onLeftClick(pointer: Pointer) {
        const card = cardRef.value

        // if the card is not already selected...
        if (!card.isSelected()) {
            // ctrl + click or shift + click ==> multiple selection
            if (pointer.event.ctrlKey || pointer.event.shiftKey) {
                gameBus.selectedCards.push(card)
            }
            // No modifier key ==> single selection
            else {
                gameBus.selectedCards = [card]
            }
        }

        if (invertLockOnDoubleClick) {
            const clickDelay = scene.time.now - lastClickTime
            lastClickTime = scene.time.now
            if (clickDelay < DOUBLE_CLICK_DELAY) {
                for (const cardInGame of gameBus.selectedCardsInGame) {
                    const card = gameState.cards[cardInGame.cardOid]
                    gameMutations.setLock.actSelf({
                        card,
                        newValue: !card.isLocked,
                    })
                }
            }
        }
    }

    function onRightClick(pointer: Pointer) {
        const card = cardRef.value

        // If this card is not already selected, the context menu apply only to this card
        if (!card.isSelected()) {
            gameBus.selectedCards = [card]
        }
        // else, the context menu apply to all the selection, including this card

        // In both cases, set the context menu cards
        gameBus.contextMenu.cards = [...gameBus.selectedCards]

        gameBus.contextMenu.show = true
        const setXY = (x: number, y: number) => {
            gameBus.contextMenu.x = x
            gameBus.contextMenu.y = y
        }
        // If there's enough space, raise the menu by 20px
        positionContextMenu(pointer.x, pointer.y - 20, pointer.y, '.context-menu', setXY)
    }

    function onPointerDown(pointer: Pointer) {
        // Prevent click handling when the pointer is on an HTML overlay
        if (!scene.input.isOver) {
            return
        }

        // Special case for arrow tracing : both click will end the tracing
        if (gameBus.declaringTargetOrigin) {
            gameMutations.UI_arrowAdd.actSelf({
                origin: gameBus.declaringTargetOrigin,
                target: cardRef.value,
            })
            gameBus.declaringTargetOrigin = null
            return
        }

        if (pointer.leftButtonDown()) {
            onLeftClick(pointer)
        } else if (pointer.rightButtonDown()) {
            onRightClick(pointer)
        }
    }

    return { onPointerDown }
}
