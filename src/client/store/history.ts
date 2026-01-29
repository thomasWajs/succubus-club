import { acceptHMRUpdate, defineStore } from 'pinia'
import { AnyGameMutation, GameMutationId } from '@/shared/state/gameMutations.ts'
import { useGameStateStore } from '@/client/store/gameState.ts'
import { Player } from '@/shared/model/Player.ts'
import { ChatMessage, LogEntry } from '@/shared/types/history.ts'
import { getPlayerColor } from '@/client/game/utils.ts'

const authorFromPlayer = (player: Player) => ({
    authorName: player.name,
    authorColorRgba: getPlayerColor(player).lighten(50).desaturate(50).rgba,
})

export const useHistoryStore = defineStore('gameHistory', {
    state: () => ({
        logEntries: [] as LogEntry[],
        gameMutations: [] as AnyGameMutation[],
    }),
    getters: {
        gameMutationsMap: state => Object.fromEntries(state.gameMutations.map(m => [m.id, m])),

        cancelledMutations(state): Set<GameMutationId> {
            return new Set(
                state.gameMutations.filter(m => m.cancelsMutationId).map(m => m.cancelsMutationId),
            ) as Set<GameMutationId>
        },

        nextCancellableMutation(state): AnyGameMutation | null {
            const gameState = useGameStateStore()

            // Search for the latest mutation that can be cancelled
            for (let i = state.gameMutations.length - 1; i >= 0; i--) {
                const mutation = state.gameMutations[i] as AnyGameMutation

                // Some mutations are totally ignored for cancels
                if (mutation.isIgnoredForCancel) {
                    continue
                }

                // Stop there if mutation is not cancellable
                if (!mutation.isUserCancellable) {
                    return null
                }

                // Continue if already cancelled, or already a cancelling mutation
                if (mutation.cancelsMutationId || this.cancelledMutations.has(mutation.id)) {
                    continue
                }

                if (mutation.author != gameState.selfPlayer) {
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
            this.gameMutations.push(gameMutation)

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

            this.logEntries.push({
                text,
                timestamp: gameMutation.timestamp,
                authorName,
                authorColorRgba,
                cancelText,
                playerVision: gameMutation.playerVision,
                card: gameMutation.card ?? undefined,
                mutationId: gameMutation.id,
            })
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
