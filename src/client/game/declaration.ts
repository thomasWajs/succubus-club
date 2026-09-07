import { CardMovement, gameMutations } from '@/shared/state/gameMutations.ts'
import { MinionAction, MinionActionNames, MinionActionType } from '@/shared/types/state.ts'
import { Player } from '@/shared/model/Player.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { useBusStore, useGameBusStore } from '@/client/store/bus.ts'
import { Card, LibraryCard, Minion } from '@/shared/model/Card.ts'
import { GRID_SIZE, PLAY_AREA_WIDTH } from '@/shared/const/game.ts'
import { selfSecureName } from '@/client/state/self.ts'
import { createActionCardAction } from '@/shared/state/minionActions.ts'
import { findFreePlayPosition } from '@/client/game/utils.ts'

export function playCard({
    card,
    byMinion,
    movement,
    logActingMinion = false,
}: {
    card: Card
    byMinion?: Minion
    movement?: CardMovement
    // Log the play as "Play [card] with [minion]". Used when the card is played
    // onto a minion without being declared as an action.
    logActingMinion?: boolean
}) {
    const players = usePlayersStore()
    const gameBus = useGameBusStore()
    const player = card.controller

    let x: number
    let y: number
    if (movement?.x !== undefined && movement.y !== undefined) {
        // Explicit drop position chosen by the user : respect it.
        x = movement.x
        y = movement.y
    } else {
        // Auto placement near the acting minion ( or a default spot ), nudged to
        // avoid sitting on top of cards already in play.
        const x0 = byMinion ? byMinion.x : PLAY_AREA_WIDTH / 2 - 4 * GRID_SIZE
        const y0 = byMinion ? byMinion.y - 12 * GRID_SIZE : 8 * GRID_SIZE
        ;({ x, y } = findFreePlayPosition(player.ready, card, x0, y0))
    }

    gameMutations.moveCardToRegion.act(player, {
        card,
        fromCardRegion: card.region,
        toCardRegion: player.ready,
        x,
        y,
        byMinion: logActingMinion ? byMinion : undefined,
    })

    if (player.oid == players.selfPlayerOid) {
        gameBus.selectedCards = [card]
    }
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
    const players = usePlayersStore()

    if (!player) {
        if (!players.selfPlayer) {
            return
        }
        player = players.selfPlayer
    }

    resetDeclaration()

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

    if (
        action.type == MinionActionType.ActionCardFromHand &&
        action.card.region == player.hand &&
        !player.isBot
    ) {
        playCard({ card: action.card, byMinion: action.actingMinion })
    }
}

export function declareActionCardFromHand(actingMinion: Minion, card: LibraryCard) {
    declareAction(createActionCardAction(actingMinion, card, {}))
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
                    `Invalid target for action ${MinionActionNames[gameBus.actionDeclaration.type]} : ${selfSecureName(target)}`,
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
        // usage declaration TODO
        usage: {},
    } as MinionAction)
    resetDeclaration()
}
