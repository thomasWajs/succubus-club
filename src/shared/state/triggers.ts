import { Minion } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { Sect } from '@/shared/const/model.ts'
import { getCardDef } from '@/shared/cardImpl/catalog/index.ts'
import { EventCondition, Trigger } from '@/shared/cardImpl/catalog/types.ts'
import { GameEvent } from '@/shared/state/events.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { PendingTrigger } from '@/shared/types/state.ts'

/**
 * The optional triggers of the cards in play: when an event is announced, the ones that apply
 * to a bot are queued as pending triggers, which the bot decides one by one ( use it or not ).
 * Humans play by hand: nothing is ever queued for them.
 */

export function getCardTriggers(source: Minion): Trigger[] {
    return getCardDef(source)?.crypt?.triggers ?? []
}

export function getTrigger(pending: PendingTrigger): Trigger | undefined {
    return getCardTriggers(pending.source)[pending.index]
}

export function getTriggerKey(source: Minion, index: number): string {
    return `${source.oid}:${index}`
}

function isInSourceRegion(source: Minion, trigger: Trigger): boolean {
    const regions = trigger.sourceIn ?? ['ready']
    return (
        (regions.includes('ready') && source.isIn.ready) ||
        (regions.includes('torpor') && source.isIn.torpor)
    )
}

// Whether the trigger could be used now: the card is where it must be, the limit is not
// reached and the cost can be paid. Not about the event: that is checked when it is queued.
export function canUseTrigger(gameState: GameState, source: Minion, index: number): boolean {
    const trigger = getCardTriggers(source)[index]
    if (!trigger || !isInSourceRegion(source, trigger)) {
        return false
    }
    if (
        trigger.limit == 'oncePerTurn' &&
        gameState.turnResources.usedTriggers.includes(getTriggerKey(source, index))
    ) {
        return false
    }
    return !trigger.cost || source.blood >= trigger.cost.amount
}

function meetsCondition(condition: EventCondition, source: Minion, event: GameEvent): boolean {
    const actor = event.action.actingMinion
    if (condition.other && actor == source) {
        return false
    }
    if (condition.controller == 'self' && actor.controller != source.controller) {
        return false
    }
    if (condition.sect == 'Anarch') {
        return actor.isVampire() && actor.vampireAttrs.sect == Sect.Anarch
    }
    return true
}

// The players in turn order, starting with the active one
function getPlayersFromActive(gameState: GameState): Player[] {
    const players = gameState.competingPlayers
    const start = Math.max(0, gameState.activePlayerIndex)
    return [...players.slice(start), ...players.slice(0, start)]
}

export function queueOptionalTriggers(gameState: GameState, event: GameEvent): void {
    for (const player of getPlayersFromActive(gameState)) {
        if (!player.isBot) {
            continue
        }
        for (const source of [...player.ready.cards, ...player.torpor.cards]) {
            if (!source.isMinion() || source.controller != player) {
                continue
            }
            getCardTriggers(source).forEach((trigger, index) => {
                if (
                    trigger.mode == 'optional' &&
                    trigger.on == event.type &&
                    (trigger.when ?? []).every(condition =>
                        meetsCondition(condition, source, event),
                    ) &&
                    canUseTrigger(gameState, source, index)
                ) {
                    gameState.pendingTriggers.push({ source, index })
                }
            })
        }
    }
}
