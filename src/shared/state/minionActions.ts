import { Card, LibraryCard, Minion } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import {
    ACTION_TYPES,
    Discipline,
    LEAVE_TORPOR_COST,
    LibraryCardType,
} from '@/shared/const/model.ts'
import {
    ActionCardFromHandAction,
    ActionModifier,
    ActionModifierType,
    BecomeAnarchAction,
    BleedAction,
    DeclarationType,
    HuntAction,
    Invalid,
    LeaveTorporAction,
    LibraryCardUsage,
    MinionAction,
    MinionActionNames,
    MinionActionType,
    Reaction,
    ReactionType,
    RescueFromTorporAction,
    VALID,
    Validity,
} from '@/shared/types/state.ts'
import {
    ACTION_CARD_IMPLEMENTATIONS,
    ACTION_MODIFIER_CARD_IMPLEMENTATIONS,
} from '@/shared/cardImpl'

// Returns the hand-written implementation for an action card, or null when the
// card has none. Only a handful of ( bot-deck ) cards are implemented ; a human
// can play any of the ~4000 cards, most of which fall here.
function tryGetImplementationACA(action: ActionCardFromHandAction) {
    if (!action.card.krcgId) {
        return null
    }
    const ImplementationClass = ACTION_CARD_IMPLEMENTATIONS[action.card.krcgId]

    if (!ImplementationClass) {
        return null
    }

    return new ImplementationClass(action.card.owner, action.usage)
}

// Same as tryGetImplementationACA, but throws when there is no implementation.
// Use it only where an implementation is expected ( bot behaviours ).
function getImplementationACA(action: ActionCardFromHandAction) {
    const implementation = tryGetImplementationACA(action)
    if (!implementation) {
        throw new Error('ActionCardAction has no implementation')
    }
    return implementation
}

function getImplementationAM(actionModifier: ActionModifier) {
    if (!actionModifier.card.krcgId) {
        throw new Error('ActionCardAction has no krcgId')
    }
    const ImplementationClass = ACTION_MODIFIER_CARD_IMPLEMENTATIONS[actionModifier.card.krcgId]

    if (!ImplementationClass) {
        throw new Error('ActionModifier has no implementation')
    }
    return new ImplementationClass(actionModifier.card.owner, actionModifier.usage)
}

/**
 * Factory functions
 */

export function createBleedAction(actingMinion: Minion, targetPlayer: Player): BleedAction {
    return {
        type: MinionActionType.Bleed,
        actingMinion,
        target: targetPlayer,
    }
}

export function createHuntAction(actingMinion: Minion): HuntAction {
    return {
        type: MinionActionType.Hunt,
        actingMinion,
    }
}

export function createLeaveTorporAction(actingMinion: Minion): LeaveTorporAction {
    return {
        type: MinionActionType.LeaveTorpor,
        actingMinion,
    }
}

export function createRescueFromTorporAction(
    actingMinion: Minion,
    rescuedMinion: Minion,
    bloodPaidByActingMinion: number,
    bloodPaidByRescuedMinion: number,
): RescueFromTorporAction {
    return {
        type: MinionActionType.RescueFromTorpor,
        actingMinion,
        bloodPaidByActingMinion,
        bloodPaidByRescuedMinion,
        target: rescuedMinion,
    }
}

export function createBecomeAnarchAction(actingMinion: Minion): BecomeAnarchAction {
    return {
        type: MinionActionType.BecomeAnarch,
        actingMinion,
    }
}

export function createActionCardAction(
    actingMinion: Minion,
    actionCard: LibraryCard,
    usage: LibraryCardUsage,
): ActionCardFromHandAction {
    if (!actionCard.type || !ACTION_TYPES.includes(actionCard.type)) {
        throw new Error('ActionCardAction needs a LibraryCard with an action type')
    }

    return {
        type: MinionActionType.ActionCardFromHand,
        actingMinion,
        card: actionCard,
        usage,
        target: usage.target,
    }
}

export function createActionModifier(
    actionModifierCard: LibraryCard,
    usage: LibraryCardUsage,
): ActionModifier {
    if (actionModifierCard.type != LibraryCardType.ActionModifier) {
        throw new Error("ActionModifier needs a LibraryCard with type 'ActionModifier'")
    }

    return {
        type: ActionModifierType,
        card: actionModifierCard,
        usage,
    }
}

