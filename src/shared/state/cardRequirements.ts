import { LibraryCard, Minion, Vampire } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { Sect, TITLE_BALLOTS, TITLE_VOTES } from '@/shared/const/model.ts'

/**
 * What a player or a minion must be to play a library card, on top of its cost.
 *
 * The clan of a card means "a vampire of this clan" ( "A/B": either one ). The requirement of the
 * cardbase is a comma separated list: sects and titles are alternatives ( titles win when there
 * are some: they belong to a sect ), while "non-X", "titled", "capacity N or more" are
 * restrictions that all apply. A requirement that is not understood is never met: the bot
 * does not play a card it cannot check.
 *
 * For a master card the vampire is any ready vampire of the player ( "requires a ready Anarch" ).
 * For the other cards it is the minion that plays the card.
 */

const SECT_NAMES: Set<string> = new Set(Object.values(Sect).map(sect => sect.toLowerCase()))
const TITLE_NAMES: Set<string> = new Set([
    ...Object.keys(TITLE_VOTES),
    ...Object.keys(TITLE_BALLOTS),
])

// What a requirement can ask of a vampire ( a MinionProfile has them too )
export type VampireTraits = { clan: string; sect: string; title: string; capacity: number }

type VampireTest = (vampire: VampireTraits) => boolean

const parsedRequirements = new Map<string, VampireTest | null>()

function parseRestriction(clause: string): VampireTest | null {
    if (clause == 'titled') {
        return vampire => vampire.title != ''
    }
    if (clause == 'non-titled') {
        return vampire => vampire.title == ''
    }
    const nonSect = /^non-(.+)$/.exec(clause)?.[1]
    if (nonSect && SECT_NAMES.has(nonSect)) {
        return vampire => vampire.sect.toLowerCase() != nonSect
    }
    const capacity = /^capacity (\d+) or (more|less)$/.exec(clause)
    if (capacity) {
        const limit = Number(capacity[1])
        return capacity[2] == 'more' ?
                vampire => vampire.capacity >= limit
            :   vampire => vampire.capacity <= limit
    }
    return null
}

function parseRequirement(requirement: string): VampireTest | null {
    const clauses = requirement.split(',').map(clause => clause.trim().toLowerCase())
    const sects = clauses.filter(clause => SECT_NAMES.has(clause))
    const titles = clauses.filter(clause => TITLE_NAMES.has(clause))
    const restrictions: VampireTest[] = []
    for (const clause of clauses.filter(
        clause => !SECT_NAMES.has(clause) && !TITLE_NAMES.has(clause),
    )) {
        const restriction = parseRestriction(clause)
        if (!restriction) {
            return null
        }
        restrictions.push(restriction)
    }
    return vampire => {
        const { title, sect } = vampire
        const identity =
            titles.length > 0 ? titles.includes(title.toLowerCase())
            : sects.length > 0 ? sects.includes(sect.toLowerCase())
            : true
        return identity && restrictions.every(test => test(vampire))
    }
}

function meetsRequirementText(vampire: VampireTraits, requirement: string): boolean {
    if (!parsedRequirements.has(requirement)) {
        parsedRequirements.set(requirement, parseRequirement(requirement))
    }
    return parsedRequirements.get(requirement)?.(vampire) ?? false
}

// A vampire with these traits can play the card: its clan, and what the cardbase requires
export function traitsMeetRequirements(
    vampire: VampireTraits,
    card: { clan?: string; requirement?: string },
): boolean {
    if (card.clan) {
        const clans = card.clan.split('/').map(clan => clan.toLowerCase())
        if (!clans.includes(vampire.clan.toLowerCase())) {
            return false
        }
    }
    return !card.requirement || meetsRequirementText(vampire, card.requirement)
}

function vampireMeetsRequirements(vampire: Vampire, card: LibraryCard): boolean {
    const { clan, sect, title } = vampire.vampireAttrs
    return traitsMeetRequirements(
        { clan, sect, title, capacity: vampire.minionAttrs.capacity },
        card,
    )
}

// A master card: the player controls a ready vampire that fits
export function meetsRequirements(player: Player, card: LibraryCard): boolean {
    if (!card.clan && !card.requirement) {
        return true
    }
    return player.vampiresReady.some(vampire => vampireMeetsRequirements(vampire, card))
}

// Any other card: the minion that plays it fits ( an ally has neither clan nor sect )
export function minionMeetsRequirements(minion: Minion, card: LibraryCard): boolean {
    if (!card.clan && !card.requirement) {
        return true
    }
    return minion.isVampire() && vampireMeetsRequirements(minion, card)
}

// Another copy of a unique card is in play ( in anybody's ready region or torpor, the bot's own
// included ): this one cannot be played. The "contesting" rule is ignored.
export function hasUniqueCopyInPlay(player: Player, card: LibraryCard): boolean {
    if (!card.isUnique) {
        return false
    }
    return Object.values(player.gameState.players).some(holder =>
        [...holder.ready.cards, ...holder.torpor.cards].some(
            inPlay =>
                inPlay !== card && inPlay instanceof LibraryCard && inPlay.krcgId == card.krcgId,
        ),
    )
}
