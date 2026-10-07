import { Card, LibraryCard, Minion } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { botMutations } from '@/shared/state/botMutations.ts'
import { payCardCosts } from '@/shared/state/cardCosts.ts'
import { Discipline, LEAVE_TORPOR_COST, LibraryCardType, Sect } from '@/shared/const/model.ts'
import {
    ActionCardFromHandAction,
    ActionModifier,
    ActionModifierType,
    BecomeAnarchAction,
    BleedAction,
    DeclarationType,
    EnterCombatAction,
    HuntAction,
    Invalid,
    LeaveTorporAction,
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
    getCryptImplementation,
    getImplementation,
} from '@/shared/cardImpl/index.ts'
import { startCombat } from '@/shared/state/combatState.ts'

// Returns the hand-written implementation for an action card, or null when the
// card has none. A human can play any of the ~4000 cards, most of which fall here.
function tryGetImplementationACA(action: ActionCardFromHandAction) {
    return getImplementation(
        ACTION_CARD_IMPLEMENTATIONS,
        action.card,
        action.actingMinion,
        action.usage,
    )
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

// The modifier is played by the minion of the action in progress, unless it says otherwise.
export function applyActionModifier(actionModifier: ActionModifier, actingMinion: Minion): void {
    const implementation = getImplementation(
        ACTION_MODIFIER_CARD_IMPLEMENTATIONS,
        actionModifier.card,
        actionModifier.by ?? actingMinion,
        actionModifier.usage,
    )
    if (!implementation) {
        throw new Error('ActionModifier has no implementation')
    }
    implementation.apply()
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

export function getName(action: MinionAction) {
    if (action.type == MinionActionType.ActionCardFromHand) {
        return action.card.name
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

// A vampire can have a stealth of its own for the actions that are not directed
export function getDefaultStealth(action: MinionAction): number {
    const own =
        isUndirected(action) ?
            (getCryptImplementation(action.actingMinion)?.undirectedStealth ?? 0)
        :   0
    return baseStealth(action) + own
}

// The strength the acting minion can gain in the first round if the action is blocked
export function getBlockedStrengthBonus(action: MinionAction): number {
    return action.type == MinionActionType.ActionCardFromHand ?
            (tryGetImplementationACA(action)?.blockedStrengthBonus ?? 0)
        :   0
}

function baseStealth(action: MinionAction): number {
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

export function getPoliticalActionCard(action: MinionAction): LibraryCard | null {
    if (
        action.type != MinionActionType.ActionCardFromHand &&
        action.type != MinionActionType.ActionInPlay
    ) {
        return null
    }
    const card = action.card
    return card instanceof LibraryCard && card.type == LibraryCardType.PoliticalAction ? card : null
}

export function isPoliticalAction(action: MinionAction): boolean {
    return getPoliticalActionCard(action) !== null
}

// Is everything the others need to react known as soon as the action is declared ? True for the
// built-in actions (a rescue or a diablerie is only declared once its target is). An action card
// still waits for its discipline level, target and X, and an action in play cannot be understood.
export function isDeclarationComplete(action: MinionAction): boolean {
    return (
        action.type != MinionActionType.ActionCardFromHand &&
        action.type != MinionActionType.ActionInPlay
    )
}

// Does the engine know how to resolve this action ? The built-in actions it resolves, and the action
// cards that have an implementation. Everything else (an action in play, a diablerie, any card a human
// plays) is resolved by hand.
export function isResolvable(action: MinionAction): boolean {
    switch (action.type) {
        case MinionActionType.Bleed:
        case MinionActionType.Hunt:
        case MinionActionType.LeaveTorpor:
        case MinionActionType.RescueFromTorpor:
        case MinionActionType.EnterCombat:
            return true
        case MinionActionType.ActionCardFromHand:
            return tryGetImplementationACA(action) !== null
        default:
            return false
    }
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

// For the actions that need nothing more than their generic ( state ) handling
const NO_BEHAVIOUR: MinionActionBehaviour = {
    canDeclare: () => VALID,
    declare() {},
    resolve() {},
}

// A minion can only start an action while ready and unlocked
function canAct(minion: Minion): Validity {
    if (!minion.isIn.ready) {
        return Invalid('Acting minion must be ready')
    }
    if (minion.isLocked) {
        return Invalid('Acting minion must be unlocked')
    }
    return VALID
}

const behaviors: Behaviors = {
    [MinionActionType.Bleed]: {
        ...NO_BEHAVIOUR,
        canDeclare(action: BleedAction) {
            if (action.target != action.actingMinion.controller.prey) {
                return Invalid('A bleed can only target the prey')
            }
            return canAct(action.actingMinion)
        },
        resolve: resolveBleed,
    },

    [MinionActionType.Hunt]: {
        ...NO_BEHAVIOUR,
        canDeclare(action: HuntAction) {
            if (!action.actingMinion.isVampire()) {
                return Invalid('Only a vampire can hunt')
            }
            return canAct(action.actingMinion)
        },
        resolve: resolveHunt,
    },

    [MinionActionType.EnterCombat]: {
        ...NO_BEHAVIOUR,
        canDeclare(action: EnterCombatAction) {
            const minion = action.actingMinion
            if (!getCryptImplementation(minion)?.canEnterCombat) {
                return Invalid('This minion cannot enter combat as an action')
            }
            const acting = canAct(minion)
            if (!acting.isValid) {
                return acting
            }
            return canEnterCombatWith(minion, action.target)
        },
        resolve(action: EnterCombatAction) {
            startCombat(action.actingMinion.gameState, action.actingMinion, action.target)
        },
    },

    [MinionActionType.BecomeAnarch]: {
        ...NO_BEHAVIOUR,
        canDeclare(action: BecomeAnarchAction) {
            const minion = action.actingMinion
            if (!minion.isVampire()) {
                return Invalid('Only a vampire can become anarch')
            }
            if (minion.vampireAttrs.sect == Sect.Anarch) {
                return Invalid('Acting vampire is already an anarch')
            }
            return canAct(minion)
        },
    },

    // Played by hand ( ActionInfos ), nothing is resolved by the engine
    [MinionActionType.ActionInPlay]: NO_BEHAVIOUR,

    // Resolved by hand, not offered to bots yet
    [MinionActionType.Diablerize]: NO_BEHAVIOUR,

    [MinionActionType.LeaveTorpor]: {
        declare() {},
        canDeclare(action: LeaveTorporAction) {
            if (!action.actingMinion.isIn.torpor) {
                return Invalid('Acting vampire must be in torpor')
            }
            if (action.actingMinion.isLocked) {
                return Invalid('Acting vampire must be unlocked')
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
            const acting = canAct(action.actingMinion)
            if (!acting.isValid) {
                return acting
            }
            if (!action.target.isIn.torpor) {
                return Invalid('Rescued vampire must be in torpor')
            }
            const paidByActing = action.bloodPaidByActingMinion ?? 0
            const paidByRescued = action.bloodPaidByRescuedMinion ?? 0
            if (paidByActing + paidByRescued != LEAVE_TORPOR_COST) {
                return Invalid('The blood paid must be exactly the cost to leave torpor')
            }
            if (paidByActing > action.actingMinion.blood || paidByRescued > action.target.blood) {
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
            if (!action.card.isIn.hand) {
                return Invalid('Action card must be in hand')
            }
            const acting = canAct(action.actingMinion)
            if (!acting.isValid) {
                return acting
            }

            // Check the acting vampire actually has each declared discipline
            // use. Multi-discipline cards declare several uses ; the vampire must
            // satisfy them all.
            const cardDiscipline = action.card.resource.discipline as Discipline
            if (cardDiscipline) {
                const disciplineUses = action.usage.disciplines ?? []
                if (disciplineUses.length == 0) {
                    return Invalid('Usage has no discipline')
                }
                for (const use of disciplineUses) {
                    if (!action.actingMinion.hasDiscipline(use.discipline, use.level)) {
                        return Invalid("Acting vampire doesn't have corresponding discipline level")
                    }
                }
            }
            // Rule: a bleed can only target the prey
            if (isBleed(action) && action.target !== action.actingMinion.controller.prey) {
                return Invalid('A bleed can only target the prey')
            }
            // A card with no implementation ( any card a human plays ) is never refused
            return tryGetImplementationACA(action)?.canDeclare() ?? VALID
        },
        // An action only pays its costs when it succeeds ( a blocked action
        // never resolves ). The other card types pay when they are played.
        resolve(action: ActionCardFromHandAction) {
            payCardCosts(action.actingMinion, action.card, action.usage.x)
            if (isBleed(action)) {
                resolveBleed(action)
            }
            if (isHunt(action)) {
                resolveHunt(action)
            }
            const implementation = getImplementationACA(action)
            implementation.resolve()
            // Only a bot's card is attached for now: a human puts it where they want
            if (implementation.attachesToMinion && action.actingMinion.controller.isBot) {
                const player = action.actingMinion.controller
                const attached = botMutations.attachCard.act(player, {
                    card: action.card,
                    minion: implementation.attachHost,
                    disciplines: action.usage.disciplines,
                })
                if (!attached.isValid) {
                    throw new Error(`Cannot attach ${action.card.name}: ${attached.reason}`)
                }
                // A retainer comes in play with its life counters
                if (implementation.attachedLife > 0) {
                    gameMutations.changeBlood.act(player, {
                        card: action.card,
                        amount: implementation.attachedLife,
                    })
                }
            }
        },
    },
}

// A minion can enter combat with a ready minion of another Methuselah
export function canEnterCombatWith(minion: Minion, target: Minion): Validity {
    if (!target.isIn.ready) {
        return Invalid('The target must be ready')
    }
    if (target.controller == minion.controller) {
        return Invalid('The target must be controlled by another Methuselah')
    }
    return VALID
}

function getBehaviour(action: MinionAction) {
    return behaviors[action.type] as MinionActionBehaviour
}

export function canDeclare(action: MinionAction): Validity {
    return getBehaviour(action).canDeclare(action)
}

export function declare(action: MinionAction): void {
    getBehaviour(action).declare(action)
}

export function resolve(action: MinionAction): void {
    getBehaviour(action).resolve(action)
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
