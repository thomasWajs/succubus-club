import { gameMutations } from '@/state/gameMutations.ts'
import { MinionAction, MinionActionNames, MinionActionType } from '@/state/types.ts'
import { Player } from '@/model/Player.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { useBusStore, useGameBusStore } from '@/store/bus.ts'
import Card, { Minion } from '@/model/Card.ts'
import { GRID_SIZE, PLAY_AREA_WIDTH } from '@/game/const.ts'

export function playCardFromHand(card: Card, actingMinion?: Minion) {
    const player = card.controller

    if (card.region != player.hand) {
        throw Error('Card is not in hand')
    }

    gameMutations.moveCardToRegion.act(player, {
        card,
        fromCardRegion: player.hand,
        toCardRegion: player.ready,
        x: actingMinion ? actingMinion.x : PLAY_AREA_WIDTH / 2 - 4 * GRID_SIZE,
        y: actingMinion ? actingMinion.y - 12 * GRID_SIZE : 8 * GRID_SIZE,
    })
}

export function resetDeclaration() {
    const gameBus = useGameBusStore()
    gameBus.declaringTargetOrigin = null
    gameBus.actionDeclaration = {
        type: null,
        actingMinion: null,
        usage: null,
        validTargets: null,
        validActionCards: null,
    }
}

export function declareAction(action: MinionAction, player?: Player) {
    const gameState = useGameStateStore()

    if (!player) {
        if (!gameState.selfPlayer) {
            return
        }
        player = gameState.selfPlayer
    }

    gameMutations.ACTION_declareAction.act(player, { minionAction: action })

    if (action.target) {
        gameMutations.UI_addTargetDeclaration.act(player, {
            origin:
                action.type == MinionActionType.ActionCardFromHand ?
                    action.card
                :   action.actingMinion,
            target: action.target,
        })
    }

    if (action.type == MinionActionType.ActionCardFromHand && !player.isBot) {
        playCardFromHand(action.card, action.actingMinion)
    }
}

export function startTargetDeclaration(card: Card) {
    const gameBus = useGameBusStore()
    gameBus.declaringTargetOrigin = card
}

export function validateTargetDeclaration(target: Card | Player) {
    const gameBus = useGameBusStore()

    if (!gameBus.declaringTargetOrigin) {
        return
    }

    // If there was an action pending declaration, we can now declare it
    if (gameBus.actionDeclaration.type && gameBus.actionDeclaration.actingMinion) {
        // If this is not a valid target, abort
        if (
            gameBus.actionDeclaration.validTargets &&
            // @ts-expect-error if target is a player, includes will return false, which is fine
            !gameBus.actionDeclaration.validTargets.includes(target)
        ) {
            if (target instanceof Player) {
                resetDeclaration()
            } else {
                useBusStore().alertWarning(
                    `Invalid target for action ${MinionActionNames[gameBus.actionDeclaration.type]} : ${target.secureName}`,
                )
            }
            return
        }

        declareAction({
            type: gameBus.actionDeclaration.type,
            actingMinion: gameBus.actionDeclaration.actingMinion,
            target,
        } as MinionAction)
    }
    // Simple target declaration, no action
    else {
        gameMutations.UI_addTargetDeclaration.actSelf({
            origin: gameBus.declaringTargetOrigin,
            target,
        })
    }

    resetDeclaration()
}

export function validateActionCardDeclaration(card: Card) {
    const gameBus = useGameBusStore()

    if (
        !gameBus.actionDeclaration.type ||
        !gameBus.actionDeclaration.actingMinion ||
        !gameBus.actionDeclaration.validActionCards
    ) {
        return
    }

    if (
        gameBus.actionDeclaration.type != MinionActionType.ActionCardFromHand &&
        gameBus.actionDeclaration.type != MinionActionType.ActionInPlay
    ) {
        return
    }

    if (!gameBus.actionDeclaration.validActionCards.includes(card)) {
        useBusStore().alertWarning(`Invalid action card : ${card.name}`)
        return
    }

    declareAction({
        type: gameBus.actionDeclaration.type,
        actingMinion: gameBus.actionDeclaration.actingMinion,
        card,
        // TODO: usage declaration
        usage: {},
    } as MinionAction)
    resetDeclaration()
}
