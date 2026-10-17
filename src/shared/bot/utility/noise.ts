import { BotOption } from '@/shared/bot/types.ts'
import { ExplainCandidate } from '@/shared/bot/utility/explain.ts'

/**
 * The noise of a profile: a softmax pick, in pool, among the options the choice scored. Only the
 * options offered by the decision that score no better than the chosen one are in play, each
 * weighted by how close it is to it: a bad option is never a coin flip away, and at temperature 0
 * the chosen option always stands.
 */
export function noisyOption(
    chosen: BotOption,
    candidates: ExplainCandidate[],
    offered: BotOption[],
    temperature: number,
    random: () => number = Math.random,
): BotOption {
    const reference = candidates.find(candidate => candidate.option === chosen)
    if (temperature <= 0 || !reference) {
        return chosen
    }
    const inPlay = candidates.filter(
        candidate => candidate.score <= reference.score && offered.includes(candidate.option),
    )
    const weights = inPlay.map(candidate =>
        Math.exp((candidate.score - reference.score) / temperature),
    )
    let draw = random() * weights.reduce((total, weight) => total + weight, 0)
    for (let i = 0; i < inPlay.length; i++) {
        draw -= weights[i]
        if (draw < 0) {
            return inPlay[i].option
        }
    }
    return chosen
}
