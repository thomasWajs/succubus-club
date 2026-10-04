import { Card } from '@/shared/model/Card.ts'
import { BotOption, BotOptionOf, optionsOfType } from '@/shared/bot/types.ts'

/** Capacity of a minion card, or 0 when the target is not a minion (or not a card at all). */
export function capacityOf(target: unknown): number {
    return target instanceof Card && target.isMinion() ? target.minionAttrs.capacity : 0
}

/** First option of the given type. Throws when the referee did not offer one. */
export function findOption<T extends BotOption['type']>(
    options: BotOption[],
    type: T,
): BotOptionOf<T> {
    const option = optionsOfType(options, type)[0]
    if (!option) {
        throw new Error(`Expected an option of type '${type}'`)
    }
    return option
}
