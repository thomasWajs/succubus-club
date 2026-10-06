import {
    ASYLUM_HUNTING_GROUND_ID,
    DEFLECTION_ID,
    ELDER_LIBRARY_ID,
    GOVERN_ID,
    LOST_IN_CROWDS_ID,
} from '@/shared/cardImpl/cardIds.ts'
import { DisciplineLevel } from '@/shared/const/model.ts'
import { Card, Minion } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { getBlockingMinion } from '@/shared/state/actionState.ts'
import { hasUniqueCopyInPlay } from '@/shared/state/cardRequirements.ts'
import { isBleed } from '@/shared/state/minionActions.ts'
import { CombatRange, CombatStep, MinionActionType } from '@/shared/types/state.ts'
import { isStrikeEffective } from '@/shared/state/combatState.ts'
import { BaseAgent } from '@/shared/bot/agents/baseAgent.ts'
import { capacityOf } from '@/shared/bot/helpers.ts'
import { BotOption, BotOptionOf, DecisionPoint, optionsOfType } from '@/shared/bot/types.ts'

/**
 * Port of the GovernBot strategy onto the referee's options: hunt when empty
 * (enforced by the referee), Govern with the oldest able vampire, influence the
 * highest-capacity uncontrolled vampire. Blocks when it can win (see chooseBlock). With more than 2 ready minions,
 * the youngest stays unlocked (unless it is empty and must hunt). When bled, it declines to block then
 * bounces the bleed to its prey with Deflection.
 */

// With more than 2 ready minions, the youngest one is kept unlocked
function getReservedMinion(player: Player): Minion | null {
    const ready = player.minionsReady
    if (ready.length <= 2) {
        return null
    }
    return ready.reduce((youngest, minion) =>
        minion.minionAttrs.capacity < youngest.minionAttrs.capacity ? minion : youngest,
    )
}

function isBledByAction(player: Player): boolean {
    const action = player.gameState.action?.minionAction
    return !!action && isBleed(action) && action.target?.oid == player.oid
}

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
    // The locations as soon as they are in hand ( and playable ), by order of preference
    protected override masterPhase(decision: DecisionPoint): BotOption {
        const plays = optionsOfType(decision.options, 'playMaster')
        for (const id of [ELDER_LIBRARY_ID, ASYLUM_HUNTING_GROUND_ID]) {
            const play = plays.find(option => option.card.krcgId == id)
            if (play) {
                return play
            }
        }
        return super.masterPhase(decision)
    }

    // Blood on the vampire with the least ( none when they are all full: not offered )
    protected override unlockPhase(decision: DecisionPoint): BotOption {
        const emptiest = optionsOfType(decision.options, 'unlockEffect').toSorted(
            (a, b) => a.vampire.blood - b.vampire.blood,
        )[0]
        return emptiest ?? super.unlockPhase(decision)
    }

    protected override minionPhase(decision: DecisionPoint): BotOption {
        const actions = optionsOfType(decision.options, 'declareAction')

        // An empty vampire must hunt: the referee then offers only the hunts, and the base agent takes the first.
        // The reserved minion stays unlocked, ready to react
        const reserved = getReservedMinion(decision.player)
        const governs = actions
            .filter(option => option.action.actingMinion != reserved)
            .map(asGovern)
            .filter(govern => govern !== null)
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

    // A dead card first ( a unique card whose other copy is in play ), then keeps the Govern cards
    protected override discardExcess(decision: DecisionPoint): BotOption {
        const options = optionsOfType(decision.options, 'discardExcess')
        return (
            options.find(option => hasUniqueCopyInPlay(decision.player, option.card)) ??
            options.find(option => option.card.krcgId != GOVERN_ID) ??
            super.discardExcess(decision)
        )
    }

    protected override discardPhase(decision: DecisionPoint): BotOption {
        const hand = decision.player.hand.cards
        // A unique card that cannot be played while its other copy is in play is dead weight
        const dead = optionsOfType(decision.options, 'discard').find(option =>
            hasUniqueCopyInPlay(decision.player, option.card),
        )
        if (dead) {
            return dead
        }
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

    // Hand strikes only, so the stronger minion wants close range and the weaker one
    // long range (where nobody hurts anybody). Dodge when the opposing strike would hurt.
    protected override combat(decision: DecisionPoint): BotOption {
        const combat = decision.player.gameState.combat
        if (!combat) {
            return super.combat(decision)
        }
        const me =
            combat.acting.minion.controller == decision.player ? combat.acting : combat.defending
        const opponent = me == combat.acting ? combat.defending : combat.acting

        if (combat.step == CombatStep.DetermineRange) {
            const wanted =
                me.strength > opponent.strength ? CombatRange.Close
                : me.strength < opponent.strength ? CombatRange.Long
                : combat.range
            // A maneuver that also chooses a strike (strike card) is not worth it here
            const maneuver = optionsOfType(decision.options, 'combatManeuver').find(
                option => !option.strike,
            )
            if (maneuver && wanted != combat.range) {
                return maneuver
            }
        }

        if (combat.step == CombatStep.Strike) {
            const incoming = opponent.strike
            const dodge = optionsOfType(decision.options, 'combatStrike').find(
                option => option.strike.dodge,
            )
            if (
                dodge &&
                incoming &&
                incoming.damage > 0 &&
                isStrikeEffective(incoming, combat.range)
            ) {
                return dodge
            }
        }

        return super.combat(decision)
    }

    // First rule-based block (the Phase 3 scorer refines it): attempt it when it would succeed against
    // the current stealth and the blocker is not weaker than the acting minion, so the combat that
    // follows is not a losing one. The strongest, then the fullest, minion blocks.
    private chooseBlock(decision: DecisionPoint): BotOptionOf<'block'> | null {
        const action = decision.player.gameState.action
        if (!action) {
            return null
        }
        const actorStrength = action.minionAction.actingMinion.minionAttrs.strength
        return (
            optionsOfType(decision.options, 'block')
                .filter(
                    option =>
                        option.minion.minionAttrs.intercept >= action.stealth &&
                        option.minion.minionAttrs.strength >= actorStrength,
                )
                .toSorted(
                    (a, b) =>
                        b.minion.minionAttrs.strength - a.minion.minionAttrs.strength ||
                        b.minion.blood - a.minion.blood,
                )[0] ?? null
        )
    }

    protected override reactionImpulse(decision: DecisionPoint): BotOption {
        const player = decision.player
        const block = this.chooseBlock(decision)
        if (block) {
            return block
        }
        if (!isBledByAction(player)) {
            return super.reactionImpulse(decision)
        }

        // Bounce the bleed to the prey, with the vampire that is the cheapest to lock
        // (superior does not lock; else the oldest)
        const prey = player.prey
        const bounce = optionsOfType(decision.options, 'playReaction')
            .flatMap(option =>
                (
                    option.card.krcgId == DEFLECTION_ID &&
                    option.effect.type == 'changeTarget' &&
                    option.effect.target.oid == prey?.oid
                ) ?
                    [{ option, locks: option.effect.lockMinion }]
                :   [],
            )
            .toSorted(
                (a, b) =>
                    Number(a.locks) - Number(b.locks) ||
                    b.option.minion.minionAttrs.capacity - a.option.minion.minionAttrs.capacity,
            )[0]
        if (bounce) {
            return bounce.option
        }

        // Deflection is only usable once blocks are declined
        const noBlock = decision.options.find(option => option.type == 'noBlock')
        if (noBlock && player.hand.cards.some(card => card.krcgId == DEFLECTION_ID)) {
            return noBlock
        }
        return super.reactionImpulse(decision)
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
