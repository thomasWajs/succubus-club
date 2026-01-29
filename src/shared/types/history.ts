import { Player } from '@/shared/model/Player.ts'
import { PlayerVision } from '@/shared/types/state.ts'
import { Card } from '@/shared/model/Card.ts'
import { GameMutationId } from '@/shared/state/gameMutations.ts'

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
