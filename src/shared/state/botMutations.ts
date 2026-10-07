import { Player } from '@/shared/model/Player.ts'
import { Card, Minion } from '@/shared/model/Card.ts'
import {
    ActionModifier,
    ANY_PLAYER,
    CombatStrike,
    DisciplineUse,
    GameType,
    Invalid,
    MinionActionType,
    NO_ACTION_MODIFIER,
    NO_REACTION,
    VALID,
} from '@/shared/types/state.ts'
import { CARD_LOG_PLACEHOLDER } from '@/shared/const/game.ts'
import { MutationSyncMode, VersioningId, VersioningTarget } from '@/shared/types/multiplayer.ts'
import { CardOid } from '@/shared/types/model.ts'
import { secureName } from '@/shared/state/cardVisibility.ts'
import {
    canChangeTarget,
    changeActionTarget,
    endAction,
    getBlockingMinion,
    humanActsOnBot,
    markPlayedThisAction,
    passImpulse,
    regainImpulse,
} from '@/shared/state/actionState.ts'
import { emitEvent } from '@/shared/state/events.ts'
import { syncAttachedCards } from '@/shared/state/attachments.ts'
import { Trigger } from '@/shared/cardImpl/catalog/types.ts'
import { getTriggerKey } from '@/shared/state/triggers.ts'
import {
    AdditionalStrikeGain,
    addStrikes,
    applyDamageNow,
    canAddStrikes,
    canApplyDamage,
    canChooseStrike,
    canGainBlood,
    canGrapple,
    canManeuver,
    canPass,
    canPreventDamage,
    canPress,
    canSetStrength,
    canTakeStrengthBonus,
    chooseStrike,
    createCombatState,
    endCombatNow,
    finishBlock,
    gainBlood,
    grapple,
    markCombatCardPlayed,
    passCombatImpulse,
    playManeuver,
    playPress,
    preventDamage,
    setStrength,
    takeStrengthBonus,
} from '@/shared/state/combatState.ts'
import * as actions from '@/shared/state/minionActions.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { disciplineUsesImg } from '@/shared/disciplineIcons.ts'
import { usageXLog } from '@/shared/state/cardUsage.ts'
import {
    AnyGameMutation,
    defineMutation,
    EmptyParams,
    GameMutation,
    GameMutationParams,
    PlayerMutation,
    PlayerParams,
    registerMutations,
} from '@/shared/state/mutationBase.ts'

/**
 * Bot mutations
 *
 * The mutations that only exist for the bots ( the training games against them ): the engine
 * state a human tracks by hand ( the combat, the impulse of an action, the cards a bot used, what
 * is attached to a minion ). Humans play without them in a multiplayer game ( the combat is
 * handled over the voice chat ), so none of these goes through Ably or SCS. They are serialized
 * under their name like any other mutation, see the registry in mutationBase.ts.
 */

/**
 * Attach a card ( equipment, retainer ) to a minion, or detach it ( `minion` undefined ).
 * The card goes under its minion, in the region of the minion ( see attachments.ts ).
 */

export interface AttachCardParams extends GameMutationParams {
    card: Card
    minion: Minion | undefined
    // How the card was played, when it comes in play ( the version of a retainer ). A card that
    // changes minion keeps the ones it had.
    disciplines?: DisciplineUse[]
}

class AttachCard extends GameMutation<AttachCardParams> {
    _isUserCancellable = false
    readonly syncMode = MutationSyncMode.Ordered
    declare public previousState: {
        minionOid: CardOid | undefined
        disciplines: DisciplineUse[] | undefined
    }

    protected get _versioningId(): VersioningId {
        return `${VersioningTarget.Attachment}-${this.params.card.oid}`
    }

    get card() {
        return this.params.card
    }

    getValidity() {
        const { card, minion } = this.params
        if (!minion) {
            return VALID
        }
        if (card.oid == minion.oid || card.isMinion()) {
            return Invalid('Only a card that is not a minion can be attached')
        }
        // A card still in the hand is accepted: a master card is played and put on a minion in one go,
        // and in the browser the move of a bot's card to play is queued, not done yet
        if (!(card.isIn.controlled || card.isIn.hand) || !minion.isIn.controlled) {
            return Invalid('Only cards in play can be attached')
        }
        return VALID
    }

