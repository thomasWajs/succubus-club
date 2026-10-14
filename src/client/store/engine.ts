import { acceptHMRUpdate, defineStore } from 'pinia'
import type { Allocation, OptionView, VoteTotals, Window } from '@/client/engine/api.ts'

export type EngineDecision = {
    decision: number
    seat: number // The user's seat
    window: Window
    options: OptionView[]
    // What the choice is for, when the options alone do not say ( a referendum's terms )
    prompt?: string | null
    // The previous step of this multi-step choice can be taken back
    undo: boolean
    // An allocation of points under way : answered whole in the panel
    allocation?: Allocation | null
    // The votes the user can cast all at once, each way
    votes?: VoteTotals | null
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
const NOTICE_DURATION = 4000
let noticeTimeout: ReturnType<typeof setTimeout> | undefined

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
        // The referendum card's text : what passing does
        referendumText: '',
        // The cards played during the action under way, by whom ( the log's line ), until it is over
        played: [] as { decision: number; player: string; text: string; option: OptionView }[],
        // The cards on their way to play ( limbo ), by oid : not in play yet
        limbo: [] as string[],
        // During a bleed, its amount ( the engine's, a card's bleed too )
        bleed: null as number | null,
        // During an influence phase, the active seat's transfers left
        transfers: null as number | null,
        // A block's combat is under way ( whoever decides now )
        inCombat: false,
        // Why the user's last move on the table was no decision, for a moment ( beside the Pass )
        notice: '',
    }),
    actions: {
        // Shown a few seconds, a later one replacing it
        tellNotice(message: string) {
            this.notice = message
            clearTimeout(noticeTimeout)
            noticeTimeout = setTimeout(() => (this.notice = ''), NOTICE_DURATION)
        },
    },
})

if (import.meta.hot) {
    import.meta.hot.accept(acceptHMRUpdate(useEngineStore, import.meta.hot))
}
