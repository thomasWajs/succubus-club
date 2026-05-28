import { useCoreStore } from '@/client/store/core.ts'
import { useBusStore, useGameBusStore } from '@/client/store/bus.ts'
import { GameType, Invalid, VALID, Validity } from '@/shared/types/state.ts'
import { broadcastGameMutation, NotInAGameRoom } from '@/client/multiplayer/room.ts'
import { enqueueBotMutation } from '@/client/bot/mutationQueue.ts'
import {
    AnyGameMutation,
    createMutation,
    GameMutation,
    GameMutationClassType,
    GameMutationParams,
    gameMutations,
    PingCard,
    ResolveAction,
    ResolveBlock,
} from '@/shared/state/gameMutations.ts'
import { useHistoryStore } from '@/client/store/history.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { Player } from '@/shared/model/Player.ts'
import { MutationHistoryEntry } from '@/shared/types/history.ts'
import { deserializeGameMutation } from '@/shared/serialization.ts'
import { AnyCardRegion } from '@/shared/types/model.ts'
import { CommunicationMode } from '@/shared/types/multiplayer.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { sendShuffleRequest } from '@/client/multiplayer/communication/scs.ts'
import { getLogger } from '@/shared/registries.ts'
import * as logging from '@/client/logging.ts'

/**
 * Apply the mutation locally, if it's valid.
 */
export function applyMutationIfValid(gameMutation: AnyGameMutation) {
    const validity = gameMutation.canApply()
    if (validity.isValid) {
        gameMutation.apply()

        try {
            useHistoryStore().addGameMutation(gameMutation)

            // Special handlings
            if (gameMutation instanceof ResolveAction || gameMutation instanceof ResolveBlock) {
                useCoreStore().conductor?.onActionResolve()
            }

            if (gameMutation instanceof PingCard) {
                // This one is kinda special : we update the game bus instead of the game state
                useGameBusStore().pingCard(gameMutation.params.card.oid)
            }
        } catch (error) {
            getLogger().captureException(error)
        }
    }
}

/**
 * In multiplayer, apply immediately.
 * With TrainBot, enqueue the mutation to maintain correct ordering.
 */
export function applyMutationLocally(gameMutation: AnyGameMutation) {
    if (useCoreStore().gameType == GameType.TrainBot) {
        enqueueBotMutation(gameMutation)
    } else {
        applyMutationIfValid(gameMutation)
    }
}

/**
 * If the mutation is valid, apply it locally AND broadcast it to other players.
 * Alert the user if the mutation is invalid.
 */
export function dispatchMutation(gameMutation: AnyGameMutation) {
    const core = useCoreStore()
    const bus = useBusStore()

    const validity = gameMutation.canApply()
    if (!validity.isValid) {
        bus.alertWarning(validity.reason)
        return validity
    }

    applyMutationLocally(gameMutation)

    if (core.gameType == GameType.Multiplayer) {
        broadcastGameMutation(gameMutation).catch(error => {
            if (error instanceof NotInAGameRoom) {
                bus.alertError(
                    "Oops, looks like you've been disconnected. Refresh the page to reconnect.",
                )
            } else {
                logging.captureException(error)
            }
        })
    }

    return VALID
}

/**
 * A player act on the game : create the mutation and dispatch it.
 */
export function act<
    ParamsType extends GameMutationParams,
    GMClass extends GameMutation<ParamsType>,
>(
    gameMutationClass: GameMutationClassType<ParamsType, GMClass>,
    author: Player,
    params: ParamsType,
): Validity {
    const gameMutation = createMutation(gameMutationClass, author, params)
    return dispatchMutation(gameMutation)
}

/**
 * Shorthand when self player act on the game.
 */
export function actSelf<
    ParamsType extends GameMutationParams,
    GMClass extends GameMutation<ParamsType>,
>(gameMutationClass: GameMutationClassType<ParamsType, GMClass>, params: ParamsType): Validity {
    const players = usePlayersStore()
    // spectators can't act on the game
    if (players.isSpectator) {
        return Invalid("Spectators can't act on the game")
    }
    if (!players.selfPlayer) {
        throw new Error('Cannot act without a self player defined')
    }
    return act(gameMutationClass, players.selfPlayer, params)
}

/**
 * Cancel
 */

export function cancelMutation(mutationEntry: MutationHistoryEntry) {
    if (!mutationEntry.isUserCancellable) {
        throw new Error('Cannot cancel this type of mutation')
    }
    const mutation = deserializeGameMutation(mutationEntry.serializedMutation)
    dispatchMutation(mutation.getCancelMutation())
}

/**
 * Shuffle Card Region
 */

export async function shuffleCardRegion(cardRegion: AnyCardRegion) {
    const core = useCoreStore()
    const players = usePlayersStore()
    const history = useHistoryStore()
    const multiplayer = useMultiplayerStore()

    if (!players.selfPlayer) {
        return
    }

    // Prevent multiple shuffle
    const lastMutation = history.getLastMutationForPlayer(players.selfPlayer.oid)
    if (lastMutation && lastMutation.serializedMutation.name == 'shuffle') {
        useBusStore().alertWarning(`This stack is already shuffled.`)
        return
    }

    // For SCS mode, request server-side shuffle
    if (core.gameType == GameType.Multiplayer) {
        const gameRoom = multiplayer.currentGameRoom
        if (gameRoom && gameRoom.communication == CommunicationMode.SCS) {
            await sendShuffleRequest(cardRegion)
            return
        }
    }

    // For other modes, use client-side shuffle
    gameMutations.shuffle.actSelf({
        cardRegion,
        cardsOrder: cardRegion.generateShuffledCardsOrder(),
        previousCardsOrder: [...cardRegion.cardsOid],
    })
}
