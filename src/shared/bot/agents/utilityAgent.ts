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
import { cycleWorthOf, judgeCycle } from '@/shared/bot/utility/cycle.ts'
import { discards, judgeDiscard, judgeDiscardExcess } from '@/shared/bot/utility/hand.ts'
import { judgeInfluence } from '@/shared/bot/utility/influence.ts'
import { judgeMaster, judgeUnlock } from '@/shared/bot/utility/masterPhase.ts'
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
 * reaction cards, the cards in play, the window after a block and the triggers ( reactionDecision.ts ). The
 * vampires come out by a plan over the transfers to come ( influence.ts ), the master phase and the unlock
 * phase play the master cards and move the blood by their worth ( masterPhase.ts ), and the hand is judged as a whole: the
 * weakest card is cycled when a draw is worth more, and it is the one that goes when the hand is too big ( hand.ts ). A card in
 * play that throws a card away waits for the best moment of the cycle to be used ( cycle.ts ).
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
        const { decision } = context
        if (decision.kind == DecisionKind.TurnEnd) {
            const cycled = judgeCycle(decision, context.assessment, context.deck)
            return cycled ?
                    { ...cycled }
                :   { option: this.fallback.choose(decision), note: 'nothing to use now' }
        }
        if (optionsOfType(decision.options, 'lockEffect').length > 0) {
            // The free discard of the turn goes before a card in play that throws a card away: it cannot wait
            if (decision.kind == DecisionKind.Discard) {
                const free = judgeDiscard(decision, context.assessment, context.deck)
                if (free.option.type == 'discard') {
                    return free
                }
            }
            const cycled = judgeCycle(decision, context.assessment, context.deck)
            if (cycled) {
                return cycled
            }
            return this.decideKind({
                ...context,
                decision: {
                    ...decision,
                    options: decision.options.filter(option => option.type != 'lockEffect'),
                },
            })
        }
        return this.decideKind(context)
    }

    private decideKind(context: DecisionContext): Choice {
        if (context.decision.kind == DecisionKind.Minion) {
            return this.minionPhase(context)
        }
        if (context.decision.kind == DecisionKind.Unlock) {
            // Unlocking as normal is mandatory and first, the effects of the cards in play follow
            const unlockAll = context.decision.options.find(option => option.type == 'unlockAll')
            if (unlockAll) {
                return { option: unlockAll, note: 'unlock as normal' }
            }
            return judgeUnlock(context.decision, context.assessment)
        }
        if (context.decision.kind == DecisionKind.Master) {
            // A card that throws cards away is worth the charges it gives over the turns it stays
            const throwing = optionsOfType(context.decision.options, 'playMaster').some(option =>
                discards(option.card),
            )
            const cycle =
                throwing ? cycleWorthOf(context.decision, context.assessment, context.deck) : 0
            return judgeMaster(context.decision, context.assessment, cycle)
        }
        if (context.decision.kind == DecisionKind.Discard) {
            return judgeDiscard(context.decision, context.assessment, context.deck)
        }
        if (context.decision.kind == DecisionKind.DiscardExcess) {
            return judgeDiscardExcess(context.decision, context.assessment, context.deck)
        }
        if (context.decision.kind == DecisionKind.Combat) {
            const live = chooseLiveCombat(context.decision, context.assessment)
            if (live) {
                return live
            }
        }
        if (context.decision.kind == DecisionKind.ActionImpulse) {
            const judged = judgeModifier(context.decision, context.assessment, context.deck)
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
