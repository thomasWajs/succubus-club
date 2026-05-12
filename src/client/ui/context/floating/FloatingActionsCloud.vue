<template>
    <TransitionGroup name="floating">
        <FloatingAction
            v-for="action in floatingActions"
            :key="action.label + action.top + action.left"
            :top="action.top"
            :left="action.left"
            :translate="action.translate"
            :disabled="action.disabled"
            @click="action.onClick"
        >
            {{ action.label }}
        </FloatingAction>
    </TransitionGroup>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import FloatingAction from '@/client/ui/context/floating/FloatingAction.vue'
import { useGameBusStore } from '@/client/store/bus.ts'
import { getCardRectangle, getScreenPoint } from '@/client/game/utils.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { display } from '@/client/game/display.ts'
import { MinionActionType } from '@/shared/types/state.ts'
import { declareAction, startTargetDeclaration } from '@/client/game/declaration.ts'
import { ACTION_TYPES } from '@/shared/const/model.ts'

const gameBus = useGameBusStore()
const gameState = useGameStateStore()
const players = usePlayersStore()

const selectedCard = computed(() => {
    if (
        gameBus.contextMenu.show ||
        gameBus.declaringTargetOrigin ||
        gameBus.dragAttrs ||
        gameState.action ||
        gameState.combat ||
        gameState.activePlayer != players.selfPlayer
    ) {
        return
    }
    const card = gameBus.selectedCards.length == 1 && gameBus.selectedCards[0]
    return (
            card &&
                [players.selfPlayer?.ready, players.selfPlayer?.torpor].includes(card.region) &&
                !card.isLocked &&
                card.isMinion()
        ) ?
            card
        :   undefined
})

type FloatingActionData = {
    label: string
    top: number
    left: number
    translate?: string
    disabled?: boolean
    onClick: VoidFunction
}

const floatingActions = computed(() => {
    const actingMinion = selectedCard.value
    if (!actingMinion) {
        return []
    }
    const actions: FloatingActionData[] = []

    const scale = display.scale
    const CARD_ACTION_GAP = 10 * scale
    const CARD_ACTION_HEIGHT = 45 * scale

    // World position of the center of the card
    const worldPoint = gameBus.cardsInGame[actingMinion.oid]?.getWorldPosition()

    if (!worldPoint) {
        return []
    }

    const { x, y } = getScreenPoint(worldPoint.x, worldPoint.y)
    const rect = getCardRectangle(actingMinion)

    const cardTop = y - (rect.height * scale) / 2
    const cardRight = x + (rect.width * scale) / 2
    const cardLeft = x - (rect.width * scale) / 2

    const northActionsTop = cardTop - CARD_ACTION_HEIGHT - CARD_ACTION_GAP
    const eastActionsLeft = cardRight + CARD_ACTION_GAP
    const westActionsRight = cardLeft - CARD_ACTION_GAP

    const prey = actingMinion.controller.prey
    const allVampiresInTorpor = Object.values(gameState.players).flatMap(
        player => player.vampiresInTorpor,
    )
    const actionsInHand = actingMinion.controller.hand.cards.filter(card =>
        card.type ? ACTION_TYPES.includes(card.type) : false,
    )
    const cardsInPlay = Object.values(gameState.cards).filter(card => card.isIn.controlled)

    if (actingMinion.isIn.ready) {
        if (prey) {
            actions.push({
                label: 'Bleed',
                left: eastActionsLeft,
                top: cardTop + CARD_ACTION_HEIGHT + CARD_ACTION_GAP,
                onClick: () => {
                    declareAction({
                        type: MinionActionType.Bleed,
                        actingMinion,
                        target: prey,
                    })
                },
            })
        }

        if (actingMinion.isVampire()) {
            actions.push({
                label: 'Hunt',
                left: westActionsRight,
                top: cardTop + CARD_ACTION_HEIGHT + CARD_ACTION_GAP,
                translate: 'translateX(-100%)',
                onClick: () => {
                    declareAction({
                        type: MinionActionType.Hunt,
                        actingMinion,
                    })
                },
            })

            actions.push({
                label: 'Diablerize',
                left: eastActionsLeft,
                top: cardTop,
                disabled: allVampiresInTorpor.length == 0,
                onClick: () => {
                    startTargetDeclaration(actingMinion)
                    gameBus.actionDeclaration = {
                        type: MinionActionType.Diablerize,
                        actingMinion,
                        usage: null,
                        validTargets: allVampiresInTorpor,
                        validActionCards: null,
                    }
                },
            })

            actions.push({
                label: 'Rescue',
                left: westActionsRight,
                top: cardTop,
                translate: 'translateX(-100%)',
                disabled: allVampiresInTorpor.length == 0,
                onClick: () => {
                    startTargetDeclaration(actingMinion)
                    gameBus.actionDeclaration = {
                        type: MinionActionType.RescueFromTorpor,
                        actingMinion,
                        usage: null,
                        validTargets: allVampiresInTorpor,
                        validActionCards: null,
                    }
                },
            })
        }

        actions.push({
            label: 'Card In Hand',
            left: x,
            top: northActionsTop,
            disabled: actionsInHand.length == 0,
            onClick: () => {
                gameBus.actionDeclaration = {
                    type: MinionActionType.ActionCardFromHand,
                    actingMinion,
                    usage: null,
                    validTargets: null,
                    validActionCards: actionsInHand,
                }
            },
        })

        actions.push({
            label: 'Card In Play',
            left: x - CARD_ACTION_GAP,
            top: northActionsTop,
            translate: 'translateX(-100%)',
            onClick: () => {
                gameBus.actionDeclaration = {
                    type: MinionActionType.ActionInPlay,
                    actingMinion,
                    usage: null,
                    validTargets: null,
                    validActionCards: cardsInPlay,
                }
            },
        })
    }

    // Vampire in torpor : can only leave torpor.
    if (actingMinion.isIn.torpor) {
        actions.push({
            label: 'Leave Torpor',
            left: x,
            translate: 'translateX(-50%)',
            top: northActionsTop,
            onClick: () => {
                declareAction({
                    type: MinionActionType.LeaveTorpor,
                    actingMinion,
                })
            },
        })
    }

    return actions
})
</script>

<style lang="scss">
.floating-enter-active {
    transition: opacity 0.1s ease-out;
    transition-delay: 0.05s;
}

.floating-leave-active {
    transition: opacity 0.1s ease-in;
}

.floating-enter-from,
.floating-leave-to {
    opacity: 0;
}
</style>
