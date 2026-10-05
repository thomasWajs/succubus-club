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
            case DecisionKind.ActionImpulse:
                return this.actionImpulse(decision)
            case DecisionKind.ReactionImpulse:
                return this.reactionImpulse(decision)
            case DecisionKind.Combat:
                return this.combat(decision)
        }
    }

    // Unlock, Master and Cleanup offer a single mandatory option
    protected unlockPhase(decision: DecisionPoint): BotOption {
        return decision.options[0]
    }

    protected masterPhase(decision: DecisionPoint): BotOption {
        return decision.options[0]
    }

    protected cleanupPhase(decision: DecisionPoint): BotOption {
        return decision.options[0]
    }

    // The other kinds default to doing nothing. Throws if the referee does not offer it.
    protected minionPhase(decision: DecisionPoint): BotOption {
        return findOption(decision.options, 'endPhase')
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

    // Strikes with the first strike offered (the hand strike), and plays nothing else
    protected combat(decision: DecisionPoint): BotOption {
        return (
            decision.options.find(option => option.type == 'combatStrike') ??
            findOption(decision.options, 'combatPass')
        )
    }
}