    protected updateGameState(gameState: GameState) {
        const { card, minion, disciplines } = this.params
        this.previousState.minionOid = gameState.attachments[card.oid]
        this.previousState.disciplines = gameState.attachmentUsages[card.oid]
        if (minion) {
            gameState.attachments[card.oid] = minion.oid
            if (disciplines) {
                gameState.attachmentUsages[card.oid] = disciplines
            }
            syncAttachedCards(gameState, minion)
        } else {
            gameState.detachCard(card.oid)
        }
    }

    formatForLog() {
        const { minion } = this.params
        return minion ?
                `${CARD_LOG_PLACEHOLDER} is attached to ${secureName(minion, this.author)}`
            :   `${CARD_LOG_PLACEHOLDER} is detached`
    }

    getCancelMutation(): AnyGameMutation {
        const previous =
            this.previousState.minionOid ?
                this.gameState.cards[this.previousState.minionOid]
            :   undefined
        return botMutations.attachCard.createCancelMutation(this, {
            card: this.params.card,
            minion: previous?.isMinion() ? previous : undefined,
            disciplines: this.previousState.disciplines,
        })
    }
}

/**
 * Spend the master phase action ( played with a master card )
 */

class SpendMasterPhaseAction extends PlayerMutation {
    _isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        return this.params.player
    }

    getValidity(gameState: GameState) {
        return gameState.turnResources.mpa > 0 ? VALID : Invalid('No master phase action left')
    }

    protected updateGameState(gameState: GameState) {
        gameState.turnResources.mpa -= 1
    }

    formatForLog() {
        return `${this.params.player.name} uses the master phase action`
    }
}

/**
 * Spend transfers ( a card effect that is paid with them, like the influence phase does )
 */

interface SpendTransfersParams extends PlayerParams {
    amount: number
}

class SpendTransfers extends GameMutation<SpendTransfersParams> {
    _isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        return this.params.player
    }

    getValidity(gameState: GameState) {
        return gameState.turnResources.transfers >= this.params.amount ?
                VALID
            :   Invalid('Not enough transfers left')
    }

    protected updateGameState(gameState: GameState) {
        gameState.turnResources.transfers -= this.params.amount
    }

    formatForLog() {
        return `${this.params.player.name} spends ${this.params.amount} transfer(s)`
    }
}

/**
 * Mark a card as used this turn ( a card effect that works once per turn )
 */

interface MarkCardUsedParams extends PlayerParams {
    card: Card
}

class MarkCardUsed extends GameMutation<MarkCardUsedParams> {
    _isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        return this.params.player
    }

    get card() {
        return this.params.card
    }

    getValidity(gameState: GameState) {
        return gameState.turnResources.usedCards.includes(this.params.card.oid) ?
                Invalid('Card already used this turn')
            :   VALID
    }

    protected updateGameState(gameState: GameState) {
        gameState.turnResources.usedCards.push(this.params.card.oid)
    }

    formatForLog() {
        return `${CARD_LOG_PLACEHOLDER} is used`
    }
}

/**
 * Resolve a pending trigger: the bot decided, to use it ( the cost and the effects are applied by
 * their own mutations ) or not. A trigger used is remembered for its once-per-turn limit.
 */

interface ResolvePendingTriggerParams extends PlayerParams {
    source: Minion
    index: number
    used: boolean
}

class ResolvePendingTrigger extends GameMutation<ResolvePendingTriggerParams> {
    _isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        return this.params.player
    }

    get card() {
        return this.params.source
    }

    getValidity(gameState: GameState) {
        return this.findPending(gameState) ? VALID : Invalid('No such pending trigger')
    }

    private findPending(gameState: GameState) {
        return gameState.pendingTriggers.find(
            pending => pending.source == this.params.source && pending.index == this.params.index,
        )
    }

    protected updateGameState(gameState: GameState) {
        const pending = this.findPending(gameState)
        if (!pending) {
            throw new Error('The trigger is not pending')
        }
        gameState.pendingTriggers = gameState.pendingTriggers.filter(other => other != pending)
        if (this.params.used) {
            gameState.turnResources.usedTriggers.push(
                getTriggerKey(this.params.source, this.params.index),
            )
        }
    }

    formatForLog() {
        return this.params.used ? `${CARD_LOG_PLACEHOLDER} uses its ability` : null
    }
}

