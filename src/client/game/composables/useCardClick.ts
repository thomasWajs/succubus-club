/**
 * Select/Deselect on simple click
 * Lock on double click
 * Context Menu on right click
 */
import { Ref } from 'vue'
import Phaser from 'phaser'
import { useScene } from 'phavuer'
import { useGameBusStore } from '@/client/store/bus.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { positionContextMenu } from '@/client/game/utils.ts'
import { Card } from '@/shared/model/Card.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import {
    resetDeclaration,
    validateActionCardDeclaration,
    validateTargetDeclaration,
} from '@/client/game/declaration.ts'
import { GameType } from '@/shared/types/state.ts'
import {
    cancelStaging,
    engineCardClick,
    engineClaims,
    staging,
} from '@/client/engine/interaction.ts'
import Pointer = Phaser.Input.Pointer

const DOUBLE_CLICK_DELAY = 300
// A press released farther than this ( in pixels ) is a drag, not a click
const CLICK_SLOP = 6
let lastClickTime = 0

export function useCardClick(cardRef: Ref<Card>, invertLockOnDoubleClick: boolean) {
    const scene = useScene()
    const gameBus = useGameBusStore()
    const gameState = useGameStateStore()

    function onLeftClick(pointer: Pointer) {
        const card = cardRef.value

        gameBus.setCloseUpCard(card, { pinned: true })

        // if the card is not already selected...
        if (!gameBus.isCardSelected(card)) {
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
        if (!gameBus.isCardSelected(card)) {
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

        // A game with the rules engine : a click is read as a choice ( see engine/interaction.ts ),
        // once released without a drag ; a right click cancels the choice under way
        if (gameState.gameType == GameType.Engine && card) {
            if (pointer.rightButtonDown() && staging.value) {
                cancelStaging()
                return
            }
            if (pointer.leftButtonDown()) {
                scene.input.once('pointerup', (up: Pointer) => {
                    if (up.getDistance() < CLICK_SLOP) {
                        engineCardClick(card)
                    }
                })
                // A card the engine's choice is about : no selection, and no double click ( a lock,
                // itself read as a decision )
                if (engineClaims(card)) {
                    gameBus.setCloseUpCard(card, { pinned: true })
                    return
                }
            }
        }

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
