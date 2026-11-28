import { Player } from '@/shared/model/Player.ts'
import { GameId } from '@/shared/types/model.ts'
import { getMutationTrigger } from '@/shared/registries.ts'
import {
    AnyGameMutation,
    GameMutation,
    GameMutationId,
    GameMutationParams,
} from '@/shared/state/mutations/base.ts'
import {
    BecomeMinion,
    BecomeVampire,
    BecomeVampireInverse,
    Reveal,
    SetFlip,
    SetLock,
    TakeControl,
    TakeRegionControl,
    UnlockAll,
    UnlockAllInverse,
} from '@/shared/state/mutations/cardState.ts'
import {
    ChangeBlood,
    ChangeCardAttribute,
    ChangeCounter,
    ChangeMarker,
    ChangePool,
    Influence,
} from '@/shared/state/mutations/resources.ts'
import {
    ChangeTheEdgeControl,
    GoToTurn,
    GoToTurnPhase,
    RandomResult,
    SecretAnnounce,
    SecretReveal,
} from '@/shared/state/mutations/gameFlow.ts'
import {
    Discard,
    DiscardAtRandom,
    DrawCrypt,
    DrawLibrary,
    MoveCard,
    MoveCardToRegion,
    MoveToBottom,
    PlayFaceDown,
    PlayFaceDownInverse,
    Shuffle,
} from '@/shared/state/mutations/cardMovement.ts'
import {
    ChangeActionProperty,
    DeclareAction,
    DeclareActionInverse,
    DeclareActionModifier,
    DeclareBlock,
    DeclareReaction,
    EndAction,
    ResolveAction,
    ResolveBlock,
    UpdateActionUsage,
} from '@/shared/state/mutations/action.ts'
import {
    CallReferendum,
    CastReferendumVote,
    ChangePlayerVotes,
    ChangeReferendumVotes,
    CloseReferendum,
    InterruptReferendumLastCall,
    StartReferendumLastCall,
} from '@/shared/state/mutations/referendum.ts'
import {
    AddTargetDeclaration,
    ChangeScale,
    ChangeSeparators,
    ChangeTargetDeclaration,
    PauseTimer,
    PingCard,
    RemoveTargetDeclaration,
    StartTimer,
} from '@/shared/state/mutations/ui.ts'
import {
    FreeTableDrawCrypt,
    MovePlayerWidget,
    MoveTheEdgeWidget,
} from '@/shared/state/mutations/freeTable.ts'

export { GameMutation } from '@/shared/state/mutations/base.ts'
export type {
    AnyGameMutation,
    CardMovement,
    GameMutationId,
    GameMutationParams,
    GameMutationName,
} from '@/shared/state/mutations/base.ts'
export { PingCard } from '@/shared/state/mutations/ui.ts'
export { ResolveAction, ResolveBlock } from '@/shared/state/mutations/action.ts'

/**
 * Mutation handling
 *
 * The mutation classes are in `mutations/`, and call this registry back to create their cancel
 * mutations. Import them from this file only, never from `mutations/` : a file of it loaded
 * first would have this registry define a class that isn't initialized yet.
 */

/**
 * Factory function to creates a new instance of a game mutation object.
 */
export function createMutation<
    ParamsType extends GameMutationParams,
    GMClass extends GameMutation<ParamsType>,
>(
    gameMutationClass: GameMutationClassType<ParamsType, GMClass>,
    author: Player,
    params: ParamsType,
    cancelsMutationId?: GameMutationId,
) {
    if (!params) {
        params = {} as ParamsType
    }
    return new gameMutationClass(author.gameId, params, new Date(), author, cancelsMutationId)
}

/**
 * Constructor of GameMutation, needed for typescript annotations
 */
export type GameMutationClassType<
    ParamsType extends GameMutationParams,
    GMClass extends GameMutation<ParamsType>,
> = new (
    gameId: GameId,
    params: ParamsType,
    timestamp: Date,
    author: Player,
    cancelsMutationId?: GameMutationId,
) => GMClass

/**
 * Mutation definition
 */
function defineMutation<
    ParamsType extends GameMutationParams,
    GMClass extends GameMutation<ParamsType>,
>(gameMutationClass: GameMutationClassType<ParamsType, GMClass>) {
    return {
        gameMutationClass,
        createMutation: (author: Player, params: ParamsType) =>
            createMutation(gameMutationClass, author, params),
        createCancelMutation: (cancels: AnyGameMutation, params: ParamsType) =>
            // Can only cancel own actions, so cancels.author is always selfPlayer
            createMutation(gameMutationClass, cancels.author, params, cancels.id),
        act: (author: Player, params: ParamsType) =>
            getMutationTrigger().act(gameMutationClass, author, params),
        actSelf: (params: ParamsType) => getMutationTrigger().actSelf(gameMutationClass, params),
    }
}