/**
 * Note that a minion played a card ( a card that a minion can play once between its unlock phases ).
 * Forgotten when the minion is unlocked by the unlock phase.
 */

interface MarkPlayedSinceUnlockParams extends GameMutationParams {
    minion: Minion
    card: Card
}

class MarkPlayedSinceUnlock extends GameMutation<MarkPlayedSinceUnlockParams> {
    _isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        // The reacting player is not the active one
        return ANY_PLAYER
    }

    get card() {
        return this.params.minion
    }

    protected updateGameState(gameState: GameState) {
        const { minion, card } = this.params
        if (card.krcgId) {
            gameState.playedSinceUnlock[minion.oid] = [
                ...(gameState.playedSinceUnlock[minion.oid] ?? []),
                card.krcgId,
            ]
        }
    }

    formatForLog() {
        return `${CARD_LOG_PLACEHOLDER} played ${this.params.card.name}`
    }
}

/**
 * Action: Wake a minion ( it ignores the requirement to be unlocked for playing reaction cards and
 * attempting to block until the end of the action )
 */

interface WakeParams extends GameMutationParams {
    minion: Minion
}

class WakeMinion extends GameMutation<WakeParams> {
    _isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        // The reacting player is not the active one
        return ANY_PLAYER
    }

    get card() {
        return this.params.minion
    }

    getValidity(gameState: GameState) {
        return gameState.action ? VALID : Invalid('Must be applied during an action')
    }

    protected updateGameState(gameState: GameState) {
        if (!gameState.action) {
            throw new Error('gameState.action is null')
        }
        if (!gameState.action.awakeMinions.includes(this.params.minion)) {
            gameState.action.awakeMinions.push(this.params.minion)
        }
    }

    formatForLog() {
        return `${CARD_LOG_PLACEHOLDER} wakes`
    }
}

/**
 * Action: A minion gets a maneuver in the combat resulting from its block ( if it blocks )
 */

class GrantBlockManeuver extends GameMutation<WakeParams> {
    _isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        return ANY_PLAYER
    }

    get card() {
        return this.params.minion
    }

    getValidity(gameState: GameState) {
        return gameState.action ? VALID : Invalid('Must be applied during an action')
    }

    protected updateGameState(gameState: GameState) {
        if (!gameState.action) {
            throw new Error('gameState.action is null')
        }
        gameState.action.blockManeuvers.push(this.params.minion)
    }

    formatForLog() {
        return `${CARD_LOG_PLACEHOLDER} gets a maneuver if it blocks`
    }
}

/**
 * Action: Arm a trigger for the rest of the action. Only the events from now on count.
 */

interface ArmTriggerParams extends GameMutationParams {
    trigger: Trigger
}

class ArmTrigger extends GameMutation<ArmTriggerParams> {
    _isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        return ANY_PLAYER
    }

    getValidity(gameState: GameState) {
        return gameState.action ? VALID : Invalid('Must be applied during an action')
    }

    protected updateGameState(gameState: GameState) {
        if (!gameState.action) {
            throw new Error('gameState.action is null')
        }
        gameState.action.armedTriggers.push({ trigger: this.params.trigger, deferred: [] })
    }

    formatForLog() {
        return `A trigger on ${this.params.trigger.on} is armed for the action`
    }
}

/**
 * Action: Complete the declaration of a human's action card
 *
 * The usage box only records the level, target and X of a card as the human fills them in, and
 * any card is arbitrary, so the human says when it is all declared. The reactors may play from
 * then on: a bot reactor gets the impulse, like for a built-in action.
 */
class CompleteActionDeclaration extends GameMutation<GameMutationParams> {
    _isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        return this.gameState.activePlayer
    }

    get card(): Card | null {
        const minionAction = this.gameState.action?.minionAction
        return minionAction?.type == MinionActionType.ActionCardFromHand ? minionAction.card : null
    }

    getValidity(gameState: GameState) {
        if (!gameState.action) {
            return Invalid('Must be applied during an action')
        }
        if (gameState.action.declared) {
            return Invalid('The action is already declared')
        }
        return VALID
    }

    protected updateGameState(gameState: GameState) {
        if (!gameState.action) {
            throw new Error('gameState.action is null')
        }
        gameState.action.declared = true
        if (humanActsOnBot(gameState.action.minionAction)) {
            passImpulse(gameState)
        }
    }

    formatForLog() {
        const minionAction = this.gameState.action?.minionAction
        return minionAction ? `${actions.getName(minionAction)} declared` : null
    }
}

