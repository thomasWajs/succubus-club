import { Card, LibraryCard, Minion } from '@/shared/model/Card.ts'
import { LibraryCardType } from '@/shared/const/model.ts'
import { getAttachedCards } from '@/shared/state/attachments.ts'
import { isBleed, isDirected } from '@/shared/state/minionActions.ts'
import { getCardDef } from '@/shared/cardImpl/catalog/index.ts'
import { findPlay, playsOfKind } from '@/shared/cardImpl/catalog/requirements.ts'
import { Player } from '@/shared/model/Player.ts'
import { KrcgId } from '@/shared/types/gateway.ts'
import {
    ActionPlay,
    AttachedEffect,
    MasterPlay,
    MinionFilter,
} from '@/shared/cardImpl/catalog/types.ts'

/**
 * What the cards attached to a minion do, read from the catalog. The play the card was played
 * with ( GameState.attachmentUsages ) says which version of the card it is; a card with no record
 * ( a stolen retainer of a human ) has its first version.
 */

function getAttachedPlay(card: Card): ActionPlay | MasterPlay | undefined {
    const def = getCardDef(card)
    if (!def) {
        return undefined
    }
    const disciplines = card.gameState.attachmentUsages[card.oid]
    const played = disciplines && findPlay(def, 'action', { disciplines })
    return (
        played ??
        playsOfKind(def, 'action').find(play => play.staysInPlay == 'onMinion') ??
        playsOfKind(def, 'master').find(play => play.staysInPlay == 'onMinion')
    )
}

export function getAttachedEffects(card: Card): AttachedEffect[] {
    return getAttachedPlay(card)?.attached ?? []
}

export function isRetainer(card: Card): boolean {
    return card instanceof LibraryCard && card.type == LibraryCardType.Retainer
}

// The retainers attached to the minion
export function getRetainers(minion: Minion): Card[] {
    return getAttachedCards(minion).filter(isRetainer)
}

// The intercept of the minion for the block attempt against the action in progress
export function getMinionIntercept(minion: Minion): number {
    const action = minion.gameState.action?.minionAction
    const directed = action && isDirected(action) ? getCardDef(minion)?.crypt?.directedIntercept : 0
    const bleedAtController = !!action && isBleed(action) && action.target == minion.controller
    return getAttachedCards(minion)
        .flatMap(getAttachedEffects)
        .reduce(
            (sum, effect) => {
                if (effect.type == 'intercept') {
                    return sum + effect.amount
                }
                return effect.type == 'bleedIntercept' && bleedAtController ?
                        sum + effect.amount
                    :   sum
            },
            minion.minionAttrs.intercept + (directed ?? 0),
        )
}

// The card is burned when its bearer is in torpor
export function burnsInTorpor(card: Card): boolean {
    return getAttachedEffects(card).some(effect => effect.type == 'burnInTorpor')
}

// The strength the minion starts a combat with
export function getMinionStrength(minion: Minion): number {
    return getAttachedCards(minion)
        .flatMap(getAttachedEffects)
        .reduce(
            (sum, effect) => (effect.type == 'strength' ? sum + effect.amount : sum),
            minion.minionAttrs.strength,
        )
}

// The environmental damage the retainers of the minion inflict on the opposing minion each round
export function getEnvironmentalDamage(minion: Minion): number {
    return getAttachedCards(minion)
        .flatMap(getAttachedEffects)
        .reduce(
            (sum, effect) => (effect.type == 'environmentalDamage' ? sum + effect.amount : sum),
            0,
        )
}

// An attached card says the minion cannot play a card ( "cannot play cards named Torn Signpost" )
export function isPlayForbiddenToMinion(minion: Minion, card: LibraryCard): boolean {
    return getAttachedCards(minion)
        .flatMap(getAttachedEffects)
        .some(effect => effect.type == 'cannotPlay' && effect.names.includes(card.name))
}

// The minion already has a copy of the card ( "a vampire can have only one Preternatural Strength" )
export function hasAttachedCopy(minion: Minion, krcgId: KrcgId): boolean {
    return getAttachedCards(minion).some(attached => attached.krcgId == krcgId)
}

export function matchesMinionFilter(minion: Minion, filter: MinionFilter): boolean {
    const { minCapacity, maxCapacity, clan, sect } = filter
    if (filter.of == 'vampire' && !minion.isVampire()) {
        return false
    }
    if (filter.ready && !minion.isIn.ready) {
        return false
    }
    if ((clan || sect) && !minion.isVampire()) {
        return false
    }
    if (minion.isVampire()) {
        const { clan: minionClan, sect: minionSect } = minion.vampireAttrs
        if (clan && minionClan.toLowerCase() != clan.toLowerCase()) {
            return false
        }
        if (sect && minionSect.toLowerCase() != sect.toLowerCase()) {
            return false
        }
    }
    const { capacity } = minion.minionAttrs
    return (
        (minCapacity === undefined || capacity >= minCapacity) &&
        (maxCapacity === undefined || capacity <= maxCapacity)
    )
}

// The minions of the player ( ready, or in torpor ) a card can be put on
export function getAttachCandidates(player: Player, filter: MinionFilter): Minion[] {
    return [...player.minionsReady, ...player.vampiresInTorpor].filter(minion =>
        matchesMinionFilter(minion, filter),
    )
}
