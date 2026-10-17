import { useHistoryStore } from '@/client/store/history.ts'
import {
    createLedger,
    foldMutation,
    rebuildLedger,
    TableLedger,
} from '@/shared/bot/utility/ledger.ts'
import { HistoryStore } from '@/shared/state/history.ts'
import { AnyGameMutation } from '@/shared/state/mutationBase.ts'
import { GameId } from '@/shared/types/model.ts'
import * as logging from '@/client/logging.ts'

// What the table did, shared by the bots of the game. Kept out of the stores on purpose: it is
// folded after every mutation and nothing in the UI reads it.
let tableLedger: TableLedger = createLedger()

export function getTableLedger(): TableLedger {
    return tableLedger
}

export function resetTableLedger() {
    tableLedger = createLedger()
}

export function foldAppliedMutation(mutation: AnyGameMutation) {
    foldMutation(tableLedger, mutation)
}

// A restored game: the ledger comes back from the history that was saved with it
export function rebuildTableLedger(gameId: GameId) {
    try {
        tableLedger = rebuildLedger(useHistoryStore() as HistoryStore, gameId)
    } catch (error) {
        logging.captureException(error)
        resetTableLedger()
    }
}
