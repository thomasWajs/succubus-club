import { GovernAgent } from '@/shared/bot/agents/governAgent.ts'
import {
    BotAgent,
    BotContext,
    BotOption,
    DecisionKind,
    DecisionPoint,
    optionsOfType,
} from '@/shared/bot/types.ts'
import { DeckList } from '@/shared/types/gateway.ts'
import { CardOid } from '@/shared/types/model.ts'
import { BotProfile, DEFAULT_PROFILE } from '@/shared/bot/utility/profile.ts'
import { createLedger, TableLedger } from '@/shared/bot/utility/ledger.ts'
import { ExplainCandidate, ExplainSink } from '@/shared/bot/utility/explain.ts'
import { Assessment, assess } from '@/shared/bot/utility/assessment.ts'
import { unlockCardsOf } from '@/shared/bot/utility/defence.ts'
import { readyMinions } from '@/shared/bot/utility/snapshot.ts'
import { Candidate, candidateOf, planTurn, TurnPlan } from '@/shared/bot/utility/turnPlan.ts'
import { describeTurnPlan } from '@/shared/bot/utility/describeAssessment.ts'

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

// What the agent chose, and how it got there ( the explain trace )
type Choice = {
    option: BotOption
    note: string
    candidates?: ExplainCandidate[]
}

/**
 * The utility bot of Phase 3 ( see .claude/docs/bot-ai-phase3.md ). The scorer takes over decision
 * kind by decision kind; the kinds it does not handle yet go to the fallback agent ( the Govern rules
 * by default: the base agent never plays, so no game would end ). The minion phase is the turn plan's:
 * who stays unlocked to defend, who bleeds, hunts or rescues. The action cards of the hand still go
 * through the fallback until step 3.5 reads them.
 */
export class UtilityAgent implements BotAgent {
    constructor(
        readonly deck: DeckList,
        readonly profile: BotProfile = DEFAULT_PROFILE,
        private readonly explain?: ExplainSink,
        private readonly fallback: BotAgent = new GovernAgent(),
    ) {}

    choose(decision: DecisionPoint, context?: BotContext): BotOption {
        const choice = this.decide({
            decision,
            assessment: assess(decision.player.gameState, decision.player, this.profile),
            ledger: context?.ledger ?? createLedger(),
            deck: this.deck,
            profile: this.profile,
        })
        this.explain?.({
            player: decision.player.name,
            kind: decision.kind,
            chosen: choice.option,
            candidates: choice.candidates ?? [],
            note: choice.note,
        })
        return choice.option
    }

    private decide(context: DecisionContext): Choice {
        if (context.decision.kind == DecisionKind.Minion) {
            return this.minionPhase(context)
        }
        return { option: this.fallback.choose(context.decision), note: 'fallback rules' }
    }

    // The action card that the base rules would play, among the actions of the minions that are not in
    // `excluded` ( the plan keeps them home ): until step 3.5 values the cards themselves
    private suggestCard(
        decision: DecisionPoint,
        cards: Candidate[],
        excluded: Set<CardOid>,
    ): Candidate | null {
        const endPhase = decision.options.find(option => option.type == 'endPhase')
        const open = cards.filter(card => !excluded.has(card.actor))
        if (!endPhase || open.length == 0) {
            return null
        }
        const pick = this.fallback.choose({
            ...decision,
            options: [...open.map(card => card.option), endPhase],
        })
        return open.find(card => card.option == pick) ?? null
    }

    private minionPhase(context: DecisionContext): Choice {
        const { decision, assessment } = context
        const { me } = assessment.table
        const candidates = optionsOfType(decision.options, 'declareAction').map(candidateOf)
        const cards = candidates.filter(candidate => candidate.kind == 'other')
        const plain = candidates.filter(candidate => candidate.kind != 'other')
        const endPhase = decision.options.find(option => option.type == 'endPhase')
        const unlockCards =
            unlockCardsOf(me, readyMinions(me), assessment.densities[me.oid])[0]?.value ?? 0

        // The card action goes to a minion the plan does not keep home: ask again without the ones it keeps
        const excluded = new Set<CardOid>()
        let plan: TurnPlan
        for (;;) {
            const suggestion = this.suggestCard(decision, cards, excluded)
            plan = planTurn({
                assessment,
                candidates: suggestion ? [...plain, suggestion] : plain,
                mandatory: !endPhase,
                unlockCards,
            })
            const kept = plan.reserved.find(minion => minion.oid == suggestion?.actor)
            if (!suggestion || !kept) {
                break
            }
            excluded.add(kept.oid)
        }

        const next = plan.actions[0]
        return {
            option: next?.option ?? endPhase ?? decision.options[0],
            note: describeTurnPlan(plan).join(' | '),
            candidates: plan.actions.map(action => ({
                option: action.option,
                score: action.value,
                parts: {},
            })),
        }
    }
}
