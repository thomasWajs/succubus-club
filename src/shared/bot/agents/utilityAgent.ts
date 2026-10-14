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
import { BotProfile, DEFAULT_PROFILE } from '@/shared/bot/utility/profile.ts'
import { createLedger, TableLedger } from '@/shared/bot/utility/ledger.ts'
import { ExplainCandidate, ExplainSink } from '@/shared/bot/utility/explain.ts'
import { Assessment, assess } from '@/shared/bot/utility/assessment.ts'
import { unlockCardsOf } from '@/shared/bot/utility/defence.ts'
import { readyMinions } from '@/shared/bot/utility/snapshot.ts'
import { candidateOf, planTurn } from '@/shared/bot/utility/turnPlan.ts'
import { describeTurnPlan } from '@/shared/bot/utility/describeAssessment.ts'
import { chooseLiveCombat } from '@/shared/bot/utility/liveCombat.ts'
import { judgeBlock } from '@/shared/bot/utility/blockDecision.ts'
import { judgeInfluence } from '@/shared/bot/utility/influence.ts'
import { judgeModifier } from '@/shared/bot/utility/modifierDecision.ts'
import { judgeReaction, judgeTrigger } from '@/shared/bot/utility/reactionDecision.ts'

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
 * The utility bot. The scorer takes over decision
 * kind by decision kind; the kinds it does not handle yet go to the fallback agent ( the Govern rules
 * by default: the base agent never plays, so no game would end ). The minion phase is the turn plan's:
 * who stays unlocked to defend, who bleeds, hunts, rescues or plays an action card, each valued in pool
 * ( cardActions.ts ), a combat starter only when the position of the fight allows it ( enterCombat.ts ). The windows of a combat are the plan's ( combatPlan.ts ),
 * the block attempts are a judgement of what they save and cost ( blockDecision.ts ), and the stealth
 * and bleed cards of my own actions are played when they pay ( modifierDecision.ts ), and so are the
 * reaction cards, the cards in play, the window after a block and the triggers ( reactionDecision.ts ).
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
        if (context.decision.kind == DecisionKind.Combat) {
            const live = chooseLiveCombat(context.decision, context.assessment)
            if (live) {
                return live
            }
        }
        if (context.decision.kind == DecisionKind.ActionImpulse) {
            const judged = judgeModifier(context.decision, context.assessment)
            if (judged) {
                return judged
            }
        }
        if (context.decision.kind == DecisionKind.Influence) {
            const judged = judgeInfluence(context.decision, context.assessment, context.deck)
            if (judged) {
                return judged
            }
        }
        if (context.decision.kind == DecisionKind.Trigger) {
            const judged = judgeTrigger(context.decision, context.assessment)
            if (judged) {
                return judged
            }
        }
        if (
            context.decision.kind == DecisionKind.ReactionImpulse ||
            context.decision.kind == DecisionKind.PostBlock
        ) {
            const reaction = judgeReaction(context.decision, context.assessment)
            if (reaction) {
                return reaction
            }
        }
        if (context.decision.kind == DecisionKind.ReactionImpulse) {
            const judged = judgeBlock(context.decision, context.assessment)
            if (judged?.block) {
                return { option: judged.block, note: judged.note, candidates: judged.candidates }
            }
            // A block that is not attempted is declined out loud: the acting player then has the
            // impulse back, to play what it holds before the action is resolved
            const noBlock = context.decision.options.find(option => option.type == 'noBlock')
            if (noBlock) {
                return {
                    option: noBlock,
                    note: judged?.note ?? 'no block to attempt',
                    candidates: judged?.candidates,
                }
            }
        }
        return { option: this.fallback.choose(context.decision), note: 'fallback rules' }
    }

    private minionPhase(context: DecisionContext): Choice {
        const { decision, assessment } = context
        const { me } = assessment.table
        const candidates = optionsOfType(decision.options, 'declareAction').map(candidateOf)
        const endPhase = decision.options.find(option => option.type == 'endPhase')
        const unlockCards =
            unlockCardsOf(me, readyMinions(me), assessment.densities[me.oid])[0]?.value ?? 0

        const plan = planTurn({ assessment, candidates, mandatory: !endPhase, unlockCards })

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
