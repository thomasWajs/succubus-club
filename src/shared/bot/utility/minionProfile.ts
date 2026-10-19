import { ALLY_CAPACITY, Card, LibraryCard, Minion } from '@/shared/model/Card.ts'
import { parseAllyStats } from '@/shared/model/allyStats.ts'
import { resolveCost } from '@/shared/state/cardCosts.ts'
import { getAttachedCards } from '@/shared/state/attachments.ts'
import {
    getAllyAbilities,
    getAttachedEffects,
    getKitCards,
    getMinionStrength,
    isEquipment,
    isRetainer,
} from '@/shared/cardImpl/catalog/attached.ts'
import { gameResources } from '@/shared/registries.ts'
import { DEFAULT_CARD_ATTRS } from '@/shared/const/model.ts'
import { CryptCardResource, Disciplines } from '@/shared/types/resources.ts'
import { KrcgId } from '@/shared/types/gateway.ts'
import { CardOid, PlayerOid } from '@/shared/types/model.ts'
import { AllyAbility, MinionFilter } from '@/shared/cardImpl/catalog/types.ts'
import {
    Effect,
    PlaySummary,
    summarizeAttached,
    summarizeCard,
    summarizeCardId,
} from '@/shared/bot/utility/summaries.ts'

/**
 * The effective minion: its crypt card plus what is attached to it ( equipment, retainers ). One
 * function read by the table assessment, the defence profile, the combat model and the block gate, so
 * they all use the same numbers. Everything here is public: a minion in play is face up and so are the
 * cards attached to it, whoever the controller is.
 */

export type MinionState = 'unlocked' | 'locked' | 'torpor'

export type StrikeKit = {
    damage: number
    ranged: boolean
    aggravated: boolean
    // The weapon also gives a maneuver that chooses this strike, once per combat
    maneuver: boolean
}

// What one card attached to a minion brings to a combat
export type AttachedKit = {
    name: string
    retainer: boolean
    // An equipment card: a strike can burn it
    equipment: boolean
    // The card was burned in the combat ( an equipment, by a strike ): it does nothing any more
    burned: boolean
    // The life counters of a retainer
    life: number
    strikes: StrikeKit[]
    // The card gives its bearer a strike that burns an equipment of the opposing minion
    burnsEquipment: boolean
    // The damage that each of its effects prevents, once per combat in all
    prevention: number[]
    // The damage it inflicts on the opposing minion each round
    environmental: number
    // A dodge strike it gives its bearer once per combat
    dodge: boolean
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
    // What losing it costs, in counters: the capacity of a vampire, what an ally cost and does ( allyWorth )
    worth: number
    disciplines: Partial<Disciplines>
    // Its own bleed ( crypt text included ): what an action of it bleeds, before any card
    bleed: number
    // The blood a hunt of it gives ( 0 for a minion that is not a vampire )
    hunt: number
    // The blood that the cards attached to it carry from it to the pool, at most, each turn ( a Blood Doll,
    // a Vessel ): 0 when it has none
    bloodMove: number
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
    // The same, card by card
    attachedKits: AttachedKit[]
    canEnterCombat: boolean
    // An ally that can burn this much life to give a minion of its controller a press ( 0: it cannot )
    pressBurn: number
}

function sum(effects: Effect[], pick: (effect: Effect) => number): number {
    return effects.reduce((total, effect) => total + pick(effect), 0)
}

function kitOf(card: Card): AttachedKit {
    return kitFrom(
        card.name,
        summarizeAttached(getAttachedEffects(card)),
        isRetainer(card),
        isEquipment(card),
        isRetainer(card) ? card.blood : 0,
    )
}

function kitFrom(
    name: string,
    effects: Effect[],
    retainer: boolean,
    equipment: boolean,
    life: number,
): AttachedKit {
    return {
        name,
        retainer,
        equipment,
        burned: false,
        life,
        burnsEquipment: effects.some(effect => effect.type == 'burnEquipmentStrike'),
        strikes: effects.flatMap(effect =>
            effect.type == 'weaponStrike' ?
                [
                    {
                        damage: effect.damage,
                        ranged: effect.ranged,
                        aggravated: effect.aggravated,
                        maneuver: effect.maneuver,
                    },
                ]
            :   [],
        ),
        prevention: effects.flatMap(effect =>
            effect.type == 'preventDamage' ? [effect.amount] : [],
        ),
        environmental: sum(effects, effect =>
            effect.type == 'environmentalDamage' ? effect.amount : 0,
        ),
        dodge: effects.some(effect => effect.type == 'dodgeOnce'),
    }
}

function pressBurnOf(abilities: AllyAbility[]): number {
    for (const ability of abilities) {
        if (ability.activate == 'burnLifeForPress') {
            return ability.life
        }
    }
    return 0
}

// What an ally is worth: the counters it cost, at least one, and a counter for what it can do ( each ability, a kit of
// its own ). Draft numbers
function allyWorth(card: LibraryCard, abilities: number, kit: boolean): number {
    const cost = resolveCost(card.poolCost) + resolveCost(card.bloodCost)
    return Math.max(1, cost) + abilities + (kit ? 1 : 0)
}

function worthOf(minion: Minion, kitCards: Card[]): number {
    if (minion.isVampire() || !(minion instanceof LibraryCard)) {
        return minion.minionAttrs.capacity
    }
    return allyWorth(minion, getAllyAbilities(minion).length, kitCards.includes(minion))
}

