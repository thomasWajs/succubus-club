/**
 * Select/Deselect on simple click
 * Lock on double click
 * Context Menu on right click
 */
import { Ref } from 'vue'
import Phaser from 'phaser'
import { useScene } from 'phavuer'
import { useGameBusStore } from '@/store/bus.ts'
import { gameMutations } from '@/state/gameMutations.ts'
import { positionContextMenu } from '@/game/utils.ts'
import { Card } from '@/model/Card.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import {
    resetDeclaration,
    validateActionCardDeclaration,
    validateTargetDeclaration,
} from '@/game/declaration.ts'
import Pointer = Phaser.Input.Pointer

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

        const card = cardRef.value

        // Special case for target declaration :
        // left click will validate the target,
        // right click will abort declaration
        if (gameBus.declaringTargetOrigin && card && card.isIn.play) {
            if (pointer.leftButtonDown()) {
                validateTargetDeclaration(card)
            } else {
                resetDeclaration()
            }
            return
        }

        // Special case for action declaration :
        // left click will validate the action card,
        // right click will abort declaration
        if (gameBus.actionDeclaration.type && card) {
            if (pointer.leftButtonDown()) {
                validateActionCardDeclaration(card)
            } else {
                resetDeclaration()
            }
            return
        }

        // Standard case
        if (pointer.leftButtonDown()) {
            onLeftClick(pointer)
        } else if (pointer.rightButtonDown()) {
            onRightClick(pointer)
        }
    }

    return { onPointerDown }
}
