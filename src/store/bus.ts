import { Component, Raw } from 'vue'
import { acceptHMRUpdate, defineStore } from 'pinia'
import { Card, CardOid } from '@/model/Card.ts'
import Phaser from 'phaser'
import { Player, PlayerOid } from '@/model/Player.ts'
import { AnyCardRegion } from '@/model/CardRegion.ts'
import { SavingState } from '@/gateway/savedGames.ts'
import { AlignmentGuide } from '@/state/types.ts'
import { CardGroup, CardInGame, DragAttrs, DragOver, PlayerInGame } from '@/game/types.ts'
import Rectangle = Phaser.Geom.Rectangle
import Vector2Like = Phaser.Types.Math.Vector2Like

export enum AlertState {
    Error = 'error',
    Warning = 'warning',
    Success = 'success',
}

export type AlertMessage = {
    message: string
    type: AlertState
    dismissible: boolean
    blockInteraction: boolean
}

export const useBusStore = defineStore('bus', {
    state: () => ({
        alert: null as AlertMessage | null,
        isUserProfilePanelOpen: false,
        isDeckPanelOpen: false,
        isSavedGamesPanelOpen: false,

        isResyncing: false,
        hasBeenIdle: false,
    }),
    actions: {
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
        /** Close-up card **/
        closeUpCard: {
            card: null as Card | null,
            canView: false,
        },

        /** Pointer **/
        pointerPosition: null as Vector2Like | null, // Expressed in world coordinates
        hoveredCard: null as Card | null,
        dragAttrs: null as DragAttrs | null,

        /** Game Objects **/
        cardsInGame: {} as Record<CardOid, CardInGame>,
        playersInGame: {} as Record<PlayerOid, PlayerInGame>,

        /** Card selection **/
        selectedCards: [] as Card[],
        selectionArea: {
            show: false,
            origin: null as Vector2Like | null, // Expressed in world coordinates
        },

        /** Card groups **/
        cardGroups: [] as CardGroup[],
        cardGroupCandidate: null as CardGroup | null,

        /** Alignment guides **/
        dragOver: null as DragOver | null,
        alignmentGuides: [] as AlignmentGuide[],

        /** Target declaration **/
        declaringTargetOrigin: null as Card | null,

        /** Hand **/
        handDropGapPosition: null as null | number,
        draggedHandCardPosition: null as null | number,

        /** Menus **/
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
        wieldCardStack: {
            show: false,
            cardRegion: null as AnyCardRegion | null,
            searchString: '',
        },

        /** Saving **/
        savingState: SavingState.None,
    }),

    getters: {
        selectionAreaRect(state) {
            if (
                !state.selectionArea.show ||
                !state.pointerPosition ||
                !state.selectionArea.origin
            ) {
                return null
            }

            let { x, y } = state.selectionArea.origin
            let [width, height] = [state.pointerPosition.x - x, state.pointerPosition.y - y]

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
        selectedCardsInGame(state): CardInGame[] {
            return state.selectedCards.map(c => state.cardsInGame[c.oid]).filter(c => c)
        },
        cardGroupsByCard(state): Record<CardOid, CardGroup> {
            const result: Record<CardOid, CardGroup> = {}
            for (const group of state.cardGroups) {
                for (const cardOid of group) {
                    result[cardOid] = group
                }
            }
            return result
        },
        // Indirect hover: cards that are not directly hovere, but are part of a group of the hovered card
        indirectHoveredCards(state): CardOid[] {
            if (state.hoveredCard) {
                return [...(this.cardGroupsByCard[state.hoveredCard.oid] ?? [])].filter(
                    cardOid => cardOid != state.hoveredCard?.oid,
                )
            }
            return []
        },

        // Indirect selection: cards that are not directly selected, but are part of a group of selected cards
        indirectSelectedCards(state): CardOid[] {
            const result = new Set<CardOid>()
            const selectedCardsOid = state.selectedCards.map(c => c.oid)
            for (const selectedCard of state.selectedCards) {
                for (const cardOid of this.cardGroupsByCard[selectedCard.oid] ?? []) {
                    if (!selectedCardsOid.includes(cardOid)) {
                        result.add(cardOid)
                    }
                }
            }
            return [...result]
        },
        indirectSelectedCardsInGame(state): CardInGame[] {
            return this.indirectSelectedCards
                .map(cardOid => state.cardsInGame[cardOid])
                .filter(c => c)
        },
    },

    actions: {
        setCloseUpCard(card: Card | null, canView?: boolean | undefined) {
            if (canView === undefined) {
                canView = card ? card.selfCanSeeOrPeek : false
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

        removeFromSelection(card: Card) {
            this.selectedCards = this.selectedCards.filter(c => c.oid != card.oid)
        },
        removeFromCardGroup(card: Card) {
            const cardGroup = this.cardGroupsByCard[card.oid]
            if (cardGroup) {
                // If there's only 2 cards left, delete the card group entirely
                if (cardGroup.size == 2) {
                    this.removeCardGroup(cardGroup)
                } else {
                    cardGroup.delete(card.oid)
                }
            }
        },
        removeCardGroup(cardGroup: CardGroup) {
            this.cardGroups = this.cardGroups.filter(cg => cg != cardGroup)
        },
    },
})

if (import.meta.hot) {
    import.meta.hot.accept(acceptHMRUpdate(useBusStore, import.meta.hot))
}
