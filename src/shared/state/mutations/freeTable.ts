import { Player } from '@/shared/model/Player.ts'
import { Card } from '@/shared/model/Card.ts'
import { COUNT_LOG_PLACEHOLDER } from '@/shared/const/game.ts'
import { Invalid, VALID } from '@/shared/types/state.ts'
import { MutationSyncMode, VersioningId, VersioningTarget } from '@/shared/types/multiplayer.ts'
import { Point2D } from '@/shared/types/model.ts'
import { freeTableCryptSlotPosition } from '@/shared/state/freeTableLayout.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { LogGroup } from '@/shared/types/history.ts'
import { AnyGameMutation, GameMutation, GameMutationParams } from '@/shared/state/mutations/base.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'

/**
 * Free Table : Move Player Widget
 *
 * Free Table equivalent of UI_changeScale / UI_changeSeparators : a
 * fast-syncing, non-cancellable UI mutation that stores the player's
 * PlayerWidget anchor on the shared table.
 */

interface MovePlayerWidgetParams extends GameMutationParams {
    player: Player
    x: number
    y: number
}

export class MovePlayerWidget extends GameMutation<MovePlayerWidgetParams> {
    readonly syncMode = MutationSyncMode.Merge
    isIgnoredForCancel = true

    protected get _versioningId(): VersioningId {
        return `${VersioningTarget.WidgetPosition}-${this.params.player.oid}`
    }

    protected updateGameState() {
        this.params.player.widgetPosition = { x: this.params.x, y: this.params.y }
    }
}

/**
 * Free Table : Move The Edge Widget
 *
 * Same fast-syncing, non-cancellable pattern as MovePlayerWidget, but for the
 * single shared "The Edge" widget rather than a per-player one.
 */

interface MoveTheEdgeWidgetParams extends GameMutationParams {
    x: number
    y: number
}

export class MoveTheEdgeWidget extends GameMutation<MoveTheEdgeWidgetParams> {
    readonly syncMode = MutationSyncMode.Merge
    isIgnoredForCancel = true

    protected get _versioningId(): VersioningId {
        return VersioningTarget.TheEdgeWidgetPosition
    }

    protected updateGameState(gameState: GameState) {
        gameState.theEdgeWidgetPosition = { x: this.params.x, y: this.params.y }
    }
}

/**
 * Free Table : Draw Crypt
 *
 * Equivalent of the standard DrawCrypt mutation, but the card lands face-down
 * on the shared gameState.table instead of player.uncontrolled, which isn't
 * displayed in Free Table mode.
 */

interface FreeTableDrawCryptParams extends GameMutationParams {
    player: Player
}

export class FreeTableDrawCrypt extends GameMutation<FreeTableDrawCryptParams> {
    readonly syncMode = MutationSyncMode.Exclusive
    declare public previousState: { card: Card }

    get allowedPlayer() {
        return this.params.player
    }

    getValidity(gameState: GameState) {
        if (!gameState.isFreeTable || !gameState.table) {
            return Invalid('Free-Form Table Draw Crypt is only available in Free Table mode')
        }
        return this.params.player.crypt.isEmpty ? Invalid('Cannot draw from an empty Crypt') : VALID
    }

    protected updateGameState(gameState: GameState) {
        const player = this.params.player
        const table = gameState.table
        if (!table) {
            return
        }

        const card = player.crypt.firstCard
        this.previousState.card = card

        // First slot not already occupied by one of this player's crypt cards,
        // so a draw sits next to the widget and reuses slots freed by cards
        // played or dragged off, rather than the row growing forever.
        const isSlotOccupied = (position: Point2D) =>
            table.cards.some(c => c.isCrypt && c.x == position.x && c.y == position.y)

        let slot = 0
        let position = freeTableCryptSlotPosition(player, slot)
        while (isSlotOccupied(position)) {
            slot++
            position = freeTableCryptSlotPosition(player, slot)
        }

        gameState.moveCardToRegion(card, table)
        card.setCoordinates(position.x, position.y)
        card.isFlipped = true
    }

    formatForLog() {
        return `Draw ${COUNT_LOG_PLACEHOLDER} from crypt`
    }

    formatLogDetails() {
        return [{ label: 'crypt', value: `${this.params.player.crypt.length}` }]
    }

    get logGroup(): LogGroup {
        return { key: `${this.name}-${this.params.player.oid}`, amount: 1 }
    }

    getCancelMutation(): AnyGameMutation {
        const card = this.previousState.card
        return gameMutations.moveCardToRegion.createCancelMutation(this, {
            card,
            fromCardRegion: card.region,
            toCardRegion: card.controller.crypt,
            position: 0,
        })
    }
}
