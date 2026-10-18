/**
 * Function dedicated to the self player
 */

import { useGameStateStore } from '@/client/store/gameState.ts'
import { useMultiplayerStore } from '@/client/store/multiplayer.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { Card, LibraryCard } from '@/shared/model/Card.ts'
import * as cardVisibility from '@/shared/state/cardVisibility.ts'
import { secureName } from '@/shared/state/cardVisibility.ts'
import { TurnPhase } from '@/shared/const/model.ts'
import { Player } from '@/shared/model/Player.ts'
import { GameType } from '@/shared/types/state.ts'
import { playerCanAttemptBlock } from '@/shared/state/actionState.ts'

/**
 * A judge oversees the game : they see and peek every card.
 *
 * This is an access-control override, not a game rule, so it lives here rather than
 * in cardVisibility : those functions take a Player, and a judge has none.
 */
export function selfIsJudge(): boolean {
    return useMultiplayerStore().selfIsJudge
}

export function selfCanSee(card: Card): boolean {
    // Special-case in Pupeteer mode, where the user can see all hands :
    if (card.isIn.hand && useGameStateStore().gameType === GameType.Puppeteer) {
        return true
    }

    if (selfIsJudge()) {
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

    if (selfIsJudge()) {
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
    const isType = card.isType
    return (
        (players.selfIsActive &&
            ((gameState.turnPhase == TurnPhase.Master && isType.master) ||
                (gameState.turnPhase == TurnPhase.Minion &&
                    (isType.anyAction || isType.actionModifier)) ||
                (gameState.turnPhase == TurnPhase.Discard && isType.event))) ||
        (!players.selfIsActive && gameState.turnPhase == TurnPhase.Minion && isType.reaction) ||
        (gameState.turnPhase == TurnPhase.Minion && isType.combat)
    )
}

export function selfCanAttemptBlock() {
    const gameState = useGameStateStore()
    const players = usePlayersStore()
    return !!players.selfPlayer && playerCanAttemptBlock(gameState, players.selfPlayer)
}

export function selfSecureName(target: Card | Player): string {
    if (selfIsJudge()) {
        return target.name
    }
    return secureName(target, usePlayersStore().selfPlayer)
}
