import { acceptHMRUpdate, defineStore } from 'pinia'
import { EngineOption } from '@/client/engine/protocol.ts'

export type EngineDecision = {
    decision: number
    window: string
    options: EngineOption[]
    // The previous step of this multi-step choice can be taken back
    undo: boolean
}

/**
 * State of a game played with the rules engine ( GameType.Engine ) :
 * the decision the user must take, and the end of the game.
 */
export const useEngineStore = defineStore('engine', {
    state: () => ({
        // The decision the user must take now, if any
        pending: null as EngineDecision | null,
        // Options ( by index ) the user's last move can mean : put forward in the panel
        focus: [] as number[],
        // What the engine is waiting for, when it's not the user
        status: '',
        // Victory points per seat, once the game is over
        result: null as number[] | null,
    }),
})

if (import.meta.hot) {
    import.meta.hot.accept(acceptHMRUpdate(useEngineStore, import.meta.hot))
}
