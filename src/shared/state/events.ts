import { Minion } from '@/shared/model/Card.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { MinionAction } from '@/shared/types/state.ts'
import { TriggerEffect } from '@/shared/cardImpl/catalog/types.ts'
import { queueOptionalTriggers } from '@/shared/state/triggers.ts'

/**
 * The named events: what the engine announces, at fixed points of the mutations that cause
 * them, for the cards that react to it. The engine does not know which cards care.
 * The payloads are read-only data.
 */
export type GameEvent =
    // A block attempt failed ( the stealth is higher than the intercept ): the action goes on
    | { type: 'blockFailed'; action: MinionAction; blocker: Minion }
    // The action is about to resolve ( no block stands )
    | { type: 'actionResolving'; action: MinionAction }
    // The action is over. It is successful when it was not blocked: nobody blocked, or the blocks
    // failed ( it does not need to have had an effect ). A block that succeeded ends it unsuccessful.
    | { type: 'actionResolved'; action: MinionAction; successful: boolean }

export type EventName = GameEvent['type']

export type EventObserver = (gameState: GameState, event: GameEvent) => void

const observers = new Set<EventObserver>()

// Watches every event ( scenarios, logging ). Returns the function that stops it.
export function addEventObserver(observer: EventObserver): () => void {
    observers.add(observer)
    return () => {
        observers.delete(observer)
    }
}

export function emitEvent(gameState: GameState, event: GameEvent): void {
    for (const observer of [...observers]) {
        observer(gameState, event)
    }
    runArmedTriggers(gameState, event)
    queueOptionalTriggers(gameState, event)
}

// The minion an effect of an armed trigger is about, in the event
function getEffectMinion(effect: TriggerEffect, event: GameEvent): Minion | null {
    if (effect.type == 'lock' && event.type == 'blockFailed') {
        return event.blocker
    }
    return null
}

// The event an effect waits for, if it is deferred
function getDeferral(effect: TriggerEffect): EventName | undefined {
    return effect.type == 'lock' ? effect.at : undefined
}

function applyEffect(effect: TriggerEffect, minion: Minion): void {
    if (effect.type == 'lock') {
        minion.lock()
    }
}

// The triggers armed in the action in progress react to the event, then the effects that waited
// for this event are applied. Only the action in progress is watched: an armed trigger lives with it.
function runArmedTriggers(gameState: GameState, event: GameEvent): void {
    for (const armed of gameState.action?.armedTriggers ?? []) {
        const due = armed.deferred.filter(deferred => getDeferral(deferred.effect) == event.type)
        armed.deferred = armed.deferred.filter(deferred => !due.includes(deferred))
        for (const { effect, minion } of due) {
            applyEffect(effect, minion)
        }

        if (armed.trigger.on != event.type) {
            continue
        }
        for (const effect of armed.trigger.effects) {
            const minion = getEffectMinion(effect, event)
            if (!minion) {
                continue
            }
            if (!getDeferral(effect)) {
                applyEffect(effect, minion)
            } else if (
                !armed.deferred.some(other => other.minion == minion && other.effect == effect)
            ) {
                armed.deferred.push({ effect, minion })
            }
        }
    }
}
