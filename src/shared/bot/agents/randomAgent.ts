import { BotAgent, BotOption, DecisionPoint } from '@/shared/bot/types.ts'

// Picks any offered option. Not a player: a fuzzer for the referee and the engine.
export class RandomAgent implements BotAgent {
    choose(decision: DecisionPoint): BotOption {
        return decision.options[Math.floor(Math.random() * decision.options.length)]
    }
}
