import { GovernAgent } from '@/shared/bot/agents/governAgent.ts'
import { BotAgent, BotContext, BotOption, DecisionPoint } from '@/shared/bot/types.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { BotProfile, DEFAULT_PROFILE } from '@/shared/bot/utility/profile.ts'
import { createLedger, TableLedger } from '@/shared/bot/utility/ledger.ts'
import { ExplainSink } from '@/shared/bot/utility/explain.ts'
import { Assessment, assess } from '@/shared/bot/utility/assessment.ts'

// Everything a decision may read, and nothing else: the view of the game ( in the decision ), what the
// table did, and what the bot knows of itself. Plans are functions of this, no state is kept between
// two decisions.
export type DecisionContext = {
    decision: DecisionPoint
    // The table as this player sees it, read once for the decision
    assessment: Assessment
    ledger: TableLedger
    // The bot's OWN decklist: a player knows its deck, never the ones of the others
    deck: DeckList
    profile: BotProfile
}

/**
 * The utility bot of Phase 3 ( see .claude/docs/bot-ai-phase3.md ). The scorer takes over decision
 * kind by decision kind; the kinds it does not handle yet go to the fallback agent ( the Govern rules
 * by default: the base agent never plays, so no game would end ).
 */
export class UtilityAgent implements BotAgent {
    constructor(
        readonly deck: DeckList,
        readonly profile: BotProfile = DEFAULT_PROFILE,
        private readonly explain?: ExplainSink,
        private readonly fallback: BotAgent = new GovernAgent(),
    ) {}

    choose(decision: DecisionPoint, context?: BotContext): BotOption {
        const option = this.decide({
            decision,
            assessment: assess(decision.player.gameState, decision.player, this.profile),
            ledger: context?.ledger ?? createLedger(),
            deck: this.deck,
            profile: this.profile,
        })
        this.explain?.({
            player: decision.player.name,
            kind: decision.kind,
            chosen: option,
            candidates: [],
            note: 'fallback rules',
        })
        return option
    }

    private decide(context: DecisionContext): BotOption {
        return this.fallback.choose(context.decision)
    }
}
