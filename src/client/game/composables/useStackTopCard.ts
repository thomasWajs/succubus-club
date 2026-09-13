import { computed, reactive } from 'vue'
import Phaser, { GameObjects } from 'phaser'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { GameType } from '@/shared/types/state.ts'
import { positionContextMenu } from '@/client/game/utils.ts'
import { AnyCardRegion } from '@/shared/types/model.ts'
import { Card } from '@/shared/model/Card.ts'
import Pointer = Phaser.Input.Pointer

export type StackDraw = 'crypt' | 'library'

/**
 * Top-card interactions shared by the tabletop stacks ( RegionCardStackGO )
 * and the Free Table player-widget stacks ( StackWidget ) :
 *   - left-click a library / crypt draws its top card
 *   - right-click opens the card context menu
 *   - hovering the ash heap closes up its top card
 *
 * The only gameplay difference is which crypt-draw mutation runs : structured
 * mode uses `drawCrypt`, Free Table uses `FT_drawCrypt`.
 */
export function useStackTopCard(options: {
    cardRegion: () => AnyCardRegion
    topCard: () => Card | null
    draw?: () => StackDraw | undefined
    freeTable?: boolean
}) {
    const gameState = useGameStateStore()
    const players = usePlayersStore()
    const gameBus = useGameBusStore()

    // Normally, players can only draw from their own stacks.
    // But in Puppeteer mode, the user can make anyone draw
    const canDraw = computed(() => {
        const cardRegion = options.cardRegion()
        return (
            !!options.draw?.() &&
            (cardRegion.owner == players.selfPlayer || gameState.gameType === GameType.Puppeteer)
        )
    })

    /**
     * Outline stack + tooltip on pointer over
     */

    const drawHoverAttrs = reactive({
        isHovered: false,
        x: 0,
        y: 0,
    })

    function onPointerMove(pointer: Pointer) {
        // While a card is being dragged over the stack, only the stack
        // boundaries should highlight ( the drop zone ), not the top card.
        if (canDraw.value && !gameBus.dragOver) {
            drawHoverAttrs.isHovered = true
            drawHoverAttrs.x = pointer.x
            drawHoverAttrs.y = pointer.y
        } else {
            drawHoverAttrs.isHovered = false
        }
    }

    function onPointerOver() {
        closeUpAshHeap()
    }

    function onPointerOut() {
        drawHoverAttrs.isHovered = false
        gameBus.assignPinnedCloseUpCard()
    }

    function onCreate(image: GameObjects.Image) {
        if (canDraw.value) {
            image.setInteractive({ draggable: false, cursor: 'pointer' })
        }
    }

    /**
     * Draw card on left-click, context menu on right-click
     */

    function onPointerDown(pointer: Pointer) {
        const cardRegion = options.cardRegion()
        const stackOwner = cardRegion.owner
        const topCard = options.topCard()
        if (!canDraw.value || !stackOwner || !topCard) {
            return
        }

        if (pointer.leftButtonDown()) {
            if (options.draw?.() == 'library') {
                gameMutations.drawLibrary.actSelf({ player: stackOwner })
            } else if (options.draw?.() == 'crypt') {
                if (options.freeTable) {
                    gameMutations.FT_drawCrypt.actSelf({ player: stackOwner })
                } else {
                    gameMutations.drawCrypt.actSelf({ player: stackOwner })
                }
            }
        } else if (pointer.rightButtonDown()) {
            gameBus.selectedCards = [topCard]
            gameBus.contextMenu.cards = [topCard]
            gameBus.contextMenu.show = true
            gameBus.contextMenu.fromStackRegion = true
            const setXY = (x: number, y: number) => {
                gameBus.contextMenu.x = x
                gameBus.contextMenu.y = y
            }
            positionContextMenu(pointer.x, pointer.y, pointer.y, '.context-menu', setXY)
        }
    }

    /**
     * Closeup for stacks
     */

    function closeUpAshHeap() {
        const cardRegion = options.cardRegion()
        // Close up top card of the ash heap
        if (cardRegion.is.ashHeap && cardRegion.length > 0 && !gameBus.dragOver) {
            gameBus.setCloseUpCard(cardRegion.firstCard)
        }
    }

    return {
        canDraw,
        drawHoverAttrs,
        onPointerMove,
        onPointerOver,
        onPointerOut,
        onCreate,
        onPointerDown,
        closeUpAshHeap,
    }
}
