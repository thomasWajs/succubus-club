import { DisciplineLevel } from '@/shared/const/model.ts'
import { CombatPlay } from '@/shared/cardImpl/catalog/types.ts'
import {
    additionalStrike,
    dodge,
    handStrike,
    maneuver,
    oncePerRound,
} from '@/shared/cardImpl/catalog/builders.ts'
import { SimCard } from '@/shared/bot/utility/combatModel.ts'
import { levelFor, mayUseRole } from '@/shared/bot/utility/capabilities.ts'
import { MinionProfile } from '@/shared/bot/utility/minionProfile.ts'
import { Densities } from '@/shared/bot/utility/defence.ts'
import { CombatWeights } from '@/shared/bot/utility/profile.ts'

/**
 * The combat cards of a hand that is not seen ( step 3.4b of .claude/docs/bot-ai-phase3.md ). The hand of
 * another Methuselah has a size and the roles of its library ( capabilities.ts, from the disciplines of its
 * minions ): each card of it is taken to be a card of a role, or no combat card, with the share of that
 * role, and only a role the minion that fights can play counts. A card of a role is a generic one: it does
 * what the role says, at the level of the minion's discipline, and costs nothing. The roles the catalog
 * cannot express as a combat card yet ( prevention, grapple, strength ) give none.
 */

const COMBAT_ROLES = ['strike', 'dodge', 'maneuver', 'additionalStrike'] as const
type CombatRole = (typeof COMBAT_ROLES)[number]

// What a Methuselah is believed to hold: the cards in its hand and the share of its library with each role
export type BelievedHand = { size: number; densities: Densities }

function playOf(role: CombatRole, level: number, weights: CombatWeights): CombatPlay {
    switch (role) {
        case 'strike': {
            const { inferior, superior } = weights.strikeBonus
            return {
                kind: 'combat',
                effects: [handStrike(level >= DisciplineLevel.SUPERIOR ? superior : inferior)],
            }
        }
        case 'dodge':
            return { kind: 'combat', effects: [dodge] }
        case 'maneuver':
            return { kind: 'combat', effects: [maneuver] }
        case 'additionalStrike':
            return {
                kind: 'combat',
                when: [oncePerRound],
                effects: [additionalStrike({ limited: true })],
            }
    }
}

// The roles a minion can play, with the share of the library of its Methuselah that has them
function usableRoles(minion: MinionProfile, hand: BelievedHand) {
    return COMBAT_ROLES.flatMap(role => {
        const share = hand.densities[role] ?? 0
        return share > 0 && mayUseRole(minion.disciplines, role, minion.title) ?
                [{ role, share }]
            :   []
    })
}

// Can the hand hold a combat card the minion plays
export function mayHoldCombatCards(minion: MinionProfile, hand: BelievedHand): boolean {
    return hand.size > 0 && usableRoles(minion, hand).length > 0
}

// What of the belief decides the hands drawn: nothing when no card is possible, else the size of the hand and
// the shares of the roles the minion plays, to two decimals
export function beliefKey(minion: MinionProfile, hand: BelievedHand): string {
    return !mayHoldCombatCards(minion, hand) ? 'none' : (
            `${hand.size}[${usableRoles(minion, hand)
                .map(({ role, share }) => `${role}:${share.toFixed(2)}`)
                .join(',')}]`
        )
}

// A hand drawn from what is believed: `random` gives numbers in [0, 1[
export function believedCards(
    minion: MinionProfile,
    hand: BelievedHand,
    weights: CombatWeights,
    random: () => number,
): SimCard[] {
    const roles = usableRoles(minion, hand)
    const cards: SimCard[] = []
    for (let slot = 0; slot < hand.size; slot++) {
        let draw = random()
        for (const { role, share } of roles) {
            if (draw < share) {
                cards.push({
                    cardId: `believed:${role}`,
                    name: `a card of ${role}`,
                    bloodCost: 0,
                    poolCost: 0,
                    plays: [playOf(role, levelFor(minion.disciplines, role), weights)],
                })
                break
            }
            draw -= share
        }
    }
    return cards
}

// `count` hands, each drawn from its own seed ( `seed` and its number ): one empty hand when the minion
// cannot play any card that the hand may hold
export function believedHands(
    minion: MinionProfile,
    hand: BelievedHand,
    weights: CombatWeights,
    count: number,
    seed: number,
): SimCard[][] {
    if (!mayHoldCombatCards(minion, hand)) {
        return [[]]
    }
    return Array.from({ length: count }, (_, index) =>
        believedCards(minion, hand, weights, seededRandom(seed + index)),
    )
}

// mulberry32, so that a fight judged twice is judged the same
export function seededRandom(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6d2b79f5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

// FNV-1a
export function hashOf(text: string): number {
    let hash = 0x811c9dc5
    for (let i = 0; i < text.length; i++) {
        hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193)
    }
    return hash >>> 0
}
