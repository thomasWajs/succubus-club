import { Card } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { getAttachedCards } from '@/shared/state/attachments.ts'
import { newStrike } from '@/shared/state/combatRules.ts'
import { CombatantMinion, CombatState, CombatStrike } from '@/shared/types/state.ts'
import { BotOption } from '@/shared/bot/types.ts'
import { CombatSim, Move, Side, SimCombatant, SimStrike } from '@/shared/bot/utility/combatModel.ts'
import { CardFacts, combatantOf } from '@/shared/bot/utility/combatSetup.ts'
import { profileMinion } from '@/shared/bot/utility/minionProfile.ts'

/**
 * The combat of the engine and the combat of the model: an
 * engine combat read into a model one at any point of it, and the moves of the model told from the options
 * of the referee ( a move and an option are the same when they have the same key ).
 */

const SIDES: Side[] = ['acting', 'defending']

// The attached cards of the two minions of the combat, in the order the model knows them
export type CombatCards = { acting: Card[]; defending: Card[] }

export function combatCardsOf(combat: CombatState): CombatCards {
    return {
        acting: getAttachedCards(combat.acting.minion),
        defending: getAttachedCards(combat.defending.minion),
    }
}

function simStrikeOf(strike: CombatStrike, opposing: Card[]): SimStrike {
    return {
        ...newStrike(strike.name, {
            damage: strike.damage,
            aggravated: strike.aggravated,
            ranged: strike.ranged,
            dodge: strike.dodge,
            isHand: strike.isHand,
            undodgeable: strike.undodgeable,
            combatEnds: strike.combatEnds,
            firstStrike: strike.firstStrike,
            stealBlood: strike.stealBlood,
        }),
        retainer: strike.retainer ? opposing.indexOf(strike.retainer) : undefined,
        equipment: strike.equipment ? opposing.indexOf(strike.equipment) : undefined,
    }
}

// The key of an attached card in the sim: its side and its place ( a card that is gone, a retainer burned, keeps
// a key that no card has )
function attachedKeys(cards: CombatCards, oids: string[]): string[] {
    return oids.map(oid => {
        for (const side of SIDES) {
            const index = cards[side].findIndex(card => card.oid == oid)
            if (index >= 0) {
                return `${side}:${index}`
            }
        }
        return `gone:${oid}`
    })
}

/**
 * The combat as it stands: the minions, their attached cards, the strikes chosen, the cards played, what
 * is pending. `handOf` gives the combat cards a Methuselah holds: its own hand for the one who reads, none
 * ( or what is believed ) for the others.
 */
export function simOfCombat(
    combat: CombatState,
    handOf: (player: Player) => CardFacts[],
): CombatSim {
    const cards = combatCardsOf(combat)
    const sideOf = (combatant: CombatantMinion): Side =>
        combatant == combat.acting ? 'acting' : 'defending'
    const readSide = (combatant: CombatantMinion): SimCombatant => {
        const side = sideOf(combatant)
        const minion = combatant.minion
        return {
            ...combatantOf(
                {
                    profile: profileMinion(minion),
                    pool: minion.controller.pool,
                    hand: handOf(minion.controller),
                },
                side,
            ),
            strength: combatant.strength,
            strike:
                combatant.strike ?
                    simStrikeOf(combatant.strike, cards[side == 'acting' ? 'defending' : 'acting'])
                :   null,
            pendingDamage: { ...combatant.pendingDamage },
            bloodLost: combatant.bloodLost,
            additionalStrikes: combatant.additionalStrikes,
            limitedAdditionalGained: combatant.limitedAdditionalGained,
            strikesInPair: combatant.strikesInPair,
            pressesGranted: combatant.pressesGranted,
            strengthBonus: combatant.strengthBonus,
            freeManeuvers: combatant.freeManeuvers,
            environmentalDamage: combatant.environmentalDamage,
        }
    }
    const played = (record: Record<string, string[]>): Record<string, string[]> =>
        Object.fromEntries(
            SIDES.flatMap(side => {
                const plays = record[combat[side].minion.oid]
                return plays ? [[side, plays] as [string, string[]]] : []
            }),
        )
    const impulse = combat.impulsePlayer == combat.acting.minion.controller ? 'acting' : 'defending'
    const last =
        !combat.lastPlayedBy ? null
        : combat.lastPlayedBy == combat.acting.minion.controller ? 'acting'
        : 'defending'
    return {
        acting: readSide(combat.acting),
        defending: readSide(combat.defending),
        impulsePlayer: impulse,
        lastPlayedBy: last,
        closed: false,
        round: combat.round,
        step: combat.step,
        range: combat.range,
        pressed: combat.pressed,
        resolvedStrikeTier: combat.resolvedStrikeTier,
        strikePair: combat.strikePair,
        handStrikesOnly: combat.handStrikesOnly,
        closeNextRound: combat.closeNextRound,
        playedThisRound: played(combat.playedThisRound),
        playedThisCombat: played(combat.playedThisCombat),
        environmentalApplied: combat.environmentalApplied,
        weaponManeuvers: attachedKeys(cards, combat.weaponManeuvers),
        attachedPreventions: attachedKeys(cards, combat.attachedPreventions),
        isOver: combat.isOver,
    }
}

