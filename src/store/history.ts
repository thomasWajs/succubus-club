import { acceptHMRUpdate, defineStore } from 'pinia'
import { Card } from '@/model/Card.ts'
import { AnyGameMutation, GameMutationId } from '@/state/gameMutations.ts'
import { useGameStateStore } from '@/store/gameState.ts'
import { Player } from '@/model/Player.ts'

export type LogEntry = {
    text: string
    timestamp: Date
    authorName: string
    authorColorRgba: string
    cancelText?: string
    closeUpCard?: Card
    mutationId?: GameMutationId
}

export type ChatMessage = {
    text: string
    timestamp: Date
    player: Player
}

export const useHistoryStore = defineStore('gameHistory', {
    state: () => ({
        logEntries: [] as LogEntry[],
        gameMutations: [] as AnyGameMutation[],
    }),
    getters: {
        orderedLogEntries: state =>
            state.logEntries.toSorted((e1, e2) => e1.timestamp.getTime() - e2.timestamp.getTime()),

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

                // Card moves are ignored
                if (mutation.name == 'moveCard') {
                    continue
                }

                // Stop there if mutation is not cancellable,
                // ( except for card moves which are ignored )
                if (!mutation.isCancellable) {
                    return null
                }

                // Continue if already cancelled, or already a cancelling mutation
                if (mutation.cancelsMutationId || this.cancelledMutations.has(mutation.id)) {
                    continue
                }

                // If we found a cancellable mutation AND self player is the author, returns it
                return mutation.author == gameState.selfPlayer ? mutation : null
            }
            return null
        },
    },
    actions: {
        addLogEntry(
            text: string,
            timestamp: Date,
            player: Player,
            cancelText?: string,
            closeUpCard?: Card,
            mutationId?: GameMutationId,
        ) {
            this.logEntries.push({
                text,
                cancelText,
                timestamp,
                authorName: player.name,
                authorColorRgba: player.color.clone().lighten(50).desaturate(50).rgba,
                closeUpCard,
                mutationId,
            })
        },

        addGameMutation(gameMutation: AnyGameMutation) {
            this.gameMutations.push(gameMutation)
            if (gameMutation.cancelsMutationId) {
                this.cancelledMutations.add(gameMutation.cancelsMutationId)
            }

            const text = gameMutation.formatForLog()
            let cancelText, closeUpCard
            if (text) {
                if (gameMutation.cancelsMutationId) {
                    const cancelledMutation = this.gameMutationsMap[gameMutation.cancelsMutationId]
                    if (cancelledMutation) {
                        // Find the text at the moment the mutation was applied
                        cancelText = this.logEntries.find(
                            l => l.mutationId == cancelledMutation.id,
                        )?.text
                        // strip tags from cancel text
                        cancelText = cancelText?.replace(/<\/?[^>]+(>|$)/g, '')
                    }
                }

                if (gameMutation.canSeeTargetCard) {
                    closeUpCard = gameMutation.targetCard ?? undefined
                }

                this.addLogEntry(
                    text,
                    gameMutation.timestamp,
                    gameMutation.author,
                    cancelText,
                    closeUpCard,
                    gameMutation.id,
                )
            }
        },
        addChatMessage(chatMessage: ChatMessage) {
            this.addLogEntry(chatMessage.text, chatMessage.timestamp, chatMessage.player)
        },
    },
})

export type HistoryStore = ReturnType<typeof useHistoryStore>
export type History = HistoryStore['$state']
export type HistoryKey = keyof History

if (import.meta.hot) {
    import.meta.hot.accept(acceptHMRUpdate(useHistoryStore, import.meta.hot))
}
