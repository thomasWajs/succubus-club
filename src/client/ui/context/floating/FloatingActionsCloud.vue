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
import { useUIFeatures } from '@/client/game/composables/useUIFeatures.ts'
import { useSelection } from '@/client/game/composables/useSelection.ts'
import { Card, Minion } from '@/shared/model/Card.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'

const gameBus = useGameBusStore()
const gameState = useGameStateStore()
const players = usePlayersStore()
const { actionDeclarationEnabled } = useUIFeatures()
const { singleCard, primedMinion } = useSelection(() => gameBus.selectedCards)

type FloatingActionData = {
    label: string
    top: number
    left: number
    translate?: string
    disabled?: boolean
    onClick: VoidFunction
}

const CARD_ACTION_GAP = 10
const CARD_ACTION_HEIGHT = 45

const focusedCard = computed(() => {
    if (
        gameBus.contextMenu.show ||
        gameBus.declaringTargetOrigin ||
        gameBus.dragAttrs ||
        gameState.action ||
        gameState.combat ||
        gameState.referendum ||
        gameState.activePlayer != players.selfPlayer
    ) {
        return
    }

    // Main case : a selected minion capable of performing an action.
    if (primedMinion.value) {
        return primedMinion.value
    }

    // Alternate case : an embrace-like can become a vampire
    if (singleCard.value && singleCard.value.isEmbraceLike()) {
        return singleCard.value
    }

    // Alternate case : a card in play calls a referendum by cardtext
    if (singleCard.value && readyToCallReferendum(singleCard.value)) {
        return singleCard.value
    }

    return undefined
})

// Cards that call a referendum by cardtext only do it from their place in play.
// A locked one still can : it is not an action it takes.
function readyToCallReferendum(card: Card): boolean {
    return card.isIn.ready && card.canCallReferendum()
}

const floatingActions = computed<FloatingActionData[]>(() => {
    const card = focusedCard.value
    if (!card) {
        return []
    }

    const actions: FloatingActionData[] = []

    if (card.isEmbraceLike()) {
        actions.push(...getEmbraceLikeActions(card))
    }
    // Only a primed minion gets the action buttons, and focusedCard returns it
    // first, so this is that same card
    else if (primedMinion.value) {
        actions.push(...getActingMinionActions(primedMinion.value))
    }

    // Comes on top of whatever the card can do otherwise, minion or not
    if (readyToCallReferendum(card)) {
        actions.push(...getCallReferendumActions(card))
    }

    return actions
})

function getPositionning(card: Card) {
    const scale = display.scale
    const cardActionGap = CARD_ACTION_GAP * scale
    const cardActionHeight = CARD_ACTION_HEIGHT * scale

    // World position of the center of the card
    const worldPoint = gameBus.cardsInGame[card.oid]?.getWorldPosition()

    if (!worldPoint) {
        return null
    }

    const { x, y } = getScreenPoint(worldPoint.x, worldPoint.y)
    const rect = getCardRectangle(card)

    const cardTop = y - (rect.height * scale) / 2
    const cardBottom = y + (rect.height * scale) / 2
    const cardRight = x + (rect.width * scale) / 2
    const cardLeft = x - (rect.width * scale) / 2

    const northActionsTop = cardTop - cardActionHeight - cardActionGap
    const southActionsTop = cardBottom + cardActionGap
    const eastActionsLeft = cardRight + cardActionGap
    const westActionsRight = cardLeft - cardActionGap

    return {
        cardActionGap,
        cardActionHeight,
        x,
        y,
        cardTop,
        cardBottom,
        cardRight,
        cardLeft,
        northActionsTop,
        southActionsTop,
        eastActionsLeft,
        westActionsRight,
    }
}

function getActingMinionActions(actingMinion: Minion): FloatingActionData[] {
    if (!actionDeclarationEnabled.value) {
        return []
    }

    const positionning = getPositionning(actingMinion)
    if (!positionning) {
        return []
    }

    const actions: FloatingActionData[] = []
    const {
        cardActionGap,
        cardActionHeight,
        x,
        cardTop,
        northActionsTop,
        eastActionsLeft,
        westActionsRight,
    } = positionning

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
                top: cardTop + cardActionHeight + cardActionGap,
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
                top: cardTop + cardActionHeight + cardActionGap,
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
            left: x - cardActionGap,
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
}

function getCallReferendumActions(card: Card): FloatingActionData[] {
    const positionning = getPositionning(card)
    if (!positionning) {
        return []
    }
    const { x, northActionsTop, southActionsTop } = positionning

    return [
        {
            label: 'Call Referendum',
            left: x,
            translate: 'translateX(-50%)',
            // Above the card, like the embrace-like action. A minion already
            // has its action buttons up there, so it takes the free slot below.
            top: card.isMinion() ? southActionsTop : northActionsTop,
            onClick: () => {
                gameMutations.REFERENDUM_call.actSelf({})
            },
        },
    ]
}

function getEmbraceLikeActions(embraceLike: Card): FloatingActionData[] {
    const positionning = getPositionning(embraceLike)
    if (!positionning) {
        return []
    }
    const { x, northActionsTop } = positionning
    return [
        {
            label: 'Become Vampire',
            left: x,
            translate: 'translateX(-50%)',
            top: northActionsTop,
            onClick: () => {
                gameMutations.becomeVampire.actSelf({
                    card: embraceLike,
                })
            },
        },
    ]
}
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
