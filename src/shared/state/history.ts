import { AnyGameMutation, GameMutationId } from '@/shared/state/gameMutations.ts'
import { Player } from '@/shared/model/Player.ts'
import { ChatMessage, LogEntry, MutationHistoryEntry } from '@/shared/types/history.ts'
import { serializeGameMutation } from '@/shared/serialization.ts'
import { getAuthorColorRgba } from '@/shared/colors.ts'

const authorFromPlayer = (player: Player) => ({
    authorName: player.name,
    authorColorRgba: getAuthorColorRgba(player.rgbaColor),
})

type Transformer = <T extends object>(value: T) => T

export class HistoryStore {
    logEntries: LogEntry[] = []
    gameMutations: MutationHistoryEntry[] = []

    // Getters

    get gameMutationsMap(): Record<GameMutationId, MutationHistoryEntry> {
        return Object.fromEntries(this.gameMutations.map(m => [m.id, m]))
    }

    get cancelledMutations(): Set<GameMutationId> {
        return new Set(
            this.gameMutations
                .filter(m => m.serializedMutation.cancelsMutationId)
                .map(m => m.serializedMutation.cancelsMutationId),
        ) as Set<GameMutationId>
    }

    // Methods

    addGameMutation(gameMutation: AnyGameMutation, transformer?: Transformer): void {
        // gameMutations and logEntries are both append-only & read-only,
        // so use markRaw to enhance performances

        let mutation = {
            id: gameMutation.id,
            isUserCancellable: gameMutation.isUserCancellable,
            isIgnoredForCancel: gameMutation.isIgnoredForCancel,
            serializedMutation: serializeGameMutation(gameMutation),
        }
        if (transformer) {
            mutation = transformer(mutation)
        }

        this.gameMutations.push(mutation)

        const text = gameMutation.formatForLog()
        if (!text) {
            return
        }

        let cancelText: string | undefined
        let { authorName, authorColorRgba } = authorFromPlayer(gameMutation.author)

        if (gameMutation.cancelsMutationId) {
            const cancelledMutation = this.gameMutationsMap[gameMutation.cancelsMutationId]
            if (cancelledMutation) {
                // Find the text at the moment the mutation was applied
                cancelText = this.logEntries.find(l => l.mutationId == cancelledMutation.id)?.text
                // strip tags from cancel text
                cancelText = cancelText?.replace(/<\/?[^>]+(>|$)/g, '')

                if (gameMutation.cancelToResolveConflict) {
                    authorName = 'Conflict resolver'
                    authorColorRgba = 'rgba(255, 0, 0, 0.5)'
                }
            }
        }

        let logEntry = {
            text,
            timestamp: gameMutation.timestamp,
            authorName,
            authorColorRgba,
            cancelText,
            playerVision: gameMutation.playerVision,
            card: gameMutation.card ?? undefined,
            mutationId: gameMutation.id,
        }
        if (transformer) {
            logEntry = transformer(logEntry)
        }
        this.logEntries.push(logEntry)
    }

    addChatMessage(chatMessage: ChatMessage): void {
        this.logEntries.push({
            text: chatMessage.text,
            timestamp: chatMessage.timestamp,
            ...authorFromPlayer(chatMessage.player),
        })
    }
}
