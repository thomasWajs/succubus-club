import { PlayerVision } from '@/shared/types/state.ts'
import { Card, CounterColor } from '@/shared/model/Card.ts'
import { GameMutationId, GameMutationName } from '@/shared/state/gameMutations.ts'
import { SerializedGameMutation } from '@/shared/types/multiplayer.ts'
import { PlayerOid } from '@/shared/types/model.ts'

export type MutationHistoryEntry = {
    id: GameMutationId
    isIgnoredForCancel: boolean
    isUserCancellable: boolean
    serializedMutation: SerializedGameMutation
}

// A state info shown apart from the log text ( "pool 12", "hand 7" ), or a result ( "d6 4" ).
// The value may hold card and player references ( see LOG_REF_REGEX ). A changed counter also
// has its value before the change ( "pool 15 → 12" )
export type LogDetail = {
    label?: string
    value: string
    from?: string
    // Shown before the value, instead of the label ( the label stays as its tooltip ) : the blood
    // drop, the pool, a counter, the die of a d6...
    icon?: LogDetailIcon
}

// Icon names ( see icons.ts ), and the colored counters ( the counter icon in their color )
export type LogDetailIcon = 'dice' | 'coin' | 'blood' | 'pool' | CounterColor

// An entry shown in the line of an earlier entry rather than in its own : the target, the card
// played and the usage of an action, in the line of its declaration. A silent entry only adds
// to the line, the others replace its text ( they log the whole declaration again )
export type LogFold = {
    into: GameMutationId
    isSilent: boolean
}

// Consecutive counter changes of the same group are shown as a single line ( three "-1 pool"
// clicks read "-3 pool", "+3" then "-1" read "+2" ). The log text holds the place of the amount,
// filled with the total of the group : AMOUNT_LOG_PLACEHOLDER signed, COUNT_LOG_PLACEHOLDER
// unsigned when the text says the way ( "Retro 1" for -1, grouped with the influences ).
// Consecutive draws read "Draw 3 from library" the same way
export type LogGroup = {
    key: string
    amount: number
    // A state switched on and off ( lock then unlock ) : +1 on, -1 off, not in the text. Back to
    // where it started reads "Lock and unlock", muted
    isToggle?: boolean
}

export type LogEntry = {
    text: string
    timestamp: Date
    authorName: string
    authorColorRgba: string
    playerVision?: PlayerVision
    card?: Card
    mutationId?: GameMutationId
    // Game log entries only
    mutationName?: GameMutationName
    // The turn number right after the mutation was applied
    turnNumber?: number
    // The index of the turn phase right after the mutation was applied ( see TurnSequence )
    turnPhaseIndex?: number
    // The player whose turn it is, right after the mutation was applied
    activePlayerOid?: PlayerOid
    cancelsMutationId?: GameMutationId
    // A cancellation applied automatically, to resolve a multiplayer conflict
    resolvesConflict?: boolean
    details?: LogDetail[]
    group?: LogGroup
    fold?: LogFold
}

export type ChatMessage = {
    text: string
    timestamp: Date
    authorName: string
    // Optional : falls back to a neutral colour when the author has no game colour
    // yet ( e.g. chat sent from the game room, before the game starts ).
    authorColorRgba?: string
}