export function applyActionModifier(actionModifier: ActionModifier): void {
    getImplementationAM(actionModifier).apply()
}

/**
 * Utility functions
 */

function hasType(value: unknown, types: DeclarationType[]): boolean {
    return (
        value !== null &&
        typeof value === 'object' &&
        'type' in value &&
        types.includes(value.type as DeclarationType)
    )
}

export function isMinionAction(value: unknown): value is MinionAction {
    return hasType(value, Object.values(MinionActionType))
}

export function isActionModifier(value: unknown): value is ActionModifier {
    return hasType(value, [ActionModifierType])
}

export function isReaction(value: unknown): value is Reaction {
    return hasType(value, [ReactionType])
}

export function getCardUsageDisplay(card: LibraryCard, usage: LibraryCardUsage) {
    const level = ['', ' inf', ' SUP'][usage.level ?? 0]
    return `${card.name}${level}`
}

export function getName(action: MinionAction) {
    if (action.type == MinionActionType.ActionCardFromHand) {
        return getCardUsageDisplay(action.card, action.usage)
    }
    return MinionActionNames[action.type]
}

export function isUndirected(action: MinionAction): boolean {
    const gameState = action.actingMinion.gameState
    return (
        !action.target ||
        action.target == gameState.activePlayer ||
        (action.target instanceof Card && action.target.controller == gameState.activePlayer)
    )
}

export function isDirected(action: MinionAction): boolean {
    return !isUndirected(action)
}

export function getDefaultStealth(action: MinionAction): number {
    if (action.type == MinionActionType.ActionCardFromHand) {
        const implementation = tryGetImplementationACA(action)
        if (implementation) {
            return implementation.getStealth()
        }
        // No implementation ( any card a human plays ) : infer the stealth from
        // the card text, falling back to the directed / undirected default.
        const textStealth = action.card.textStealth
        if (textStealth !== null) {
            return textStealth
        }
    }
    return isUndirected(action) ? 1 : 0
}

export function isBleed(action: MinionAction): boolean {
    if (action.type == MinionActionType.Bleed) {
        return true
    }
    if (action.type == MinionActionType.ActionCardFromHand) {
        return tryGetImplementationACA(action)?.isBleed ?? false
    }
    return false
}

export function isHunt(action: MinionAction): boolean {
    if (action.type == MinionActionType.Hunt) {
        return true
    }
    if (action.type == MinionActionType.ActionCardFromHand) {
        return tryGetImplementationACA(action)?.isHunt ?? false
    }
    return false
}

export function isPoliticalAction(action: MinionAction): boolean {
    if (
        action.type != MinionActionType.ActionCardFromHand &&
        action.type != MinionActionType.ActionInPlay
    ) {
        return false
    }
    return action.card instanceof LibraryCard && action.card.type == LibraryCardType.PoliticalAction
}

/**
 * Behaviours
 */

type MinionActionBehaviour<MA extends MinionAction = MinionAction> = {
    canDeclare: (action: MA) => Validity
    declare: (action: MA) => void
    resolve: (action: MA) => void
}
type Behaviors = {
    [key in MinionActionType]: MinionActionBehaviour<Extract<MinionAction, { type: key }>>
}

