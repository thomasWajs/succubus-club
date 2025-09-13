import { Raw, Component } from 'vue'
import { acceptHMRUpdate, defineStore } from 'pinia'
import { Card } from '@/model/Card.ts'
import Phaser, { GameObjects } from 'phaser'
import { Player } from '@/model/Player.ts'
import { AnyCardRegion } from '@/model/CardRegion.ts'
import { useCoreStore } from '@/store/core.ts'
import { SavingState } from '@/gateway/savedGames.ts'
import Rectangle = Phaser.Geom.Rectangle
import Pointer = Phaser.Input.Pointer

type CleanupCallback = () => void

export enum AlertState {
    Error = 'error',
    Warning = 'warning',
    Success = 'success',
}

export interface AlertMessage {
    message: string
    type: AlertState
    dismissible: boolean
    blockInteraction: boolean
}

export interface CardDragEvent {
    originCard: Card
    pointer: Pointer
    dragX?: number
    dragY?: number
    droppedOn?: GameObjects.GameObject
}

export interface HandleableCard {
    card: Card
    isUnderSelectionArea: () => boolean
    onDragStart: (event: CardDragEvent) => void
    onDrag: (event: CardDragEvent) => void
    onDragEnd: (event: CardDragEvent) => void
    onDrop: (event: CardDragEvent) => void
}

export const useBusStore = defineStore('bus', {
    state: () => ({
        cleanupCallbacks: [] as CleanupCallback[],

        alert: null as AlertMessage | null,
        isUserProfilePanelOpen: false,
        isDeckPanelOpen: false,
        isSavedGamesPanelOpen: false,

        isResyncing: false,
    }),
    actions: {
        onDestroyGame(cleanupCallback: CleanupCallback) {
            this.cleanupCallbacks.push(cleanupCallback)
        },
        alertError(message: string, { dismissible = true, blockInteraction = false } = {}) {
            this.alert = {
                message,
                type: AlertState.Error,
                dismissible,
                blockInteraction,
            }
        },
        alertWarning(message: string, { dismissible = true, blockInteraction = false } = {}) {
            this.alert = {
                message,
                type: AlertState.Warning,
                dismissible,
                blockInteraction,
            }
        },
        alertSuccess(message: string, { dismissible = true, blockInteraction = false } = {}) {
            this.alert = {
                message,
                type: AlertState.Success,
                dismissible,
                blockInteraction,
            }
        },
        dismissAlert() {
            this.alert = null
        },
    },
})

export const useGameBusStore = defineStore('gameBus', {
    state: () => ({
        closeUpCard: {
            card: null as Card | null,
            canView: false,
        },

        selectedCards: [] as Card[],
        selectionArea: {
            show: false,
            startX: 0,
            startY: 0,
            endX: 0,
            endY: 0,
        },
        handleableCards: [] as HandleableCard[],

        handDropGapPosition: null as null | number,

        contextMenu: {
            show: false,
            cards: [] as Card[],
            x: 0,
            y: 0,
            submenu: {
                show: false,
                component: null as Raw<Component> | null,
                x: 0,
                y: 0,
            },
        },
        changePool: {
            show: false,
            player: null as Player | null,
        },
        changeTheEdge: {
            show: false,
        },
        wieldCardStack: {
            show: false,

            cardRegion: null as AnyCardRegion | null,
            searchString: '',
        },

        savingState: SavingState.None,
    }),

    getters: {
        closeUpCardImage(state) {
            const core = useCoreStore()

            if (!state.closeUpCard.card) {
                return null
            }

            const texture =
                state.closeUpCard.canView ?
                    state.closeUpCard.card.texture
                :   state.closeUpCard.card.backTexture
            return core.phaserGame.textures.getBase64(texture.textureName, texture.frameName)
        },
        selectionAreaRect(state) {
            let [x, y] = [state.selectionArea.startX, state.selectionArea.startY]
            let [width, height] = [state.selectionArea.endX - x, state.selectionArea.endY - y]

            if (width < 0) {
                x += width
                width *= -1
            }
            if (height < 0) {
                y += height
                height *= -1
            }

            return new Rectangle(x, y, width, height)
        },
        selectedHandleableCards(state) {
            return state.handleableCards.filter(hc => state.selectedCards.includes(hc.card))
        },
    },

    actions: {
        setCloseUpCard(card: Card | null, canView?: boolean | undefined) {
            if (canView === undefined) {
                canView = card ? card.canSee() || card.canPeek() : false
            }
            this.closeUpCard = { card, canView }
        },

        hideContextSubmenu() {
            this.contextMenu.submenu.show = false
            this.contextMenu.submenu.component = null
        },

        hideContextMenu() {
            this.contextMenu.show = false
            this.hideContextSubmenu()
        },
    },
})

if (import.meta.hot) {
    import.meta.hot.accept(acceptHMRUpdate(useBusStore, import.meta.hot))
}
