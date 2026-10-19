import { LibraryCard } from '@/shared/model/Card.ts'
import { MinionProfile } from '@/shared/bot/utility/minionProfile.ts'
import {
    CombatSim,
    newCombatSim,
    Side,
    SimAlly,
    SimCard,
    SimCombatant,
} from '@/shared/bot/utility/combatModel.ts'
import { newCombatantFields } from '@/shared/state/combatRules.ts'
import { getCardDefById } from '@/shared/cardImpl/catalog/index.ts'
import {
    expandRequirement,
    playsOfKind,
    usageOptionKey,
} from '@/shared/cardImpl/catalog/requirements.ts'
import { CombatPlay } from '@/shared/cardImpl/catalog/types.ts'
import { traitsMeetRequirements } from '@/shared/state/cardRequirements.ts'
import { waysUsableBy } from '@/shared/bot/utility/summaries.ts'

/**
 * A combat of the model from what is on the table: the minions as MinionProfiles and the
 * combat cards a side holds. What a side holds is given by the caller: my hand, as it is, or what I
 * believe of another one.
 */

// What of a library card decides whether and how it is played in a combat ( a LibraryCard has them )
export type CardFacts = {
    krcgId?: string
    name: string
    // "Action Modifier/Combat"
    type?: string
    clan?: string
    requirement?: string
    bloodCost: number | 'X'
    poolCost: number | 'X'
}

// What of a minion decides which cards it can play
export type CardUser = Pick<
    MinionProfile,
    'disciplines' | 'isVampire' | 'forbiddenPlays' | 'clan' | 'sect' | 'title' | 'capacity'
>

// The plays of the card that the minion can make, one for each way it can be declared, as the
// engine offers them ( getUsageOptions ): none when it is not a combat card of the catalog
function playsFor(profile: CardUser, card: CardFacts): CombatPlay[] {
    const def = card.krcgId ? getCardDefById(card.krcgId) : undefined
    if (!def || !card.type?.split('/').includes('Combat')) {
        return []
    }
    const plays: CombatPlay[] = []
    const seen = new Set<string>()
    for (const play of playsOfKind(def, 'combat')) {
        for (const way of waysUsableBy(expandRequirement(play.requires), profile.disciplines)) {
            const key = usageOptionKey(way)
            if (!seen.has(key)) {
                seen.add(key)
                plays.push(play)
            }
        }
    }
    return plays.filter((play, index) => plays.indexOf(play) == index)
}

// The vampire fits the clan and what the cardbase requires ( an ally has neither ), and no card attached
// to it forbids the card
function canPlay(profile: CardUser, card: CardFacts): boolean {
    if (
        (card.clan || card.requirement) &&
        !(profile.isVampire && traitsMeetRequirements(profile, card))
    ) {
        return false
    }
    return !profile.forbiddenPlays.includes(card.name)
}

export function combatCards(profile: CardUser, hand: CardFacts[]): SimCard[] {
    return hand.flatMap(card => {
        const plays = canPlay(profile, card) ? playsFor(profile, card) : []
        // A variable cost is not offered: the combat cards do not declare an X
        if (plays.length == 0 || !card.krcgId || card.bloodCost == 'X' || card.poolCost == 'X') {
            return []
        }
        return [
            {
                cardId: card.krcgId,
                name: card.name,
                bloodCost: card.bloodCost,
                poolCost: card.poolCost,
                plays,
            },
        ]
    })
}

export function cardFactsOf(card: LibraryCard): CardFacts {
    return {
        krcgId: card.krcgId,
        name: card.name,
        type: card.type,
        clan: card.clan,
        requirement: card.requirement,
        bloodCost: card.bloodCost,
        poolCost: card.poolCost,
    }
}

export type CombatantSetup = {
    profile: MinionProfile
    // The pool of its Methuselah
    pool: number
    hand: CardFacts[]
    // Combat cards it holds that are not cards of the library ( what a hand is believed to hold )
    extraCards?: SimCard[]
    // The strength bonus it can take before the range of the first round ( an action that gives it if blocked )
    strengthBonus?: number
    // The maneuvers it plays without a card ( a reaction played when it blocked )
    freeManeuvers?: number
    // The allies of its Methuselah, apart from itself: the ones that can burn life for a press count
    allies?: MinionProfile[]
}

// The allies that can burn life for a press, as the sim knows them
export function pressAlliesOf(allies: MinionProfile[]): SimAlly[] {
    return allies.flatMap(ally =>
        ally.pressBurn > 0 && ally.state != 'torpor' && ally.blood > 0 ?
            [
                {
                    key: ally.oid,
                    name: ally.name,
                    life: ally.blood,
                    burn: ally.pressBurn,
                    worth: ally.worth,
                },
            ]
        :   [],
    )
}

export function combatantOf(setup: CombatantSetup, side: Side): SimCombatant {
    const { profile } = setup
    return {
        ...newCombatantFields(profile.strength),
        strengthBonus: setup.strengthBonus ?? 0,
        freeManeuvers: setup.freeManeuvers ?? 0,
        side,
        name: profile.name,
        isVampire: profile.isVampire,
        state: profile.state == 'torpor' ? 'torpor' : 'ready',
        blood: profile.blood,
        startBlood: profile.blood,
        capacity: profile.capacity,
        worth: profile.worth,
        pool: setup.pool,
        attached: profile.attachedKits.map(kit => ({ ...kit })),
        cards: [...combatCards(profile, setup.hand), ...(setup.extraCards ?? [])],
        spent: 0,
        allies: pressAlliesOf(setup.allies ?? []),
        allyLost: 0,
    }
}

// The combat of an acting minion and a defending one, at its first round
export function combatOf(acting: CombatantSetup, defending: CombatantSetup): CombatSim {
    return newCombatSim(combatantOf(acting, 'acting'), combatantOf(defending, 'defending'))
}