export const gameMutations = {
    becomeMinion: defineMutation(BecomeMinion),
    becomeVampire: defineMutation(BecomeVampire),
    becomeVampireInverse: defineMutation(BecomeVampireInverse),
    changeBlood: defineMutation(ChangeBlood),
    changeCardAttribute: defineMutation(ChangeCardAttribute),
    changeCounter: defineMutation(ChangeCounter),
    changeMarker: defineMutation(ChangeMarker),
    changePool: defineMutation(ChangePool),
    changeTheEdgeControl: defineMutation(ChangeTheEdgeControl),
    discard: defineMutation(Discard),
    discardAtRandom: defineMutation(DiscardAtRandom),
    drawLibrary: defineMutation(DrawLibrary),
    drawCrypt: defineMutation(DrawCrypt),
    goToTurnPhase: defineMutation(GoToTurnPhase),
    goToTurn: defineMutation(GoToTurn),
    influence: defineMutation(Influence),
    moveCard: defineMutation(MoveCard),
    moveCardToRegion: defineMutation(MoveCardToRegion),
    moveToBottom: defineMutation(MoveToBottom),
    playFaceDown: defineMutation(PlayFaceDown),
    playFaceDownInverse: defineMutation(PlayFaceDownInverse),
    reveal: defineMutation(Reveal),
    randomResult: defineMutation(RandomResult),
    secretAnnounce: defineMutation(SecretAnnounce),
    secretReveal: defineMutation(SecretReveal),
    setFlip: defineMutation(SetFlip),
    setLock: defineMutation(SetLock),
    shuffle: defineMutation(Shuffle),
    takeControl: defineMutation(TakeControl),
    takeRegionControl: defineMutation(TakeRegionControl),
    unlockAll: defineMutation(UnlockAll),
    unlockAllInverse: defineMutation(UnlockAllInverse),

    /**
     * Action mutations
     */
    ACTION_changeProperty: defineMutation(ChangeActionProperty),
    ACTION_declareAction: defineMutation(DeclareAction),
    ACTION_declareActionInverse: defineMutation(DeclareActionInverse),
    ACTION_updateUsage: defineMutation(UpdateActionUsage),
    ACTION_declareActionModifier: defineMutation(DeclareActionModifier),
    ACTION_declareBlock: defineMutation(DeclareBlock),
    ACTION_declareReaction: defineMutation(DeclareReaction),
    ACTION_endAction: defineMutation(EndAction),
    ACTION_resolveAction: defineMutation(ResolveAction),
    ACTION_resolveBlock: defineMutation(ResolveBlock),

    /**
     * Referendum mutations
     */
    REFERENDUM_call: defineMutation(CallReferendum),
    REFERENDUM_close: defineMutation(CloseReferendum),
    REFERENDUM_castVote: defineMutation(CastReferendumVote),
    REFERENDUM_changeVotes: defineMutation(ChangeReferendumVotes),
    REFERENDUM_changePlayerVotes: defineMutation(ChangePlayerVotes),
    REFERENDUM_startLastCall: defineMutation(StartReferendumLastCall),
    REFERENDUM_interruptLastCall: defineMutation(InterruptReferendumLastCall),

    /**
     * UI mutations
     */
    UI_addTargetDeclaration: defineMutation(AddTargetDeclaration),
    UI_removeTargetDeclaration: defineMutation(RemoveTargetDeclaration),
    UI_changeTargetDeclaration: defineMutation(ChangeTargetDeclaration),
    UI_changeScale: defineMutation(ChangeScale),
    UI_changeSeparators: defineMutation(ChangeSeparators),
    UI_startTimer: defineMutation(StartTimer),
    UI_pauseTimer: defineMutation(PauseTimer),
    UI_pingCard: defineMutation(PingCard),

    /**
     * Free Table mutations
     */
    FT_movePlayerWidget: defineMutation(MovePlayerWidget),
    FT_moveTheEdgeWidget: defineMutation(MoveTheEdgeWidget),
    FT_drawCrypt: defineMutation(FreeTableDrawCrypt),
}

// Set mutation name on each GameMutation subclasses
for (const [mutationName, mutationDefinition] of Object.entries(gameMutations)) {
    mutationDefinition.gameMutationClass.prototype.mutationName = mutationName
}
