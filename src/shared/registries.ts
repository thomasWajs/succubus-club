import { DeckList, KrcgId } from '@/shared/types/gateway.ts'
import { CardResource, deckName, SetAndPrecons, setName } from '@/shared/types/resources.ts'
import { GameId } from '@/shared/types/model.ts'
import { GameState } from '@/shared/state/gameState.ts'

import {
    GameMutation,
    GameMutationClassType,
    GameMutationParams,
} from '@/shared/state/gameMutations.ts'
import { Player } from '@/shared/model/Player.ts'
import { Validity } from '@/shared/types/state.ts'

/**
 * Logging
 */

export type SeverityLevel = 'fatal' | 'error' | 'warning' | 'log' | 'info' | 'debug'
export type Logger = {
    captureException: (exception: unknown) => void
    captureMessage: (message: string, captureContext?: SeverityLevel) => void
}
let logger: Logger | null = null

export function registerLogger(newLogger: Logger) {
    logger = newLogger
}
export function getLogger() {
    if (!logger) throw new Error('No logger registered. Did you forget to call registerLogger() ?')
    return logger
}

/**
 * Game Resources
 */

export const gameResources = {
    cardbase: {} as Record<KrcgId, CardResource>,
    preconDecks: {} as Record<setName, Record<deckName, DeckList>>,
    setsAndPrecons: {} as Record<setName, SetAndPrecons>,
    atlasJsons: {} as Record<string, Record<string, never>>,
}

export function setGameResources<K extends keyof typeof gameResources>(
    destination: K,
    resources: (typeof gameResources)[K],
) {
    gameResources[destination] = resources
}

/**
 * Game State
 */

const gameStateRegistry = new Map<GameId, GameState>()

export function hasGameState(gameId: GameId): boolean {
    return gameStateRegistry.has(gameId)
}

export function getGameState(gameId: GameId): GameState {
    const gameState = gameStateRegistry.get(gameId)
    if (!gameState) {
        throw new Error(`No game state found for game ${gameId}`)
    }
    return gameState
}

export function registerGameState(gameId: GameId, gameState: GameState) {
    gameStateRegistry.set(gameId, gameState)
}

export function deleteGameState(gameId: GameId): void {
    gameStateRegistry.delete(gameId)
}

/**
 * Game Mutations
 */

type MutationTrigger = {
    act: <ParamsType extends GameMutationParams, GMClass extends GameMutation<ParamsType>>(
        gameMutationClass: GameMutationClassType<ParamsType, GMClass>,
        author: Player,
        params: ParamsType,
    ) => Validity

    actSelf: <ParamsType extends GameMutationParams, GMClass extends GameMutation<ParamsType>>(
        gameMutationClass: GameMutationClassType<ParamsType, GMClass>,
        params: ParamsType,
    ) => Validity
}

let mutationTrigger: MutationTrigger | null = null

export function registerMutationTrigger(newTrigger: MutationTrigger) {
    mutationTrigger = newTrigger
}
export function getMutationTrigger() {
    if (!mutationTrigger)
        throw new Error(
            'No mutation trigger registered. Did you forget to call registerMutationTrigger() ?',
        )
    return mutationTrigger
}
