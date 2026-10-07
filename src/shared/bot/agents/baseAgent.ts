import { findOption } from '@/shared/bot/helpers.ts'
import { BotAgent, BotOption, DecisionKind, DecisionPoint } from '@/shared/bot/types.ts'

// Dispatches each decision to a per-kind method. Subclasses override only the kinds they care about.
export abstract class BaseAgent implements BotAgent {
    choose(decision: DecisionPoint): BotOption {
        switch (decision.kind) {
            case DecisionKind.Unlock:
                return this.unlockPhase(decision)
            case DecisionKind.Master:
                return this.masterPhase(decision)
            case DecisionKind.Minion:
                return this.minionPhase(decision)
            case DecisionKind.Influence:
                return this.influencePhase(decision)
            case DecisionKind.Discard:
                return this.discardPhase(decision)
            case DecisionKind.Cleanup:
                return this.cleanupPhase(decision)
            case DecisionKind.DiscardExcess:
                return this.discardExcess(decision)
            case DecisionKind.Trigger:
                return this.trigger(decision)
            case DecisionKind.ActionImpulse:
                return this.actionImpulse(decision)
            case DecisionKind.ReactionImpulse:
                return this.reactionImpulse(decision)
            case DecisionKind.PostBlock:
                return this.postBlock(decision)
            case DecisionKind.Combat:
                return this.combat(decision)
        }
    }

    // Unlocks first ( mandatory ), then uses no unlock effect
    protected unlockPhase(decision: DecisionPoint): BotOption {
        return (
            decision.options.find(option => option.type == 'unlockAll') ??
            findOption(decision.options, 'endPhase')
        )
    }

    // Cleanup offers a single mandatory option
    protected cleanupPhase(decision: DecisionPoint): BotOption {
        return decision.options[0]
    }

    // Mandatory: the first card by default
    protected discardExcess(decision: DecisionPoint): BotOption {
        return decision.options[0]
    }

    // Uses the optional trigger when it can ( they are almost always an upside ), else skips it
    protected trigger(decision: DecisionPoint): BotOption {
        return (
            decision.options.find(option => option.type == 'useTrigger') ??
            findOption(decision.options, 'skipTrigger')
        )
    }

    // The other kinds default to doing nothing. Throws if the referee does not offer it.
    protected masterPhase(decision: DecisionPoint): BotOption {
        return findOption(decision.options, 'endPhase')
    }

    // No endPhase when a vampire must hunt: the options are then only the mandatory hunts
    protected minionPhase(decision: DecisionPoint): BotOption {
        return decision.options.find(option => option.type == 'endPhase') ?? decision.options[0]
    }

    protected influencePhase(decision: DecisionPoint): BotOption {
        return findOption(decision.options, 'endPhase')
    }

    protected discardPhase(decision: DecisionPoint): BotOption {
        return findOption(decision.options, 'endTurn')
    }

    protected actionImpulse(decision: DecisionPoint): BotOption {
        return findOption(decision.options, 'noModifier')
    }

    protected reactionImpulse(decision: DecisionPoint): BotOption {
        return findOption(decision.options, 'noReaction')
    }

    // Plays what is offered ( the reactions of this window only unlock the blocker ), else passes
    protected postBlock(decision: DecisionPoint): BotOption {
        return (
            decision.options.find(option => option.type == 'playReaction') ??
            findOption(decision.options, 'noReaction')
        )
    }

    // Strikes with the first strike offered (the hand strike), and plays nothing else
    protected combat(decision: DecisionPoint): BotOption {
        return (
            decision.options.find(option => option.type == 'combatStrike') ??
            findOption(decision.options, 'combatPass')
        )
    }
}
