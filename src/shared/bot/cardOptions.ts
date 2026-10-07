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
import { getCardDef } from '@/shared/cardImpl/catalog/index.ts'
import { findPlay, getUsageOptions, playsOfKind } from '@/shared/cardImpl/catalog/requirements.ts'
import { CardKind } from '@/shared/cardImpl/catalog/types.ts'
import {
    getAttachedEffects,
    getRetainers,
    isPlayForbiddenToMinion,
} from '@/shared/cardImpl/catalog/attached.ts'
import { getAttachedCards } from '@/shared/state/attachments.ts'
import {
    createHandStrike,
    createStrike,
    getCombatant,
    getOpposingCombatant,
} from '@/shared/state/combatState.ts'
import { hasPlayedThisAction, isAvailableToReact } from '@/shared/state/actionState.ts'
import { canDeclare } from '@/shared/state/minionActions.ts'
import {
    createActionCardAction,
    createActionModifier,
} from '@/shared/state/minionActionFactories.ts'
import { canPayCosts, canPayPoolCost } from '@/shared/state/cardCosts.ts'
import {
    hasUniqueCopyInPlay,
    meetsRequirements,
    minionMeetsRequirements,
} from '@/shared/state/cardRequirements.ts'
import { BotOptionOf, CombatCardOption } from '@/shared/bot/types.ts'

/**
 * Card-specific legality for the bot.
 *
 * Phase 1 stopgap: backed by the hand-written TS implementations, so only
 * implemented cards are ever offered. Phase 2b replaces the body of these
 * functions with the effect-data interpreter; the signatures stay.
 */

// The minion fits the clan, sect... the card requires, and no card attached to it forbids the card
function canMinionPlay(minion: Minion, card: LibraryCard): boolean {
    return minionMeetsRequirements(minion, card) && !isPlayForbiddenToMinion(minion, card)
}

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

// Each entry is one way for the minion to play the card as the kind. A card described in the
// catalog says it with the requirements of its plays of that kind ( the same card can be a modifier
// at one level and a combat card at another ). The hand-written cards use the card's disciplines.
function usageChoices(minion: Minion, card: LibraryCard, kind: CardKind): DisciplineUse[][] {
    const def = getCardDef(card)
    if (def?.plays.some(play => play.kind == kind)) {
        return getUsageOptions(minion, def, kind)
    }
    return disciplineChoices(minion, card)
}