const behaviors: Partial<Behaviors> = {
    [MinionActionType.LeaveTorpor]: {
        declare() {},
        canDeclare(action: LeaveTorporAction) {
            if (!action.actingMinion.isIn.torpor) {
                return Invalid('Acting vampire must be in torpor')
            }
            if (action.actingMinion.blood < LEAVE_TORPOR_COST) {
                return Invalid("Acting vampire doesn't have enough blood")
            }
            return VALID
        },
        resolve(action: LeaveTorporAction) {
            gameMutations.changeBlood.act(action.actingMinion.controller, {
                card: action.actingMinion,
                amount: -LEAVE_TORPOR_COST,
            })
            gameMutations.moveCardToRegion.act(action.actingMinion.controller, {
                card: action.actingMinion,
                fromCardRegion: action.actingMinion.region,
                toCardRegion: action.actingMinion.controller.ready,
                x: 0,
                y: 0,
            })
        },
    },

    [MinionActionType.RescueFromTorpor]: {
        declare() {},
        canDeclare(action: RescueFromTorporAction) {
            if (!action.actingMinion.isIn.ready) {
                return Invalid('Acting vampire must be ready')
            }
            if (!action.target.isIn.torpor) {
                return Invalid('Rescued vampire must be in torpor')
            }
            if (action.actingMinion.blood + action.target.blood < LEAVE_TORPOR_COST) {
                return Invalid('Not enough blood')
            }
            return VALID
        },
        resolve(action: RescueFromTorporAction) {
            if (action.bloodPaidByActingMinion) {
                gameMutations.changeBlood.act(action.actingMinion.controller, {
                    card: action.actingMinion,
                    amount: -action.bloodPaidByActingMinion,
                })
            }
            if (action.bloodPaidByRescuedMinion) {
                gameMutations.changeBlood.act(action.actingMinion.controller, {
                    card: action.target,
                    amount: -action.bloodPaidByRescuedMinion,
                })
            }
            gameMutations.moveCardToRegion.act(action.actingMinion.controller, {
                card: action.target,
                fromCardRegion: action.target.region,
                toCardRegion: action.target.controller.ready,
                x: 0,
                y: 0,
            })
        },
    },

    [MinionActionType.ActionCardFromHand]: {
        declare(action: ActionCardFromHandAction) {
            if (action.actingMinion.controller.isBot) {
                getImplementationACA(action).declare()
            }
        },
        canDeclare(action: ActionCardFromHandAction) {
            if (!action.card.resource) {
                return Invalid('Action card has no resource')
            }

            // Check for discipline compatibility if needed
            // For now, don't take into account multi-discipline cards
            const cardDiscipline = action.card.resource.discipline as Discipline
            if (cardDiscipline) {
                if (!action.usage.level) {
                    return Invalid('Usage has no level')
                }
                if (!action.actingMinion.hasDiscipline(cardDiscipline, action.usage.level)) {
                    return Invalid("Acting vampire doesn't have corresponding discipline level")
                }
            }
            return getImplementationACA(action).canDeclare(action.actingMinion)
        },
        resolve(action: ActionCardFromHandAction) {
            // Pay blood cost
            if (action.card.bloodCost) {
                gameMutations.changeBlood.act(action.actingMinion.controller, {
                    card: action.actingMinion,
                    amount: -action.card.bloodCost,
                })
            }
            // Pay pool cost
            if (action.card.poolCost) {
                gameMutations.changePool.act(action.actingMinion.controller, {
                    player: action.actingMinion.controller,
                    amount: -action.card.poolCost,
                })
            }
            getImplementationACA(action).resolve()
        },
    },
}

function getBehaviour(action: MinionAction) {
    return behaviors[action.type] as MinionActionBehaviour | undefined
}

export function canDeclare(action: MinionAction): Validity {
    const behavior = getBehaviour(action)
    return behavior ? behavior.canDeclare(action) : VALID
}

export function declare(action: MinionAction): void {
    const behavior = getBehaviour(action)
    if (behavior) {
        behavior.declare(action)
    }
}

export function resolve(action: MinionAction): void {
    if (isBleed(action)) {
        return resolveBleed(action)
    }
    if (isHunt(action)) {
        return resolveHunt(action)
    }

    const behavior = getBehaviour(action)
    if (behavior) {
        behavior.resolve(action)
    }
}

function resolveBleed(action: MinionAction): void {
    const gameState = action.actingMinion.gameState

    if (!(action.target instanceof Player)) {
        throw new Error('Bleed target must be a player')
    }
    if (!gameState.action) {
        throw new Error('Resolve bleed without gameState.action')
    }

    gameMutations.changePool.act(action.actingMinion.controller, {
        player: action.target,
        amount: -Math.min(gameState.action.bleed, action.target.pool),
    })

    if (action.actingMinion.controller.oid != gameState.theEdgeControllerOid) {
        gameMutations.changeTheEdgeControl.act(action.actingMinion.controller, {
            theEdgeController: action.actingMinion.controller,
        })
    }
}

function resolveHunt(action: MinionAction): void {
    const gameState = action.actingMinion.gameState
    if (!gameState.action) {
        throw new Error('Resolve hunt without gameState.action')
    }

    gameMutations.changeBlood.act(action.actingMinion.controller, {
        card: action.actingMinion,
        amount: gameState.action.hunt,
    })
}
