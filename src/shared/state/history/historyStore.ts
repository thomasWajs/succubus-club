import { AnyGameMutation, GameMutationId } from '@/shared/state/gameMutations.ts'
import { ChatMessage, LogEntry, MutationHistoryEntry } from '@/shared/types/history.ts'
import {
    authorFromPlayer,
    DEFAULT_CHAT_AUTHOR_COLOR_RGBA,
    getActionLineFold,
    secureLogDetails,
    secureLogRefs,
} from '@/shared/state/history/logEntries.ts'
import {
    deserializeHistory,
    serializeGameMutation,
    serializeHistory,
} from '@/shared/serialization.ts'
import { SerializedHistory } from '@/shared/types/multiplayer.ts'
import { GameId, PlayerOid } from '@/shared/types/model.ts'
import LZString from 'lz-string'
import { getLogger } from '@/shared/registries.ts'

const HISTORY_ARCHIVE_THRESHOLD = 150
const HISTORY_KEEP_RECENT = 100

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

        const gameState = gameMutation.gameState
        const unsecuredText = gameMutation.formatForLog()
        if (unsecuredText) {
            const text = secureLogRefs(unsecuredText, gameState)
            let resolvesConflict: boolean | undefined
            let { authorName, authorColorRgba } = authorFromPlayer(gameMutation.author)

            const cancelsMutationId = gameMutation.cancelsMutationId
            if (
                cancelsMutationId &&
                gameMutation.cancelToResolveConflict &&
                this.gameMutations.some(m => m.id == cancelsMutationId)
            ) {
                authorName = 'Conflict resolver'
                authorColorRgba = 'rgba(255, 0, 0, 0.5)'
                resolvesConflict = true
            }

            let logEntry: LogEntry = {
                text,
                timestamp: gameMutation.timestamp,
                authorName,
                authorColorRgba,
                playerVision: gameMutation.playerVision,
                card: gameMutation.card ?? undefined,
                mutationId: gameMutation.id,
                mutationName: gameMutation.name,
                turnNumber: gameState.turnNumber,
                turnPhaseIndex: gameState.turnPhaseIndex,
                activePlayerOid: gameState.activePlayer?.oid,
                cancelsMutationId: gameMutation.cancelsMutationId,
                resolvesConflict,
                details: secureLogDetails(gameMutation.formatLogDetails(), gameState),
                group: gameMutation.logGroup ?? undefined,
                fold: getActionLineFold(gameMutation, this.logEntries),
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
            authorName: chatMessage.authorName,
            authorColorRgba: chatMessage.authorColorRgba ?? DEFAULT_CHAT_AUTHOR_COLOR_RGBA,
        })
    }

    // Chat entries are the log entries without a mutationId ( game log entries always
    // carry one ). Used to carry game room chat across the game-start reset.
    get chatLogEntries(): LogEntry[] {
        return this.logEntries.filter(logEntry => logEntry.mutationId === undefined)
    }

    // Drop the chat entries while keeping the game log intact.
    clearChat(): void {
        for (let i = this.logEntries.length - 1; i >= 0; i--) {
            if (this.logEntries[i].mutationId === undefined) {
                this.logEntries.splice(i, 1)
            }
        }
    }

    setArchiveHistory(archivedHistory: HistoryStore) {
        try {
            const serializedArchive = serializeHistory(archivedHistory, false)
            // Don't use LZString.compress, as the resulting string won't pass correctly on the network
            this.archive = LZString.compressToUTF16(JSON.stringify(serializedArchive))
        } catch (error) {
            getLogger().captureException(error)
        }
    }

    getArchivedHistory(gameId: GameId): HistoryStore {
        const archivedHistory: HistoryStore = new HistoryStore()

        try {
            if (this.archive !== '') {
                const decompressedArchive = LZString.decompressFromUTF16(this.archive)
                const serializedArchive: SerializedHistory = JSON.parse(decompressedArchive)
                deserializeHistory(gameId, serializedArchive, archivedHistory)
            }
        } catch (error) {
            getLogger().captureException(error)
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
