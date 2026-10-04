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
} from '@/shared/cardImpl/index.ts'
import {
    createActionCardAction,
    createActionModifier,
    singleDisciplineUsage,
} from '@/shared/state/minionActions.ts'

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

function canPayCosts(minion: Minion, card: LibraryCard): boolean {
    const player = minion.controller
    // Variable "X" costs are not supported yet
    if (card.bloodCost == 'X' || card.poolCost == 'X') {
        return false
    }
    return minion.blood >= card.bloodCost && player.pool > card.poolCost
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

function targetCandidates(minion: Minion): LibraryCardUsage['target'][] {
    const player = minion.controller
    const otherPlayers = player.gameState.competingPlayers.filter(other => other != player)
    return [undefined, ...otherPlayers, ...player.vampiresInUncontrolled]
}

export function getActionCardOptions(
    minion: Minion,
    card: LibraryCard,
): ActionCardFromHandAction[] {
    const Implementation = card.krcgId ? ACTION_CARD_IMPLEMENTATIONS[card.krcgId] : undefined
    if (!Implementation || !card.type || !ACTION_TYPES.includes(card.type)) {
        return []
    }
    if (!canPayCosts(minion, card)) {
        return []
    }

    const player = minion.controller
    const options: ActionCardFromHandAction[] = []

    for (const disciplines of disciplineChoices(minion, card)) {
        for (const target of targetCandidates(minion)) {
            const usage: LibraryCardUsage = {
                disciplines: disciplines.length > 0 ? disciplines : undefined,
                target,
            }
            const implementation = new Implementation(player, usage)
            if (!implementation.canDeclare(minion).isValid) {
                continue
            }
            // Rule: a bleed can only target the prey
            if (implementation.isBleed && target !== player.prey) {
                continue
            }
            options.push(createActionCardAction(minion, card, usage))
        }
    }
    return options
}

// Every level the minion can use is offered separately: the effects often differ
// a lot between inferior and superior.
export function getActionModifierOptions(minion: Minion, card: LibraryCard): ActionModifier[] {
    if (
        !card.krcgId ||
        !ACTION_MODIFIER_CARD_IMPLEMENTATIONS[card.krcgId] ||
        card.type != LibraryCardType.ActionModifier ||
        !canPayCosts(minion, card)
    ) {
        return []
    }

    return disciplineChoices(minion, card).map(([use]) =>
        createActionModifier(card, use ? singleDisciplineUsage(use.discipline, use.level) : {}),
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
