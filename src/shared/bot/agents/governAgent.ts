import { GOVERN_ID, LOST_IN_CROWDS_ID } from '@/shared/cardImpl/cardIds.ts'
import { DisciplineLevel } from '@/shared/const/model.ts'
import { Card } from '@/shared/model/Card.ts'
import { getBlockingMinion } from '@/shared/state/actionState.ts'
import { MinionActionType } from '@/shared/types/state.ts'
import { BaseAgent } from '@/shared/bot/agents/baseAgent.ts'
import { capacityOf } from '@/shared/bot/helpers.ts'
import { BotOption, BotOptionOf, DecisionPoint, optionsOfType } from '@/shared/bot/types.ts'

/**
 * Port of the GovernBot strategy onto the referee's options: hunt when empty,
 * Govern with the oldest able vampire, influence the highest-capacity
 * uncontrolled vampire. Never blocks.
 */

function asGovern(option: BotOptionOf<'declareAction'>) {
    const action = option.action
    if (action.type != MinionActionType.ActionCardFromHand || action.card.krcgId != GOVERN_ID) {
        return null
    }
    return {
        option,
        capacity: action.actingMinion.minionAttrs.capacity,
        level: action.usage.disciplines?.[0]?.level,
        target: action.usage.target,
    }
}

export class GovernAgent extends BaseAgent {
    protected override minionPhase(decision: DecisionPoint): BotOption {
        const actions = optionsOfType(decision.options, 'declareAction')

        // Mandatory actions first: hunt when empty
        const hunt = actions.find(
            option =>
                option.action.type == MinionActionType.Hunt &&
                option.action.actingMinion.blood == 0,
        )
        if (hunt) {
            return hunt
        }

        const governs = actions.map(asGovern).filter(govern => govern !== null)
        if (governs.length > 0) {
            // Oldest able vampire
            const oldest = Math.max(...governs.map(govern => govern.capacity))
            const fromOldest = governs.filter(govern => govern.capacity == oldest)

            // Govern superior on the highest-capacity younger vampire with room for blood
            const superior = fromOldest
                .filter(
                    govern =>
                        govern.level == DisciplineLevel.SUPERIOR &&
                        govern.target instanceof Card &&
                        govern.target.isMinion() &&
                        govern.target.minionAttrs.capacity - govern.target.blood > 3,
                )
                .toSorted((a, b) => capacityOf(b.target) - capacityOf(a.target))[0]
            if (superior) {
                return superior.option
            }

            const inferior = fromOldest.find(govern => govern.level == DisciplineLevel.INFERIOR)
            if (inferior) {
                return inferior.option
            }
        }

        return super.minionPhase(decision)
    }

    protected override influencePhase(decision: DecisionPoint): BotOption {
        if (decision.player.pool >= 8) {
            const best = optionsOfType(decision.options, 'influence').toSorted(
                (a, b) =>
                    b.vampire.minionAttrs.capacity - a.vampire.minionAttrs.capacity ||
                    b.amount - a.amount,
            )[0]
            if (best) {
                return best
            }
        }
        return super.influencePhase(decision)
    }

    protected override discardPhase(decision: DecisionPoint): BotOption {
        const hand = decision.player.hand.cards
        // No more Govern: discard the first card in hand to try to get one
        if (!hand.some(card => card.krcgId == GOVERN_ID)) {
            const discard = optionsOfType(decision.options, 'discard').find(
                option => option.card == hand[0],
            )
            if (discard) {
                return discard
            }
        }
        return super.discardPhase(decision)
    }

    protected override actionImpulse(decision: DecisionPoint): BotOption {
        const gameState = decision.player.gameState
        const action = gameState.action
        const lostInCrowds = optionsOfType(decision.options, 'playModifier').find(
            option => option.modifier.card.krcgId == LOST_IN_CROWDS_ID,
        )
        if (
            action &&
            lostInCrowds &&
            getBlockingMinion(gameState) &&
            action.intercept >= action.stealth
        ) {
            return lostInCrowds
        }
        return super.actionImpulse(decision)
    }
}