/**
 * Action: Declare action modifier
 */

interface DeclareActionModifierParams extends GameMutationParams {
    actionModifier: ActionModifier | typeof NO_ACTION_MODIFIER
}

class DeclareActionModifier extends GameMutation<DeclareActionModifierParams> {
    _isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        return this.gameState.activePlayer
    }

    getValidity(gameState: GameState) {
        return gameState.action ? VALID : Invalid('Must be applied during an action')
    }

    protected updateGameState(gameState: GameState) {
        if (!gameState.action) {
            throw new Error('gameState.action is null')
        }
        // Playing a modifier is an effect: the acting player keeps the impulse.
        // Only declining to play one passes it.
        if (this.params.actionModifier === NO_ACTION_MODIFIER) {
            passImpulse(gameState)
        } else {
            gameState.action.reactionsPassed = false
            markPlayedThisAction(
                gameState,
                this.params.actionModifier.by ?? gameState.action.minionAction.actingMinion,
                this.params.actionModifier.card,
            )
        }
    }

    formatForLog() {
        if (this.params.actionModifier === NO_ACTION_MODIFIER) {
            return `No Action Modifier`
        } else {
            const am = this.params.actionModifier
            const by = am.by ? ` by ${am.by.name}` : ''
            return `Declare ${am.card.name} ${disciplineUsesImg(am.usage.disciplines ?? [])}${usageXLog(am.usage)}${by}`
        }
    }

    get card() {
        return this.params.actionModifier == NO_ACTION_MODIFIER ?
                null
            :   this.params.actionModifier.card
    }
}

/**
 * Action: Declare reaction
 */

interface DeclareReactionParams extends GameMutationParams {
    reaction: Card | typeof NO_REACTION
    // The minion playing the reaction card
    minion?: Minion
}

class DeclareReaction extends GameMutation<DeclareReactionParams> {
    _isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        // Relax the rules here, we don't handle impulse in multiplayer
        // return this.gameState.action?.impulsePlayer ?? null
        return ANY_PLAYER
    }

    getValidity(gameState: GameState) {
        return gameState.action ? VALID : Invalid('Must be applied during an action')
    }

    protected updateGameState(gameState: GameState) {
        if (!gameState.action) {
            throw new Error('gameState.action is null')
        }
        // Playing a reaction is an effect: the acting player regains the impulse.
        // Only declining to react passes it.
        if (this.params.reaction === NO_REACTION) {
            passImpulse(gameState)
        } else {
            regainImpulse(gameState)
            if (this.params.minion) {
                markPlayedThisAction(gameState, this.params.minion, this.params.reaction)
            }
        }
    }

    formatForLog() {
        if (this.params.reaction === NO_REACTION) {
            return `No Reaction`
        } else {
            return `Reaction : ${CARD_LOG_PLACEHOLDER}`
        }
    }

    get card() {
        return this.params.reaction == NO_REACTION ? null : this.params.reaction
    }
}

/**
 * Action: Change target ( a bounce card )
 */

interface ChangeActionTargetParams extends GameMutationParams {
    target: Player
}

class ChangeActionTarget extends GameMutation<ChangeActionTargetParams> {
    _isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        // Relax the rules here, we don't handle impulse in multiplayer
        return ANY_PLAYER
    }

    getValidity(gameState: GameState) {
        return canChangeTarget(gameState, this.params.target)
    }

    protected updateGameState(gameState: GameState) {
        changeActionTarget(gameState, this.params.target)
    }

    formatForLog() {
        return `Change the target of the action to ${this.params.target.name}`
    }
}

/**
 * Action: Resolve action
 */

export class ResolveAction extends GameMutation<EmptyParams> {
    _isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive
    declare public previousState: { actionName: string }

    get allowedPlayer() {
        return this.gameState.activePlayer
    }

