import { Player } from '@/shared/model/Player.ts'
import { Card } from '@/shared/model/Card.ts'
import { CARD_LOG_PLACEHOLDER } from '@/shared/const/game.ts'
import { Invalid, MinionActionType, TargetDeclaration, VALID } from '@/shared/types/state.ts'
import { MutationSyncMode, VersioningId, VersioningTarget } from '@/shared/types/multiplayer.ts'
import { useTimer } from '@/shared/state/useTimer.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { ActionLineFold, logCard, logPlayer } from '@/shared/state/history/mutationLog.ts'
import {
    AnyGameMutation,
    CardMutation,
    GameMutation,
    GameMutationParams,
} from '@/shared/state/mutations/base.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'

/**
 * UI : Target Declaration ( Arrow )
 */

interface TargetDeclarationParams extends GameMutationParams {
    origin: Card
    target: Card | Player
}

interface TargetDeclarationsParams extends GameMutationParams {
    targetDeclarations: TargetDeclaration[]
}

export class AddTargetDeclaration extends GameMutation<TargetDeclarationParams> {
    readonly syncMode = MutationSyncMode.Ordered

    protected get _versioningId(): VersioningId {
        return VersioningTarget.TargetDeclaration
    }

    get card() {
        return this.params.target instanceof Card ? this.params.target : null
    }

    protected updateGameState(gameState: GameState) {
        gameState.targetDeclarations.push({
            originOid: this.params.origin.oid,
            targetOid: this.params.target.oid,
        })
    }

    formatForLog() {
        if (this.params.target instanceof Card) {
            return `Declare target ${CARD_LOG_PLACEHOLDER} for ${logCard(this.params.origin)}`
        } else {
            return `Declare target ${logPlayer(this.params.target)} for ${logCard(this.params.origin)}`
        }
    }

    // The arrow of the target of the action in progress : the declaration already names it
    get actionLineFold(): ActionLineFold {
        const minionAction = this.gameState.action?.minionAction
        if (!minionAction || minionAction.target?.oid !== this.params.target.oid) {
            return null
        }
        const actionCard =
            minionAction.type == MinionActionType.ActionCardFromHand ? minionAction.card : null
        const origin = this.params.origin
        return origin.oid === actionCard?.oid || origin.oid === minionAction.actingMinion.oid ?
                'silent'
            :   null
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.UI_removeTargetDeclaration.createCancelMutation(this, {
            origin: this.params.origin,
            target: this.params.target,
        })
    }
}

export class RemoveTargetDeclaration extends GameMutation<TargetDeclarationParams> {
    readonly syncMode = MutationSyncMode.Ordered

    protected get _versioningId(): VersioningId {
        return VersioningTarget.TargetDeclaration
    }

    get card() {
        return this.params.target instanceof Card ? this.params.target : null
    }

    protected updateGameState(gameState: GameState) {
        gameState.targetDeclarations = gameState.targetDeclarations.filter(
            (arrow: TargetDeclaration) =>
                arrow.originOid != this.params.origin.oid ||
                arrow.targetOid != this.params.target.oid,
        )
    }

    formatForLog() {
        return `Remove target ${CARD_LOG_PLACEHOLDER}`
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.UI_addTargetDeclaration.createCancelMutation(this, {
            origin: this.params.origin,
            target: this.params.target,
        })
    }
}

export class ChangeTargetDeclaration extends GameMutation<TargetDeclarationsParams> {
    readonly syncMode = MutationSyncMode.Ordered

    protected get _versioningId(): VersioningId {
        return VersioningTarget.TargetDeclaration
    }

    protected updateGameState(gameState: GameState) {
        this.previousState.targetDeclarations = [...gameState.targetDeclarations]
        gameState.targetDeclarations = this.params.targetDeclarations
    }

    formatForLog() {
        return this.params.targetDeclarations.length == 0 ? 'Clear targets' : 'Set targets'
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.UI_changeTargetDeclaration.createCancelMutation(this, {
            targetDeclarations: this.previousState.targetDeclarations as TargetDeclaration[],
        })
    }
}

/**
 * UI : Change scale
 */

interface ChangeScaleParams extends GameMutationParams {
    player: Player
    scale: number
}

export class ChangeScale extends GameMutation<ChangeScaleParams> {
    readonly syncMode = MutationSyncMode.Merge
    isIgnoredForCancel = true

    protected get _versioningId(): VersioningId {
        return VersioningTarget.Scale
    }

    protected updateGameState() {
        this.params.player.scale = this.params.scale
    }
}

/**
 * UI : Change separators
 */

interface ChangeSeparatorsParams extends GameMutationParams {
    player: Player
    verticalX?: number
    horizontalY?: number
}

export class ChangeSeparators extends GameMutation<ChangeSeparatorsParams> {
    readonly syncMode = MutationSyncMode.Merge
    isIgnoredForCancel = true

    protected get _versioningId(): VersioningId {
        return VersioningTarget.Separator
    }

    protected updateGameState() {
        if (this.params.verticalX) {
            this.params.player.separators.verticalX = this.params.verticalX
        }
        if (this.params.horizontalY) {
            this.params.player.separators.horizontalY = this.params.horizontalY
        }
    }
}

/**
 * UI : Timer
 */

interface TimerParams extends GameMutationParams {
    date: Date
}

export class StartTimer extends GameMutation<TimerParams> {
    readonly syncMode = MutationSyncMode.Ordered
    isIgnoredForCancel = true

    protected get _versioningId(): VersioningId {
        return VersioningTarget.Timer
    }

    protected updateGameState() {
        useTimer(this.gameId).applyStartTimer(this.params.date)
    }

    formatForLog() {
        return `Start timer`
    }

    formatLogDetails() {
        const timer = useTimer(this.gameId)
        const remainingTime = timer.getRemainingTimeAt(this.params.date.getTime())
        return [{ label: 'left', value: timer.formatTime(remainingTime) }]
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.UI_pauseTimer.createCancelMutation(this, {
            remainingTime: this.params.remainingTime,
            date: this.params.date,
        })
    }
}

export class PauseTimer extends GameMutation<TimerParams> {
    readonly syncMode = MutationSyncMode.Ordered
    isIgnoredForCancel = true

    protected get _versioningId(): VersioningId {
        return VersioningTarget.Timer
    }

    protected updateGameState() {
        useTimer(this.gameId).applyPauseTimer(this.params.date)
    }

    formatForLog() {
        return `Pause timer`
    }

    formatLogDetails() {
        const timer = useTimer(this.gameId)
        const remainingTime = timer.getRemainingTimeAt(this.params.date.getTime())
        return [{ label: 'left', value: timer.formatTime(remainingTime) }]
    }

    getCancelMutation(): AnyGameMutation {
        return gameMutations.UI_startTimer.createCancelMutation(this, {
            remainingTime: this.params.remainingTime,
            date: this.params.date,
        })
    }
}

/**
 * UI : Ping Card
 */

export class PingCard extends CardMutation {
    isIgnoredForCancel = true
    readonly syncMode = MutationSyncMode.Merge

    getValidity() {
        // Can apply only to cards in play
        return this.params.card.isIn.play ? VALID : Invalid('Cannot ping cards out of play')
    }

    protected updateGameState() {
        // This one is kinda special : we update the game bus instead of the game state
        // So we do nothing here
    }
}