/**
 * Telling a move from an option
 */

export function strikeKey(strike: CombatStrike, opposing: Card[]): string {
    const retainer = strike.retainer ? opposing.indexOf(strike.retainer) : -1
    const equipment = strike.equipment ? opposing.indexOf(strike.equipment) : -1
    return [
        strike.name,
        strike.damage,
        +strike.aggravated,
        +strike.ranged,
        +strike.dodge,
        +strike.isHand,
        +strike.undodgeable,
        +strike.combatEnds,
        +strike.firstStrike,
        strike.stealBlood,
        retainer,
        equipment,
    ].join(',')
}

// The key of an option of the referee, for the minion that holds `mine` and the one that holds `opposing`
export function optionKey(option: BotOption, mine: Card[], opposing: Card[]): string {
    const card = 'card' in option && option.card ? option.card.krcgId : ''
    const index = (attached?: Card) => (attached ? mine.indexOf(attached) : -1)
    switch (option.type) {
        case 'combatPass':
            return 'pass'
        case 'combatStrike':
            return `strike|${strikeKey(option.strike, opposing)}|${option.additional?.limited ?? '-'}|${card}`
        case 'combatManeuver':
            return `maneuver|${option.strike ? strikeKey(option.strike, opposing) : '-'}|${index(option.weapon)}|${!!option.free}|${card}`
        case 'combatPress':
            return `press|${!!option.granted}|${card}`
        case 'combatAdditionalStrike':
            return `additionalStrike|${option.limited}|${card}`
        case 'combatGrapple':
            return `grapple|${option.press}|${option.closeNextRound}|${card}`
        case 'combatGainBlood':
            return `gainBlood|${option.amount}|${card}`
        case 'combatStrengthBonus':
            return 'strengthBonus'
        case 'combatStrength':
            return `strength|${option.amount}|${card}`
        case 'combatEnvironmentalDamage':
            return `environmentalDamage|${option.amount}|${card}`
        case 'combatPrevent':
            return `prevent|${option.amount}|${option.aggravated}|${index(option.source)}|${card}`
        default:
            throw new Error(`The referee offers ${option.type} in a combat`)
    }
}

export function simStrikeKey(strike: SimStrike): string {
    return [
        strike.name,
        strike.damage,
        +strike.aggravated,
        +strike.ranged,
        +strike.dodge,
        +strike.isHand,
        +strike.undodgeable,
        +strike.combatEnds,
        +strike.firstStrike,
        strike.stealBlood,
        strike.retainer ?? -1,
        strike.equipment ?? -1,
    ].join(',')
}

// The key of a move of the model, for the combatant that makes it
export function moveKey(move: Move, me: SimCombatant): string {
    const card = move.card === undefined ? '' : me.cards[move.card].cardId
    const index = (key?: string) => (key === undefined ? -1 : Number(key.split(':')[1]))
    switch (move.type) {
        case 'pass':
            return 'pass'
        case 'strike':
            return `strike|${simStrikeKey(move.strike)}|${move.additional?.limited ?? '-'}|${card}`
        case 'maneuver':
            return `maneuver|${move.strike ? simStrikeKey(move.strike) : '-'}|${index(move.weaponKey)}|${!!move.free}|${card}`
        case 'press':
            return `press|${!!move.granted}|${card}`
        case 'additionalStrike':
            return `additionalStrike|${move.limited}|${card}`
        case 'grapple':
            return `grapple|${move.press}|${move.closeNextRound}|${card}`
        case 'gainBlood':
            return `gainBlood|${move.amount}|${card}`
        case 'strengthBonus':
            return 'strengthBonus'
        case 'strength':
            return `strength|${move.amount}|${card}`
        case 'environmentalDamage':
            return `environmentalDamage|${move.amount}|${card}`
        case 'prevent':
            return `prevent|${move.amount}|${move.aggravated}|${index(move.sourceKey)}|${card}`
    }
}

// The option of the referee that makes the move ( the first, when two cards of the same name do ), none
// when the referee does not offer it
export function optionOfMove(
    options: BotOption[],
    move: Move,
    sim: CombatSim,
    cards: CombatCards,
): BotOption | undefined {
    const me = sim.impulsePlayer
    const opposing = me == 'acting' ? 'defending' : 'acting'
    const key = moveKey(move, sim[me])
    return options.find(option => optionKey(option, cards[me], cards[opposing]) == key)
}
