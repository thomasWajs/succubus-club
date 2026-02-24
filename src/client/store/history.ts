import { markRaw } from 'vue'
import { acceptHMRUpdate, defineStore } from 'pinia'
import { AnyGameMutation, GameMutationId } from '@/shared/state/gameMutations.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { Player } from '@/shared/model/Player.ts'
import { ChatMessage, LogEntry, MutationHistoryEntry } from '@/shared/types/history.ts'
import { getPlayerColor } from '@/client/game/utils.ts'
import { serializeGameMutation } from '@/shared/serialization.ts'

const authorFromPlayer = (player: Player) => ({
    authorName: player.name,
    authorColorRgba: getPlayerColor(player).lighten(50).desaturate(50).rgba,
})

export const useHistoryStore = defineStore('gameHistory', {
    state: () => ({
        logEntries: [] as LogEntry[],
        // Don't store GameMutations directly, there's too much overhead and leads to memory ballooning
        gameMutations: [] as MutationHistoryEntry[],
    }),
    getters: {
        // @ts-expect-error typescript can't infer the type because of Serialized<GameMutationParams>
        gameMutationsMap: state => Object.fromEntries(state.gameMutations.map(m => [m.id, m])),

        cancelledMutations(state): Set<GameMutationId> {
            return new Set(
                state.gameMutations
                    .filter(m => m.serializedMutation.cancelsMutationId)
                    .map(m => m.serializedMutation.cancelsMutationId),
            ) as Set<GameMutationId>
        },

        nextCancellableMutation(state): MutationHistoryEntry | null {
            const gameState = useGameStateStore()

            // Search for the latest mutation that can be cancelled
            for (let i = state.gameMutations.length - 1; i >= 0; i--) {
                const mutation = state.gameMutations[i]

                // Some mutations are totally ignored for cancels
                if (mutation.isIgnoredForCancel) {
                    continue
                }

                // Stop there if mutation is not cancellable
                if (!mutation.isUserCancellable) {
                    return null
                }

                // Continue if already cancelled, or already a cancelling mutation
                if (
                    mutation.serializedMutation.cancelsMutationId ||
                    this.cancelledMutations.has(mutation.id)
                ) {
                    continue
                }

                if (mutation.serializedMutation.authorOid != gameState.selfPlayer?.oid) {
                    continue
                }

                // We found a cancellable mutation
                return mutation
            }
            return null
        },
    },
    actions: {
        addGameMutation(gameMutation: AnyGameMutation) {
            // gameMutations and logEntries are both append-only & read-only,
            // so use markRaw to enhance performances

            this.gameMutations.push(
                markRaw({
                    id: gameMutation.id,
                    isUserCancellable: gameMutation.isUserCancellable,
                    isIgnoredForCancel: gameMutation.isIgnoredForCancel,
                    serializedMutation: serializeGameMutation(gameMutation),
                }),
            )

            const text = gameMutation.formatForLog()
            if (!text) {
                return
            }

            let cancelText
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

            this.logEntries.push(
                markRaw({
                    text,
                    timestamp: gameMutation.timestamp,
                    authorName,
                    authorColorRgba,
                    cancelText,
                    playerVision: gameMutation.playerVision,
                    card: gameMutation.card ?? undefined,
                    mutationId: gameMutation.id,
                }),
            )
        },
        addChatMessage(chatMessage: ChatMessage) {
            this.logEntries.push({
                text: chatMessage.text,
                timestamp: chatMessage.timestamp,
                ...authorFromPlayer(chatMessage.player),
            })
        },
    },
})

if (import.meta.hot) {
    import.meta.hot.accept(acceptHMRUpdate(useHistoryStore, import.meta.hot))
}
