/**
 * Function dedicated to the self player
 */

import { useGameStateStore } from '@/client/store/gameState.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { Card, LibraryCard } from '@/shared/model/Card.ts'
import * as cardVisibility from '@/shared/state/cardVisibility.ts'
import { secureName } from '@/shared/state/cardVisibility.ts'
import { ACTION_TYPES, LibraryCardType, TurnPhase } from '@/shared/const/model.ts'
import { Player } from '@/shared/model/Player.ts'
import { GameType } from '@/shared/types/state.ts'

export function selfCanSee(card: Card): boolean {
    // Special-case in Pupeteer mode, where the user can see all hands :
    if (card.isIn.hand && useGameStateStore().gameType === GameType.Puppeteer) {
        return true
    }

    const players = usePlayersStore()
    return players.selfPlayer ?
            // For players
            cardVisibility.canSee(players.selfPlayer, card)
            // For spectators
        :   cardVisibility.anyoneCanSee(card)
}

export function selfCanSeeOrPeek(card: Card): boolean {
    // Special-case in Pupeteer mode, where the user can see all hands :
    if (card.isIn.hand && useGameStateStore().gameType === GameType.Puppeteer) {
        return true
    }

    const players = usePlayersStore()
    return players.selfPlayer ?
            // For players
            cardVisibility.canSeeOrPeek(players.selfPlayer, card)
            // For spectators
        :   cardVisibility.anyoneCanSee(card)
}

export function selfCanPlay(card: LibraryCard): boolean {
    if (!card.resource) {
        return false
    }

    const gameState = useGameStateStore()
    const players = usePlayersStore()
    const resource = card.resource
    // A card may have multiples types, we must check each of them
    const types = resource.type.split('/') as LibraryCardType[]
    for (const type of types) {
        if (
            (players.selfIsActive &&
                ((gameState.turnPhase == TurnPhase.Master && type == LibraryCardType.Master) ||
                    (gameState.turnPhase == TurnPhase.Minion &&
                        (ACTION_TYPES.includes(type) || type == LibraryCardType.ActionModifier)) ||
                    (gameState.turnPhase == TurnPhase.Discard && type == LibraryCardType.Event))) ||
            (!players.selfIsActive &&
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
    return secureName(target, usePlayersStore().selfPlayer)
}
