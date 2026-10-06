import { LibraryCard, Minion } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { ACTION_TYPES, LibraryCardType } from '@/shared/const/model.ts'
import {
    ActionCardFromHandAction,
    ActionModifier,
    ActionModifierType,
    BecomeAnarchAction,
    BleedAction,
    EnterCombatAction,
    HuntAction,
    LeaveTorporAction,
    LibraryCardUsage,
    MinionActionType,
    RescueFromTorporAction,
} from '@/shared/types/state.ts'

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

export function createEnterCombatAction(actingMinion: Minion, target: Minion): EnterCombatAction {
    return {
        type: MinionActionType.EnterCombat,
        actingMinion,
        target,
    }
}

export function createActionCardAction(
    actingMinion: Minion,
    actionCard: LibraryCard,
    usage: LibraryCardUsage,
): ActionCardFromHandAction {
    if (!ACTION_TYPES.some(type => actionCard.hasType(type))) {
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
    by?: Minion,
): ActionModifier {
    if (!actionModifierCard.hasType(LibraryCardType.ActionModifier)) {
        throw new Error("ActionModifier needs a LibraryCard with type 'ActionModifier'")
    }

    return {
        type: ActionModifierType,
        card: actionModifierCard,
        usage,
        ...(by && { by }),
    }
}
