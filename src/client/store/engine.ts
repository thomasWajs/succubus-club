import { acceptHMRUpdate, defineStore } from 'pinia'
import { EngineAllocation, EngineOption, EngineVotes } from '@/client/engine/protocol.ts'

export type EngineDecision = {
    decision: number
    seat: number // The user's seat : what the options' slots and targets are relative to
    window: string
    options: EngineOption[]
    // What the choice is for, when the options alone do not say ( a referendum's terms )
    prompt?: string
    // The previous step of this multi-step choice can be taken back
    undo: boolean
    // An allocation of points under way : answered whole in the panel
    allocation?: EngineAllocation
    // The votes the user can cast all at once, each way
    votes?: EngineVotes
    // The combat under way, if any
    combat: EngineCombat | null
}

export type EngineCombat = {
    minions: [string, string] // The acting minion's side first
    round: number
    range: string
    // Each side, the acting minion's first ( when the engine tells them )
    sides: EngineCombatSideView[]
}

// A side of the combat : its minion, whether it is the user's, its strike once declared ( its text ),
// its maneuvers and presses for the round
export type EngineCombatSideView = {
    name: string
    own: boolean
    strike?: string
    maneuvers: number
    presses: number
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
        // A choice made on the table, under way : the options ( by index ) still possible
        staging: null as number[] | null,
        // Victory points per seat, once the game is over
        result: null as number[] | null,
        // The referendum under way : its card and the terms chosen, as lines
        terms: [] as string[],
        // The cards played during the action under way, by whom ( the log's line ), until it is over
        played: [] as { decision: number; player: string; text: string; option: EngineOption }[],
    }),
})

if (import.meta.hot) {
    import.meta.hot.accept(acceptHMRUpdate(useEngineStore, import.meta.hot))
}
