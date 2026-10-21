import { Card } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { Sect } from '@/shared/const/model.ts'
import { getCardDef } from '@/shared/cardImpl/catalog/index.ts'
import { EventCondition, Trigger } from '@/shared/cardImpl/catalog/types.ts'
import { GameEvent } from '@/shared/state/events.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { getHost } from '@/shared/state/attachments.ts'
import { isDirected, isHunt } from '@/shared/state/minionActions.ts'
import { PendingTrigger } from '@/shared/types/state.ts'

/**
 * The optional triggers of the cards in play ( a vampire, a master card ): when an event is announced, the
 * ones that apply to a bot are queued as pending triggers, which the bot decides one by one ( use it or not ).
 * Humans play by hand: nothing is ever queued for them.
 */

export function getCardTriggers(source: Card): Trigger[] {
    const def = getCardDef(source)
    if (def?.crypt) {
        return def.crypt.triggers ?? []
    }
    return def?.plays.flatMap(play => (play.kind == 'master' ? (play.triggers ?? []) : [])) ?? []
}

export function getTrigger(pending: PendingTrigger): Trigger | undefined {
    return getCardTriggers(pending.source)[pending.index]
}

export function getTriggerKey(source: Card, index: number): string {
    return `${source.oid}:${index}`
}

function isInSourceRegion(source: Card, trigger: Trigger): boolean {
    const regions = trigger.sourceIn ?? ['ready']
    return (
        (regions.includes('ready') && source.isIn.ready) ||
        (regions.includes('torpor') && source.isIn.torpor)
    )
}

// Whether the trigger could be used now: the card is where it must be, the limit is not
// reached and the cost can be paid. Not about the event: that is checked when it is queued.
export function canUseTrigger(gameState: GameState, source: Card, index: number): boolean {
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
    if (trigger.cost?.type == 'lockSelf') {
        return !source.isLocked
    }
    return !trigger.cost || source.blood >= trigger.cost.amount
}

// The source is null for a trigger armed by a played card: the conditions about the card that has the
// trigger ( `other`, `controller` ) do not apply
export function meetsCondition(
    condition: EventCondition,
    source: Card | null,
    event: GameEvent,
): boolean {
    if (condition.type == 'actionSuccessful') {
        return event.type == 'actionResolved' && event.successful
    }
    if (condition.type == 'actionIs') {
        return condition.kind == 'hunt' ? isHunt(event.action) : !isDirected(event.action)
    }
    if (condition.type == 'blockerIsBearer') {
        return !!source && event.type == 'blockDeclared' && event.blocker == getHost(source)
    }
    const actor = event.action.actingMinion
    if (source && condition.other && actor == source) {
        return false
    }
    if (source && condition.controller == 'self' && actor.controller != source.controller) {
        return false
    }
    if (
        condition.sect == 'Anarch' &&
        !(actor.isVampire() && actor.vampireAttrs.sect == Sect.Anarch)
    ) {
        return false
    }
    if (condition.clan && !(actor.isVampire() && actor.vampireAttrs.clan == condition.clan)) {
        return false
    }
    if (
        condition.titled !== undefined &&
        !(actor.isVampire() && !!actor.vampireAttrs.title == condition.titled)
    ) {
        return false
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
            if (source.controller != player) {
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
                    gameState.pendingTriggers.push({
                        source,
                        index,
                        actor: event.action.actingMinion,
                    })
                }
            })
        }
    }
}