    getValidity(gameState: GameState) {
        if (!gameState.action) {
            return Invalid('Must be applied during an action')
        }
        // Humans resolve their own actions by hand, except for the ones the engine knows how to
        // resolve, in a game against bots (the "Resolve action" button)
        const minionAction = gameState.action.minionAction
        if (!minionAction.actingMinion.controller.isBot) {
            if (gameState.gameType != GameType.TrainBot) {
                return Invalid('Only a bot action is resolved automatically')
            }
            if (!actions.isResolvable(minionAction)) {
                return Invalid('The engine cannot resolve this action')
            }
            if (getBlockingMinion(gameState)) {
                return Invalid('A block attempt is standing: resolve the block first')
            }
        }
        return VALID
    }

    protected updateGameState(gameState: GameState) {
        if (!gameState.action) {
            throw new Error('gameState.action is null')
        }
        // Store for use formatForLog()
        this.previousState.actionName = actions.getName(gameState.action.minionAction)
        const minionAction = gameState.action.minionAction
        emitEvent(gameState, { type: 'actionResolving', action: minionAction })
        actions.resolve(minionAction)
        gameState.action = null
        gameState.targetDeclarations = []
        emitEvent(gameState, { type: 'actionResolved', action: minionAction, successful: true })
    }

    formatForLog() {
        return `Resolve ${this.previousState.actionName}`
    }
}

/**
 * Action: Resolve block
 */

export class ResolveBlock extends GameMutation<EmptyParams> {
    _isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        // Relax the rules here, we don't handle impulse in multiplayer
        // return this.gameState.activePlayer
        return ANY_PLAYER
    }

    getValidity(gameState: GameState) {
        if (!gameState.action) {
            return Invalid('Must be applied during an action')
        }

        if (gameState.action.blockResolved) {
            return Invalid('The block is already resolved')
        }
        if (!getBlockingMinion(gameState)) {
            return Invalid('Need a blocking minion to resolve a block')
        }
        return VALID
    }

    protected updateGameState(gameState: GameState) {
        const action = gameState.action
        const blockingMinion = getBlockingMinion(gameState)

        if (!action) {
            throw new Error('gameState.action is null')
        }
        if (!gameState.activePlayer) {
            throw new Error('gameState.activePlayer is null')
        }
        if (!blockingMinion) {
            throw new Error('blockingMinion is null')
        }

        // Successful block
        if (action.intercept >= action.stealth) {
            this.previousState.isBlockSuccessful = true
            blockingMinion.lock()
            action.blockResolved = blockingMinion
            const actingMinion = action.minionAction.actingMinion

            // A vampire in torpor cannot enter combat ( leave torpor ): the action just fails
            if (!actingMinion.isIn.ready) {
                this.previousState.isCombatStarted = false
                finishBlock(gameState)
                return
            }
            this.previousState.isCombatStarted = true

            gameState.combat = createCombatState(actingMinion, blockingMinion)
            gameState.combat.acting.strengthBonus = actions.getBlockedStrengthBonus(
                action.minionAction,
            )
            gameState.combat.defending.freeManeuvers = action.blockManeuvers.filter(
                minion => minion == blockingMinion,
            ).length
        }
        // Failed block
        else {
            this.previousState.isBlockSuccessful = false
            action.blockingDecisions = []
            action.impulsePlayer = gameState.activePlayer
            action.intercept = 0
            emitEvent(gameState, {
                type: 'blockFailed',
                action: action.minionAction,
                blocker: blockingMinion,
            })
        }
    }

    formatForLog() {
        if (!this.previousState.isBlockSuccessful) {
            return `Block failed`
        }
        return this.previousState.isCombatStarted === false ?
                `Block successful. The action fails, no combat`
            :   `Block successful. Combat begins`
    }
}

/**
 * Close the post block window: the blocker's controller has nothing more to play after the block,
 * the action ends
 */

class ClosePostBlock extends GameMutation<EmptyParams> {
    _isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive

    get allowedPlayer() {
        return ANY_PLAYER
    }

    getValidity(gameState: GameState) {
        return gameState.action?.blockResolved && !gameState.combat ?
                VALID
            :   Invalid('No post block window is open')
    }

    protected updateGameState(gameState: GameState) {
        endAction(gameState)
    }

    formatForLog() {
        return null
    }
}

/**
 * Combat
 *
 * The moves of the combat state machine ( see combatState.ts ). The author must
 * hold the combat impulse, except to end the combat by hand.
 */

abstract class CombatMutation<
    ParamsType extends GameMutationParams,