export function getActionCardOptions(
    minion: Minion,
    card: LibraryCard,
): ActionCardFromHandAction[] {
    // Only implemented cards are offered
    if (!hasImplementation(ACTION_CARD_IMPLEMENTATIONS, card)) {
        return []
    }
    if (!ACTION_TYPES.some(type => card.hasType(type))) {
        return []
    }
    if (!canPayCosts(minion, card) || !canMinionPlay(minion, card)) {
        return []
    }
    // A unique card ( equipment, retainer... ) already in play cannot be played again
    if (hasUniqueCopyInPlay(minion.controller, card)) {
        return []
    }

    const options: ActionCardFromHandAction[] = []

    for (const disciplines of usageChoices(minion, card, 'action')) {
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

// The values a variable "X" cost can take for the play: the catalog says which ones make sense
// ( "X must be 1, 2 or 3" ). One undefined value for a card with no variable cost.
function xChoices(card: LibraryCard, usage: LibraryCardUsage): (number | undefined)[] {
    if (card.bloodCost != 'X' && card.poolCost != 'X') {
        return [undefined]
    }
    const def = getCardDef(card)
    const range = def && findPlay(def, 'modifier', usage)?.x
    if (!range) {
        return []
    }
    return Array.from({ length: range.max - range.min + 1 }, (_, index) => range.min + index)
}

// The vampires that may play the card: the acting minion, and the other ready vampires of its
// controller when the card has a play that says so ( the other plays refuse them anyway ).
function modifierPlayers(actingMinion: Minion, card: LibraryCard): Minion[] {
    const def = getCardDef(card)
    const othersAllowed = !!def && playsOfKind(def, 'modifier').some(play => play.by)
    return othersAllowed ?
            [
                actingMinion,
                ...actingMinion.controller.vampiresReady.filter(vampire => vampire != actingMinion),
            ]
        :   [actingMinion]
}

// Every level the minion can use is offered separately: the effects often differ
// a lot between inferior and superior.
export function getActionModifierOptions(
    actingMinion: Minion,
    card: LibraryCard,
): ActionModifier[] {
    if (
        !hasImplementation(ACTION_MODIFIER_CARD_IMPLEMENTATIONS, card) ||
        !card.hasType(LibraryCardType.ActionModifier)
    ) {
        return []
    }

    return modifierPlayers(actingMinion, card)
        .filter(
            minion =>
                canMinionPlay(minion, card) && !hasPlayedThisAction(minion.gameState, minion, card),
        )
        .flatMap(minion =>
            usageChoices(minion, card, 'modifier')
                .flatMap(disciplines => {
                    const usage: LibraryCardUsage = {
                        disciplines: disciplines.length > 0 ? disciplines : undefined,
                    }
                    return xChoices(card, usage).map(x => ({ ...usage, x }))
                })
                .filter(
                    usage =>
                        canPayCosts(minion, card, usage.x) &&
                        getImplementation(
                            ACTION_MODIFIER_CARD_IMPLEMENTATIONS,
                            card,
                            minion,
                            usage,
                        )?.canPlay().isValid,
                )
                .map(usage =>
                    createActionModifier(card, usage, minion == actingMinion ? undefined : minion),
                ),
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
                additional: effect.additional,
            }
        case 'additionalStrike':
            return { type: 'combatAdditionalStrike', minion, limited: effect.limited, card }
        case 'grapple':
            return {
                type: 'combatGrapple',
                minion,
                press: effect.press,
                closeNextRound: effect.closeNextRound,
                card,
            }
        case 'gainBlood':
            return { type: 'combatGainBlood', minion, amount: effect.amount, card }
        case 'maneuver':
            return {
                type: 'combatManeuver',
                minion,
                strike: effect.strike && { ...effect.strike, source: card },
                card,
            }
        case 'press':
            return { type: 'combatPress', minion, card }
        case 'setStrength':
            return { type: 'combatStrength', minion, amount: effect.amount, card }
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
            !card.hasType(LibraryCardType.Combat) ||
            !canPayCosts(minion, card) ||
            !canMinionPlay(minion, card)
        ) {
            continue
        }

        for (const disciplines of usageChoices(minion, card, 'combat')) {
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

// What the cards in play add to a combat, with no card to play and nothing to pay: the strikes of
// the weapons attached to the minion ( and their maneuver ), and the strikes aimed at the retainers
// attached to the opposing minion. The referee keeps what fits the current step.
export function getAttachedCombatOptions(minion: Minion): CombatCardOption[] {
    const combat = minion.gameState.combat
    const combatant = combat && getCombatant(combat, minion)
    if (!combat || !combatant) {
        return []
    }
    const retainers = getRetainers(getOpposingCombatant(combat, combatant).minion)
    const options: CombatCardOption[] = []

    if (combatant.freeManeuvers > 0) {
        options.push({ type: 'combatManeuver', minion, free: true })
    }
    for (const weapon of getAttachedCards(minion)) {
        for (const effect of getAttachedEffects(weapon)) {
            if (effect.type != 'weaponStrike') {
                continue
            }
            const strike = createStrike(weapon.name, {
                source: weapon,
                damage: effect.damage,
                ranged: !!effect.ranged,
                aggravated: !!effect.aggravated,
            })
            options.push({ type: 'combatStrike', minion, strike })
            if (effect.maneuver) {
                options.push({ type: 'combatManeuver', minion, strike, weapon })
            }
            for (const retainer of retainers) {
                options.push({
                    type: 'combatStrike',
                    minion,
                    strike: { ...strike, name: `${strike.name} at ${retainer.name}`, retainer },
                })
            }
        }
    }
    for (const retainer of retainers) {
        options.push({
            type: 'combatStrike',
            minion,
            strike: {
                ...createHandStrike(combatant),
                name: `Hand strike at ${retainer.name}`,
                retainer,
            },
        })
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
            !card.hasType(LibraryCardType.Reaction) ||
            hasPlayedThisAction(minion.gameState, minion, card) ||
            !canPayCosts(minion, card) ||
            !canMinionPlay(minion, card)
        ) {
            continue
        }

        for (const disciplines of usageChoices(minion, card, 'reaction')) {
            const usage: LibraryCardUsage = {
                disciplines: disciplines.length > 0 ? disciplines : undefined,
            }
            const implementation = getImplementation(
                REACTION_CARD_IMPLEMENTATIONS,
                card,
                minion,
                usage,
            )
            // A locked minion reacts only with a card made for it, unless a card woke it
            if (
                !implementation ||
                (!isAvailableToReact(minion.gameState, minion) && !implementation.usableWhileLocked)
            ) {
                continue
            }
            for (const effect of implementation.getEffects()) {
                options.push({ type: 'playReaction', minion, card, usage, effect })
            }
        }
    }
    return options
}

// The master cards in the player's hand that can be played now: implemented, the pool
// pays for them, the player meets their requirements and no other copy of a unique card is
// in play. The master phase action is checked by the referee.
export function getMasterCardOptions(player: Player): BotOptionOf<'playMaster'>[] {
    const options: BotOptionOf<'playMaster'>[] = []

    for (const card of player.hand.cards) {
        if (
            !(card instanceof LibraryCard) ||
            card.type != LibraryCardType.Master ||
            !canPayPoolCost(player, card) ||
            !meetsRequirements(player, card) ||
            hasUniqueCopyInPlay(player, card)
        ) {
            continue
        }
        const implementation = getMasterImplementation(card, player)
        if (!implementation) {
            continue
        }
        // One option per target for a card with a targeted effect ( none: not worth playing )
        const targets = implementation.getPlayTargets()
        if (targets) {
            options.push(...targets.map(target => ({ type: 'playMaster' as const, card, target })))
        } else {
            options.push({ type: 'playMaster', card })
        }
    }
    return options
}

// The cards put on the player's vampires that move blood in the master phase ( a Blood Doll ), for
// the cards not used yet this turn: one option per card and direction. The pool never goes down to
// 0 ( the player would be ousted ), and a vampire never holds more than its capacity.
export function getMoveBloodOptions(player: Player): BotOptionOf<'moveBlood'>[] {
    const usedCards = player.gameState.turnResources.usedCards
    const options: BotOptionOf<'moveBlood'>[] = []

    for (const vampire of [...player.vampiresReady, ...player.vampiresInTorpor]) {
        for (const card of getAttachedCards(vampire)) {
            if (usedCards.includes(card.oid)) {
                continue
            }
            for (const effect of getAttachedEffects(card)) {
                if (effect.type != 'moveBlood') {
                    continue
                }
                const { amount } = effect
                if (vampire.blood >= amount) {
                    options.push({ type: 'moveBlood', card, vampire, amount, toPool: true })
                }
                if (
                    player.pool > amount &&
                    vampire.blood + amount <= vampire.minionAttrs.capacity
                ) {
                    options.push({ type: 'moveBlood', card, vampire, amount, toPool: false })
                }
            }
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

// The lock abilities of the master cards in play that the player controls: one option per card
// and card of the hand to discard
export function getLockEffectOptions(player: Player): BotOptionOf<'lockEffect'>[] {
    const options: BotOptionOf<'lockEffect'>[] = []
    for (const card of player.controlledReadyCards) {
        if (
            !(card instanceof LibraryCard) ||
            card.type != LibraryCardType.Master ||
            !getMasterImplementation(card, player)?.hasLockAbility()
        ) {
            continue
        }
        for (const discard of player.hand.cards) {
            if (discard instanceof LibraryCard) {
                options.push({ type: 'lockEffect', card, discard })
            }
        }
    }
    return options
}

// The abilities paid with transfers of the master cards in play that the player controls
export function getTransferEffectOptions(player: Player): BotOptionOf<'transferEffect'>[] {
    return player.controlledReadyCards.flatMap(card =>
        card instanceof LibraryCard && card.type == LibraryCardType.Master ?
            (getMasterImplementation(card, player)?.getTransferOptions() ?? []).map(option => ({
                type: 'transferEffect' as const,
                card,
                ...option,
            }))
        :   [],
    )
}

// A played master card goes to the ash heap unless it stays in play. A master card with no
// implementation is never played by a bot, so it is never found in play.
export function isMasterDiscardedAfterUse(card: LibraryCard): boolean {
    return (
        card.type == LibraryCardType.Master &&
        getMasterImplementation(card, card.controller)?.staysInPlay === false
    )
}
