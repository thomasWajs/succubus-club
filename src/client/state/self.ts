/**
 * Function dedicated to the self player
 */

import { useGameStateStore } from '@/client/store/gameState.ts'
import { Card, LibraryCard } from '@/shared/model/Card.ts'
import * as cardVisibility from '@/shared/state/cardVisibility.ts'
import { secureName } from '@/shared/state/cardVisibility.ts'
import { ACTION_TYPES, LibraryCardType, TurnPhase } from '@/shared/const/model.ts'
import { Player } from '@/shared/model/Player.ts'

export function selfCanSee(card: Card): boolean {
    const gameState = useGameStateStore()
    return gameState.selfPlayer ?
            // For players
            cardVisibility.canSee(gameState.selfPlayer, card)
            // For spectators
        :   cardVisibility.anyoneCanSee(card)
}

export function selfCanSeeOrPeek(card: Card): boolean {
    const gameState = useGameStateStore()
    return gameState.selfPlayer ?
            // For players
            cardVisibility.canSeeOrPeek(gameState.selfPlayer, card)
            // For spectators
        :   cardVisibility.anyoneCanSee(card)
}

export function selfCanPlay(card: LibraryCard): boolean {
    if (!card.resource) {
        return false
    }

    const gameState = useGameStateStore()
    const resource = card.resource
    // A card may have multiples types, we must check each of them
    const types = resource.type.split('/') as LibraryCardType[]
    for (const type of types) {
        if (
            (gameState.selfIsActive &&
                ((gameState.turnPhase == TurnPhase.Master && type == LibraryCardType.Master) ||
                    (gameState.turnPhase == TurnPhase.Minion &&
                        (ACTION_TYPES.includes(type) || type == LibraryCardType.ActionModifier)) ||
                    (gameState.turnPhase == TurnPhase.Discard && type == LibraryCardType.Event))) ||
            (!gameState.selfIsActive &&
                gameState.turnPhase == TurnPhase.Minion &&
                type == LibraryCardType.Reaction) ||
            (gameState.turnPhase == TurnPhase.Minion && type == LibraryCardType.Combat)
        ) {
            return true
        }
    }
    return false
}

export function selfSecureName(target: Card | Player): string {
    return secureName(target, useGameStateStore().selfPlayer)
}