> extends GameMutation<ParamsType> {
    _isUserCancellable = false
    readonly syncMode = MutationSyncMode.Exclusive
    declare public previousState: { log: string }

    get allowedPlayer(): Player | typeof ANY_PLAYER | null {
        return this.gameState.combat?.impulsePlayer ?? null
    }

    // Applies the move and returns what to tell in the log
    protected abstract move(gameState: GameState): string[]

    protected updateGameState(gameState: GameState) {
        this.previousState.log = this.move(gameState).join(' | ')
    }

    formatForLog() {
        return this.previousState.log || null
    }
}

class CombatPass extends CombatMutation<EmptyParams> {
    getValidity(gameState: GameState) {
        return canPass(gameState)
    }

    protected move(gameState: GameState) {
        return passCombatImpulse(gameState)
    }
}

interface CombatManeuverParams extends GameMutationParams {
    minion: Minion
    // A maneuver given by a strike card or a weapon also chooses the strike
    strike?: CombatStrike
    // The weapon that gives the maneuver ( once per combat )
    weapon?: Card
    // A maneuver given with no card ( by a reaction when the minion blocked )
    free?: boolean
}

class CombatManeuver extends CombatMutation<CombatManeuverParams> {
    getValidity(gameState: GameState) {
        const { minion, strike, weapon, free } = this.params
        return canManeuver(gameState, minion, strike, weapon, free)
    }

    protected move(gameState: GameState) {
        const { minion, strike, weapon, free } = this.params
        return playManeuver(gameState, minion, strike, weapon, free)
    }
}

interface CombatSetStrengthParams extends GameMutationParams {
    minion: Minion
    strength: number
}

class CombatSetStrength extends CombatMutation<CombatSetStrengthParams> {
    getValidity(gameState: GameState) {
        return canSetStrength(gameState, this.params.minion)
    }

    protected move(gameState: GameState) {
        return setStrength(gameState, this.params.minion, this.params.strength)
    }
}

interface CombatStrikeParams extends GameMutationParams {
    minion: Minion
    strike: CombatStrike
    // The strike card also gives an additional strike
    additional?: AdditionalStrikeGain
}

class CombatChooseStrike extends CombatMutation<CombatStrikeParams> {
    getValidity(gameState: GameState) {
        const { minion, strike, additional } = this.params
        return canChooseStrike(gameState, minion, strike, additional)
    }

    protected move(gameState: GameState) {
        const { minion, strike, additional } = this.params
        return chooseStrike(gameState, minion, strike, additional)
    }
}

interface CombatAddStrikesParams extends GameMutationParams {
    minion: Minion
    gain: AdditionalStrikeGain
}

class CombatAddStrikes extends CombatMutation<CombatAddStrikesParams> {
    getValidity(gameState: GameState) {
        return canAddStrikes(gameState, this.params.minion, this.params.gain)
    }

    protected move(gameState: GameState) {
        return addStrikes(gameState, this.params.minion, this.params.gain)
    }
}

interface CombatGrappleParams extends GameMutationParams {
    minion: Minion
    press: boolean
    closeNextRound: boolean
}

class CombatGrapple extends CombatMutation<CombatGrappleParams> {
    getValidity(gameState: GameState) {
        return canGrapple(gameState, this.params.minion)
    }

    protected move(gameState: GameState) {
        const { minion, press, closeNextRound } = this.params
        return grapple(gameState, minion, press, closeNextRound)
    }
}

interface CombatGainBloodParams extends GameMutationParams {
    minion: Minion
    amount: number
}

class CombatGainBlood extends CombatMutation<CombatGainBloodParams> {
    getValidity(gameState: GameState) {
        return canGainBlood(gameState, this.params.minion)
    }

    protected move(gameState: GameState) {
        return gainBlood(gameState, this.params.minion, this.params.amount)
    }
}

interface CombatMinionParams extends GameMutationParams {
    minion: Minion
}

class CombatTakeStrengthBonus extends CombatMutation<CombatMinionParams> {
    getValidity(gameState: GameState) {
        return canTakeStrengthBonus(gameState, this.params.minion)
    }

    protected move(gameState: GameState) {
        return takeStrengthBonus(gameState, this.params.minion)
    }
}

interface CombatMarkPlayedParams extends GameMutationParams {
    minion: Minion
    card: Card
}

