import { BotOption, DecisionKind } from '@/shared/bot/types.ts'

/**
 * The trace of a decision of the utility agent, for development only ( the final product does not
 * show the read of a bot ): what was chosen, and how each candidate was scored.
 */
export type ExplainCandidate = {
    option: BotOption
    score: number
    // The terms of the score, by name
    parts: Record<string, number>
}

export type ExplainEntry = {
    player: string
    kind: DecisionKind
    chosen: BotOption
    // Best first. Empty when nothing was weighed ( a window that is passed ).
    candidates: ExplainCandidate[]
    note?: string
}

export type ExplainSink = (entry: ExplainEntry) => void