export function profileMinion(minion: Minion): MinionProfile {
    const attachedCards = getAttachedCards(minion)
    // An ally in play carries its own card as a kit ( its strikes, its intercept )
    const kitCards = getKitCards(minion)
    const attached = kitCards.flatMap(card => summarizeAttached(getAttachedEffects(card)))
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
    // The bleed a vampire is forced to make when a minion of its Methuselah is locked
    const forcedBleed = sum(crypt, effect =>
        (
            effect.type == 'mustBleedWhileMinionLocked' &&
            minion.controller.minionsReady.some(other => other != minion && other.isLocked)
        ) ?
            effect.bonus
        :   0,
    )
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
        worth: worthOf(minion, kitCards),
        disciplines: minion.minionAttrs.disciplines,
        bleed: minion.minionAttrs.bleed + forcedBleed,
        hunt: minion.isVampire() ? minion.vampireAttrs.hunt : 0,
        bloodMove: sum(attached, effect => (effect.type == 'moveBlood' ? effect.amount : 0)),
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
            maneuver: effect.maneuver,
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
        attachedKits: kitCards.map(card => kitOf(card)),
        canEnterCombat: crypt.some(effect => effect.type == 'canEnterCombat'),
        pressBurn: pressBurnOf(minion instanceof LibraryCard ? getAllyAbilities(minion) : []),
    }
}

// A vampire of the crypt that nobody sees ( not in play, not drawn ): what the cardbase and the catalog say of the
// card, as the vampire would be with no blood. Null when the cardbase does not know the id or it is not a vampire.
export function profileCryptId(
    id: KrcgId,
    oid: CardOid,
    controller: PlayerOid,
): MinionProfile | null {
    const resource = gameResources.cardbase[id]
    if (!resource || !('capacity' in resource)) {
        return null
    }
    const crypt = resource as CryptCardResource
    const effects = summarizeCardId(id)?.cryptEffects ?? []
    const bleed =
        DEFAULT_CARD_ATTRS.Bleed + sum(effects, e => (e.type == 'ownBleed' ? e.amount : 0))
    const stealth = sum(effects, e => (e.type == 'undirectedStealth' ? e.amount : 0))
    const directed = sum(effects, e => (e.type == 'directedIntercept' ? e.amount : 0))
    return {
        oid,
        name: crypt.name,
        controller,
        state: 'unlocked',
        isVampire: true,
        clan: crypt.clan,
        sect: crypt.sect,
        title: crypt.title,
        blood: 0,
        capacity: crypt.capacity,
        worth: crypt.capacity,
        disciplines: crypt.disciplines,
        bleed,
        hunt: DEFAULT_CARD_ATTRS.Hunt,
        bloodMove: 0,
        strength: DEFAULT_CARD_ATTRS.Strength,
        undirectedStealth: stealth,
        intercept: {
            general: DEFAULT_CARD_ATTRS.Intercept,
            directed: DEFAULT_CARD_ATTRS.Intercept + directed,
            againstBleeds: DEFAULT_CARD_ATTRS.Intercept + directed,
        },
        life: 0,
        prevention: [],
        weaponStrikes: [],
        freeManeuver: false,
        environmentalDamage: 0,
        forbiddenPlays: [],
        burnsInTorpor: false,
        attached: [],
        attachedKits: [],
        canEnterCombat: effects.some(effect => effect.type == 'canEnterCombat'),
        pressBurn: 0,
    }
}

// The ally of the hand as it would stand once recruited by this play: its life, its numbers of that version, its kit
export function profileRecruit(
    card: LibraryCard,
    play: PlaySummary,
    controller: PlayerOid,
): MinionProfile {
    const printed = parseAllyStats(card.text)
    const version = play.recruit ?? {}
    const kit = play.attached
    const general = sum(kit, effect =>
        effect.type == 'intercept' && !effect.bleedsOnly ? effect.amount : 0,
    )
    const bleedsOnly = sum(kit, effect =>
        effect.type == 'intercept' && effect.bleedsOnly ? effect.amount : 0,
    )
    const own = kitFrom(card.name, kit, false, false, 0)
    return {
        oid: card.oid,
        name: card.name,
        controller,
        state: 'unlocked',
        isVampire: false,
        clan: '',
        sect: '',
        title: '',
        blood: version.life ?? printed.life,
        capacity: ALLY_CAPACITY,
        worth: allyWorth(card, play.allyAbilities.length, kit.length > 0),
        disciplines: {},
        bleed: version.bleed ?? printed.bleed,
        hunt: 0,
        bloodMove: 0,
        strength:
            (version.strength ?? printed.strength) +
            sum(kit, effect => (effect.type == 'strength' ? effect.amount : 0)),
        undirectedStealth: 0,
        intercept: { general, directed: general, againstBleeds: general + bleedsOnly },
        life: 0,
        prevention: own.prevention,
        weaponStrikes: own.strikes,
        freeManeuver: own.strikes.some(strike => strike.maneuver),
        environmentalDamage: own.environmental,
        forbiddenPlays: [],
        burnsInTorpor: false,
        attached: [],
        attachedKits: kit.length > 0 ? [own] : [],
        canEnterCombat: false,
        pressBurn: pressBurnOf(play.allyAbilities),
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
