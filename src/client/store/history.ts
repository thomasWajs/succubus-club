import { markRaw } from 'vue'
import { acceptHMRUpdate } from 'pinia'
import { defineOptionStore } from 'pinia-class-transformer'
import { HistoryStore } from '@/shared/state/history.ts'
import { joinsUndoGroup } from '@/shared/state/logEntries.ts'
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

    /**
     * What Undo cancels : the next cancellable mutation, plus the counter changes it's grouped
     * with in the log ( three "-1 pool" clicks are undone together ), or the mutation a silent
     * one completes ( the target arrow and the card played with an action declaration ). Latest
     * first.
     */
    get nextUndoGroup(): MutationHistoryEntry[] {
        const last = this.nextCancellableMutation
        if (!last) {
            return []
        }
        const group = [last]
        const index = this.logEntries.findIndex(entry => entry.mutationId === last.id)
        const cancelledMutations = this.cancelledMutations
        const gameMutationsMap = this.gameMutationsMap

        for (let i = index; i > 0; i--) {
            const entry = this.logEntries[i]
            const previous = this.logEntries[i - 1]
            if (
                previous.mutationId === undefined ||
                !joinsUndoGroup(previous, entry) ||
                cancelledMutations.has(previous.mutationId)
            ) {
                break
            }
            const mutation = gameMutationsMap[previous.mutationId]
            if (
                !mutation?.isUserCancellable ||
                mutation.serializedMutation.authorOid != last.serializedMutation.authorOid
            ) {
                break
            }
            group.push(mutation)
        }
        return group
    }

    addGameMutation(gameMutation: AnyGameMutation) {
        super.addGameMutation(gameMutation, markRaw)
    }
}

export const useHistoryStore = defineOptionStore('history', ClientHistoryStore)

if (import.meta.hot) {
    import.meta.hot.accept(acceptHMRUpdate(useHistoryStore, import.meta.hot))
}
