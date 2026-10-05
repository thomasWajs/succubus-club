import { LibraryCard, Minion } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { ACTION_TYPES, Discipline, DisciplineLevel, LibraryCardType } from '@/shared/const/model.ts'
import {
    ActionCardFromHandAction,
    ActionModifier,
    DisciplineUse,
    LibraryCardUsage,
} from '@/shared/types/state.ts'
import {
    ACTION_CARD_IMPLEMENTATIONS,
    ACTION_MODIFIER_CARD_IMPLEMENTATIONS,
    COMBAT_CARD_IMPLEMENTATIONS,
    REACTION_CARD_IMPLEMENTATIONS,
    getImplementation,
    getMasterImplementation,
    hasImplementation,
} from '@/shared/cardImpl/index.ts'
import { CombatCardEffect } from '@/shared/cardImpl/base.ts'
import { canDeclare } from '@/shared/state/minionActions.ts'
import {
    createActionCardAction,
    createActionModifier,
} from '@/shared/state/minionActionFactories.ts'
import { singleDisciplineUsage } from '@/shared/state/cardUsage.ts'
import { canPayCosts, canPayPoolCost } from '@/shared/state/cardCosts.ts'
import { meetsClanRequirement } from '@/shared/state/cardRequirements.ts'
import { BotOptionOf, CombatCardOption } from '@/shared/bot/types.ts'

/**
 * Card-specific legality for the bot.
 *
 * Phase 1 stopgap: backed by the hand-written TS implementations, so only
 * implemented cards are ever offered. Phase 2b replaces the body of these
 * functions with the effect-data interpreter; the signatures stay.
 */

function isDiscipline(name: string): name is Discipline {
    return (Object.values(Discipline) as string[]).includes(name)
}

// Each entry is one way of paying the card's discipline requirement
function disciplineChoices(minion: Minion, card: LibraryCard): DisciplineUse[][] {
    const names = card.disciplines.filter(name => name != '')
    if (names.length == 0) {
        return [[]]
    }

    const choices: DisciplineUse[][] = []
    for (const name of names) {
        if (!isDiscipline(name)) {
            continue
        }
        for (const level of [DisciplineLevel.SUPERIOR, DisciplineLevel.INFERIOR]) {
            if (minion.hasDiscipline(name, level)) {
                choices.push([{ discipline: name, level }])
            }
        }
    }
    return choices
}

export function getActionCardOptions(
    minion: Minion,
    card: LibraryCard,
): ActionCardFromHandAction[] {
    // Only implemented cards are offered
    if (!hasImplementation(ACTION_CARD_IMPLEMENTATIONS, card)) {
        return []
    }
    if (!card.type || !ACTION_TYPES.includes(card.type)) {
        return []
    }
    if (!canPayCosts(minion, card)) {
        return []
    }

    const options: ActionCardFromHandAction[] = []

    for (const disciplines of disciplineChoices(minion, card)) {
        const usage: LibraryCardUsage = {
            disciplines: disciplines.length > 0 ? disciplines : undefined,
        }
        // The card says which targets are worth trying at this level
        const targets =
            getImplementation(ACTION_CARD_IMPLEMENTATIONS, card, minion, usage)?.getTargets() ?? []
        for (const target of targets) {
            const action = createActionCardAction(minion, card, { ...usage, target })
            if (canDeclare(action).isValid) {
                options.push(action)
            }
        }
    }
    return options
}

// Every level the minion can use is offered separately: the effects often differ
// a lot between inferior and superior.
export function getActionModifierOptions(minion: Minion, card: LibraryCard): ActionModifier[] {
    if (
        !hasImplementation(ACTION_MODIFIER_CARD_IMPLEMENTATIONS, card) ||
        card.type != LibraryCardType.ActionModifier ||
        !canPayCosts(minion, card)
    ) {
        return []
    }

    return disciplineChoices(minion, card).map(([use]) =>
        createActionModifier(card, use ? singleDisciplineUsage(use.discipline, use.level) : {}),
    )
}

function toCombatOption(
    minion: Minion,
    card: LibraryCard,
    effect: CombatCardEffect,
): CombatCardOption {
    switch (effect.type) {
        case 'strike':
            return {
                type: 'combatStrike',
                minion,
                strike: { ...effect.strike, source: card },
                card,
            }
        case 'maneuver':
            return {
                type: 'combatManeuver',
                minion,
                strike: effect.strike && { ...effect.strike, source: card },
                card,
            }
        case 'press':
            return { type: 'combatPress', minion, card }
        case 'prevent':
            return {
                type: 'combatPrevent',
                minion,
                amount: effect.amount,
                aggravated: effect.aggravated,
                card,
            }
    }
}