// Remembers the combat card a minion played this round ( "only one per round" cards )
class CombatMarkPlayed extends CombatMutation<CombatMarkPlayedParams> {
    getValidity(gameState: GameState) {
        return gameState.combat ? VALID : Invalid('No combat in progress')
    }

    protected move(gameState: GameState) {
        const { minion, card } = this.params
        if (card.krcgId) {
            markCombatCardPlayed(gameState, minion, card.krcgId)
        }
        return []
    }
}

interface CombatPressParams extends GameMutationParams {
    minion: Minion
    // The press is the one a card played earlier gave, not a card from the hand
    granted?: boolean
}

class CombatPress extends CombatMutation<CombatPressParams> {
    getValidity(gameState: GameState) {
        return canPress(gameState, this.params.minion, this.params.granted)
    }

    protected move(gameState: GameState) {
        return playPress(gameState, this.params.minion, this.params.granted)
    }
}

interface CombatPreventDamageParams extends GameMutationParams {
    minion: Minion
    amount: number
    aggravated: boolean
}

class CombatPreventDamage extends CombatMutation<CombatPreventDamageParams> {
    getValidity(gameState: GameState) {
        const { minion, amount, aggravated } = this.params
        return canPreventDamage(gameState, minion, amount, aggravated)
    }

    protected move(gameState: GameState) {
        const { minion, amount, aggravated } = this.params
        return preventDamage(gameState, minion, amount, aggravated)
    }
}

// The damage of a human minion is not applied automatically: this applies it on request
class CombatApplyDamage extends CombatMutation<CombatMinionParams> {
    getValidity(gameState: GameState) {
        return canApplyDamage(gameState, this.params.minion)
    }

    protected move(gameState: GameState) {
        return applyDamageNow(gameState, this.params.minion)
    }
}

// Stops the combat on the spot, for the players who resolve it by hand
class CombatEnd extends CombatMutation<EmptyParams> {
    get allowedPlayer() {
        return ANY_PLAYER
    }

    getValidity(gameState: GameState) {
        return gameState.combat ? VALID : Invalid('No combat in progress')
    }

    protected move(gameState: GameState) {
        return endCombatNow(gameState)
    }
}

export const botMutations = {
    attachCard: defineMutation(AttachCard),
    markCardUsed: defineMutation(MarkCardUsed),
    markPlayedSinceUnlock: defineMutation(MarkPlayedSinceUnlock),
    resolvePendingTrigger: defineMutation(ResolvePendingTrigger),
    spendMasterPhaseAction: defineMutation(SpendMasterPhaseAction),
    spendTransfers: defineMutation(SpendTransfers),

    /**
     * Action mutations
     */
    ACTION_armTrigger: defineMutation(ArmTrigger),
    ACTION_changeTarget: defineMutation(ChangeActionTarget),
    ACTION_closePostBlock: defineMutation(ClosePostBlock),
    ACTION_completeDeclaration: defineMutation(CompleteActionDeclaration),
    ACTION_declareActionModifier: defineMutation(DeclareActionModifier),
    ACTION_declareReaction: defineMutation(DeclareReaction),
    ACTION_grantBlockManeuver: defineMutation(GrantBlockManeuver),
    ACTION_resolveAction: defineMutation(ResolveAction),
    ACTION_resolveBlock: defineMutation(ResolveBlock),
    ACTION_wake: defineMutation(WakeMinion),

    /**
     * Combat mutations
     */
    COMBAT_pass: defineMutation(CombatPass),
    COMBAT_maneuver: defineMutation(CombatManeuver),
    COMBAT_chooseStrike: defineMutation(CombatChooseStrike),
    COMBAT_setStrength: defineMutation(CombatSetStrength),
    COMBAT_addStrikes: defineMutation(CombatAddStrikes),
    COMBAT_grapple: defineMutation(CombatGrapple),
    COMBAT_gainBlood: defineMutation(CombatGainBlood),
    COMBAT_takeStrengthBonus: defineMutation(CombatTakeStrengthBonus),
    COMBAT_markPlayed: defineMutation(CombatMarkPlayed),
    COMBAT_press: defineMutation(CombatPress),
    COMBAT_preventDamage: defineMutation(CombatPreventDamage),
    COMBAT_applyDamage: defineMutation(CombatApplyDamage),
    COMBAT_end: defineMutation(CombatEnd),
}

registerMutations(botMutations)
