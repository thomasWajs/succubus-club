import { AnyGameMutation, GameMutationId } from '@/shared/state/gameMutations.ts'
import { Player } from '@/shared/model/Player.ts'
import { ChatMessage, LogEntry, MutationHistoryEntry } from '@/shared/types/history.ts'
import {
    deserializeHistory,
    serializeGameMutation,
    serializeHistory,
} from '@/shared/serialization.ts'
import { getAuthorColorRgba } from '@/shared/colors.ts'
import { SerializedHistory } from '@/shared/types/multiplayer.ts'
import { GameId, PlayerOid } from '@/shared/types/model.ts'
import LZString from 'lz-string'

const HISTORY_ARCHIVE_THRESHOLD = 150
const HISTORY_KEEP_RECENT = 100

const authorFromPlayer = (player: Player) => ({
    authorName: player.name,
    authorColorRgba: getAuthorColorRgba(player.rgbaColor),
})

type Transformer = <T extends object>(value: T) => T

export class HistoryStore {
    logEntries: LogEntry[] = []
    // Don't store GameMutations directly, there's too much overhead and leads to memory ballooning
    gameMutations: MutationHistoryEntry[] = []
    // Archive old history as a gigantic compacted ( lz-string ) serialized json
    archive = ''

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
        if (text) {
            let cancelText: string | undefined
            let { authorName, authorColorRgba } = authorFromPlayer(gameMutation.author)

            if (gameMutation.cancelsMutationId) {
                const cancelledMutation = this.gameMutationsMap[gameMutation.cancelsMutationId]
                if (cancelledMutation) {
                    // Find the text at the moment the mutation was applied
                    cancelText = this.logEntries.find(
                        l => l.mutationId == cancelledMutation.id,
                    )?.text
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

        // Check if archiving is needed
        if (
            this.logEntries.length > HISTORY_ARCHIVE_THRESHOLD ||
            this.gameMutations.length > HISTORY_ARCHIVE_THRESHOLD
        ) {
            this.archiveOldHistory(gameMutation.gameId)
        }
    }

    addChatMessage(chatMessage: ChatMessage): void {
        this.logEntries.push({
            text: chatMessage.text,
            timestamp: chatMessage.timestamp,
            ...authorFromPlayer(chatMessage.player),
        })
    }

    setArchiveHistory(archivedHistory: HistoryStore) {
        const serializedArchive = serializeHistory(archivedHistory, false)
        this.archive = LZString.compress(JSON.stringify(serializedArchive))
    }

    getArchivedHistory(gameId: GameId): HistoryStore {
        const archivedHistory: HistoryStore = new HistoryStore()
        if (this.archive !== '') {
            const decompressedArchive = LZString.decompress(this.archive)
            const serializedArchive: SerializedHistory = JSON.parse(decompressedArchive)
            deserializeHistory(gameId, serializedArchive, archivedHistory)
        }
        return archivedHistory
    }

    archiveOldHistory(gameId: GameId) {
        // 1. Deserialize existing archive
        const archivedHistory = this.getArchivedHistory(gameId)

        // 2. Append older entries to archive
        const logEntriesToArchive = this.logEntries.slice(
            0,
            Math.max(0, this.logEntries.length - HISTORY_KEEP_RECENT),
        )
        archivedHistory.logEntries.push(...logEntriesToArchive)

        const gameMutationsToArchive = this.gameMutations.slice(
            0,
            Math.max(0, this.gameMutations.length - HISTORY_KEEP_RECENT),
        )
        archivedHistory.gameMutations.push(...gameMutationsToArchive)

        // 3. Re-serialize archive with the new entries, and without embedding our own archive
        this.setArchiveHistory(archivedHistory)

        // 4. Remove older entries from active history
        this.logEntries = this.logEntries.slice(-HISTORY_KEEP_RECENT)
        this.gameMutations = this.gameMutations.slice(-HISTORY_KEEP_RECENT)
    }

    getLastMutationForPlayer(playerOid: PlayerOid): MutationHistoryEntry | undefined {
        for (let i = this.gameMutations.length - 1; i >= 0; i--) {
            const mutation = this.gameMutations[i]
            if (mutation.serializedMutation.authorOid == playerOid) {
                return mutation
            }
        }
    }
}