// What the combat cards in the minion's player's hand can add to a combat, at any
// step: the referee keeps what fits the current one. Each discipline level the
// minion can use is a separate way to play the card.
export function getCombatCardOptions(minion: Minion): CombatCardOption[] {
    const player = minion.controller
    const options: CombatCardOption[] = []

    for (const card of player.hand.cards) {
        if (
            !(card instanceof LibraryCard) ||
            !hasImplementation(COMBAT_CARD_IMPLEMENTATIONS, card) ||
            card.type != LibraryCardType.Combat ||
            !canPayCosts(minion, card)
        ) {
            continue
        }

        for (const disciplines of disciplineChoices(minion, card)) {
            const usage: LibraryCardUsage = {
                disciplines: disciplines.length > 0 ? disciplines : undefined,
            }
            const implementation = getImplementation(
                COMBAT_CARD_IMPLEMENTATIONS,
                card,
                minion,
                usage,
            )
            for (const effect of implementation?.getEffects() ?? []) {
                options.push(toCombatOption(minion, card, effect))
            }
        }
    }
    return options
}

// What the reaction cards in the minion's player's hand can do to the action in progress.
// Each discipline level the minion can use is a separate way to play the card. The card
// only checks its own conditions: the referee asks the engine whether the effect is allowed.
export function getReactionCardOptions(minion: Minion): BotOptionOf<'playReaction'>[] {
    const options: BotOptionOf<'playReaction'>[] = []

    for (const card of minion.controller.hand.cards) {
        if (
            !(card instanceof LibraryCard) ||
            !hasImplementation(REACTION_CARD_IMPLEMENTATIONS, card) ||
            card.type != LibraryCardType.Reaction ||
            !canPayCosts(minion, card)
        ) {
            continue
        }

        for (const disciplines of disciplineChoices(minion, card)) {
            const usage: LibraryCardUsage = {
                disciplines: disciplines.length > 0 ? disciplines : undefined,
            }
            const implementation = getImplementation(
                REACTION_CARD_IMPLEMENTATIONS,
                card,
                minion,
                usage,
            )
            for (const effect of implementation?.getEffects() ?? []) {
                options.push({ type: 'playReaction', minion, card, usage, effect })
            }
        }
    }
    return options
}

// The master cards in the player's hand that can be played now: implemented, the pool
// pays for them and the player meets their requirements. The master phase action is checked
// by the referee.
export function getMasterCardOptions(player: Player): BotOptionOf<'playMaster'>[] {
    const options: BotOptionOf<'playMaster'>[] = []

    for (const card of player.hand.cards) {
        if (
            !(card instanceof LibraryCard) ||
            card.type != LibraryCardType.Master ||
            !canPayPoolCost(player, card) ||
            !meetsClanRequirement(player, card)
        ) {
            continue
        }
        if (getMasterImplementation(card, player)) {
            options.push({ type: 'playMaster', card })
        }
    }
    return options
}

// The unlock-phase effects of the master cards in play that the player controls: one option
// per card and target, for the cards not used yet this turn
export function getUnlockEffectOptions(player: Player): BotOptionOf<'unlockEffect'>[] {
    const options: BotOptionOf<'unlockEffect'>[] = []
    const usedCards = player.gameState.turnResources.usedCards

    for (const card of player.controlledReadyCards) {
        if (
            !(card instanceof LibraryCard) ||
            card.type != LibraryCardType.Master ||
            usedCards.includes(card.oid)
        ) {
            continue
        }
        for (const vampire of getMasterImplementation(card, player)?.getUnlockEffectTargets() ??
            []) {
            options.push({ type: 'unlockEffect', card, vampire })
        }
    }
    return options
}

// A played master card goes to the ash heap unless it stays in play. A master card with no
// implementation is never played by a bot, so it is never found in play.
export function isMasterDiscardedAfterUse(card: LibraryCard): boolean {
    return (
        card.type == LibraryCardType.Master &&
        getMasterImplementation(card, card.controller)?.staysInPlay === false
    )
}

// Same-named modifiers can't be played twice in an action: the ones already
// played are still in the ready region until the end-of-action cleanup.
export function hasPlayedModifierThisAction(player: Player, card: LibraryCard): boolean {
    return player.ready.cards.some(
        played =>
            played instanceof LibraryCard &&
            played.type == LibraryCardType.ActionModifier &&
            played.krcgId == card.krcgId,
    )
}
