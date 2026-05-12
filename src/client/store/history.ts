import { markRaw } from 'vue'
import { acceptHMRUpdate } from 'pinia'
import { defineOptionStore } from 'pinia-class-transformer'
import { HistoryStore } from '@/shared/state/history.ts'
import { MutationHistoryEntry } from '@/shared/types/history.ts'
import { usePlayersStore } from '@/client/state/players.ts'
import { AnyGameMutation } from '@/shared/state/gameMutations.ts'

export class ClientHistoryStore extends HistoryStore {
    get nextCancellableMutation(): MutationHistoryEntry | null {
        const players = usePlayersStore()

        // Search for the latest mutation that can be cancelled
        for (let i = this.gameMutations.length - 1; i >= 0; i--) {
            const mutation = this.gameMutations[i]

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

            if (mutation.serializedMutation.authorOid != players.selfPlayer?.oid) {
                continue
            }

            // We found a cancellable mutation
            return mutation
        }
        return null
    }

    addGameMutation(gameMutation: AnyGameMutation) {
        super.addGameMutation(gameMutation, markRaw)
    }
}

export const useHistoryStore = defineOptionStore('useHistoryStore', ClientHistoryStore)

if (import.meta.hot) {
    import.meta.hot.accept(acceptHMRUpdate(useHistoryStore, import.meta.hot))
}
