import { Player } from '@/shared/model/Player.ts'
import { PlayerVision } from '@/shared/types/state.ts'
import { Card } from '@/shared/model/Card.ts'
import { GameMutationId } from '@/shared/state/gameMutations.ts'
import { SerializedGameMutation } from '@/shared/types/multiplayer.ts'

export type MutationHistoryEntry = {
    id: GameMutationId
    isIgnoredForCancel: boolean
    isUserCancellable: boolean
    serializedMutation: SerializedGameMutation
}

export type LogEntry = {
    text: string
    timestamp: Date
    authorName: string
    authorColorRgba: string
    cancelText?: string
    playerVision?: PlayerVision
    card?: Card
    mutationId?: GameMutationId
}

export type ChatMessage = {
    text: string
    timestamp: Date
    player: Player
}
