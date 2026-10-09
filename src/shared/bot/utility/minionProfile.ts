import { Minion } from '@/shared/model/Card.ts'
import { getAttachedCards } from '@/shared/state/attachments.ts'
import {
    getAttachedEffects,
    getMinionStrength,
    isRetainer,
} from '@/shared/cardImpl/catalog/attached.ts'
import { Disciplines } from '@/shared/types/resources.ts'
import { CardOid, PlayerOid } from '@/shared/types/model.ts'
import { MinionFilter } from '@/shared/cardImpl/catalog/types.ts'
import { Effect, summarizeAttached, summarizeCard } from '@/shared/bot/utility/summaries.ts'

/**
 * The effective minion: its crypt card plus what is attached to it ( equipment, retainers ). One
 * function read by the table assessment, the defence profile, the combat model and the block gate, so
 * they all use the same numbers. Everything here is public: a minion in play is face up and so are the
 * cards attached to it, whoever the controller is ( .claude/docs/bot-ai-phase3.md, section 3b point 8 ).
 */

export type MinionState = 'unlocked' | 'locked' | 'torpor'

export type StrikeKit = {
    damage: number
    ranged: boolean
    aggravated: boolean
}

export type MinionProfile = {
    oid: CardOid
    name: string
    controller: PlayerOid
    state: MinionState
    isVampire: boolean
    clan: string
    sect: string
    // 'baron', 'bishop'..., or '' ( a minion that is not a vampire has none )
    title: string
    blood: number
    capacity: number
    disciplines: Partial<Disciplines>
    // Its own bleed ( crypt text included ): what an action of it bleeds, before any card
    bleed: number
    // The strength it starts a combat with, attached cards included
    strength: number
    // What its crypt card changes to the stealth of its undirected actions
    undirectedStealth: number
    // Against an undirected action, a directed one, and a bleed aimed at its controller
    intercept: { general: number; directed: number; againstBleeds: number }
    // The life counters of its retainers: damage they soak is blood saved
    life: number
    // Damage a card attached to it prevents, once per combat, by card
    prevention: number[]
    weaponStrikes: StrikeKit[]
    // A weapon gives it a maneuver for free
    freeManeuver: boolean
    environmentalDamage: number
    // The cards it cannot play ( by name )
    forbiddenPlays: string[]
    // An attached card burns if it goes to torpor
    burnsInTorpor: boolean
    attached: string[]
    canEnterCombat: boolean
}

function sum(effects: Effect[], pick: (effect: Effect) => number): number {
    return effects.reduce((total, effect) => total + pick(effect), 0)
}

export function profileMinion(minion: Minion): MinionProfile {
    const attachedCards = getAttachedCards(minion)
    const attached = attachedCards.flatMap(card => summarizeAttached(getAttachedEffects(card)))
    const crypt = summarizeCard(minion)?.cryptEffects ?? []

    const general =
        minion.minionAttrs.intercept +
        sum(attached, effect =>
            effect.type == 'intercept' && !effect.bleedsOnly ? effect.amount : 0,
        )
    const directed =
        general + sum(crypt, effect => (effect.type == 'directedIntercept' ? effect.amount : 0))
    const againstBleeds =
        directed +
        sum(attached, effect =>
            effect.type == 'intercept' && effect.bleedsOnly ? effect.amount : 0,
        )

    const weapons = attached.flatMap(effect => (effect.type == 'weaponStrike' ? [effect] : []))
    return {
        oid: minion.oid,
        name: minion.name,
        controller: minion.controller.oid,
        state:
            minion.isIn.torpor ? 'torpor'
            : minion.isLocked ? 'locked'
            : 'unlocked',
        isVampire: minion.isVampire(),
        clan: minion.isVampire() ? minion.vampireAttrs.clan : '',
        sect: minion.isVampire() ? minion.vampireAttrs.sect : '',
        title: minion.isVampire() ? minion.vampireAttrs.title : '',
        blood: minion.blood,
        capacity: minion.minionAttrs.capacity,
        disciplines: minion.minionAttrs.disciplines,
        bleed: minion.minionAttrs.bleed,
        strength: getMinionStrength(minion),
        undirectedStealth: sum(crypt, effect =>
            effect.type == 'undirectedStealth' ? effect.amount : 0,
        ),
        intercept: { general, directed, againstBleeds },
        life: attachedCards.filter(isRetainer).reduce((total, card) => total + card.blood, 0),
        prevention: attached.flatMap(effect =>
            effect.type == 'preventDamage' ? [effect.amount] : [],
        ),
        weaponStrikes: weapons.map(effect => ({
            damage: effect.damage,
            ranged: effect.ranged,
            aggravated: effect.aggravated,
        })),
        freeManeuver: weapons.some(effect => effect.maneuver),
        environmentalDamage: sum(attached, effect =>
            effect.type == 'environmentalDamage' ? effect.amount : 0,
        ),
        forbiddenPlays: attached.flatMap(effect =>
            effect.type == 'restrictPlay' ? effect.names : [],
        ),
        burnsInTorpor: attached.some(effect => effect.type == 'burnsInTorpor'),
        attached: attachedCards.map(card => card.name),
        canEnterCombat: crypt.some(effect => effect.type == 'canEnterCombat'),
    }
}

// Does the minion fit what a card asks of the minions that use it ( the same rule as matchesMinionFilter )
export function profileMatches(profile: MinionProfile, filter: MinionFilter): boolean {
    if (filter.of == 'vampire' && !profile.isVampire) {
        return false
    }
    if (filter.ready && profile.state == 'torpor') {
        return false
    }
    if ((filter.clan || filter.sect) && !profile.isVampire) {
        return false
    }
    if (filter.clan && profile.clan.toLowerCase() != filter.clan.toLowerCase()) {
        return false
    }
    if (filter.sect && profile.sect.toLowerCase() != filter.sect.toLowerCase()) {
        return false
    }
    const { minCapacity, maxCapacity } = filter
    return (
        (minCapacity === undefined || profile.capacity >= minCapacity) &&
        (maxCapacity === undefined || profile.capacity <= maxCapacity)
    )
}
