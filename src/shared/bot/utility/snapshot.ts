import { Card, LibraryCard } from '@/shared/model/Card.ts'
import { Player } from '@/shared/model/Player.ts'
import { GameState } from '@/shared/state/gameState.ts'
import { isAttached } from '@/shared/state/attachments.ts'
import { CardOid, PlayerOid } from '@/shared/types/model.ts'
import { MinionProfile, profileMinion } from '@/shared/bot/utility/minionProfile.ts'
import { AbilitySummary, CardSummary, Role, summarizeCard } from '@/shared/bot/utility/summaries.ts'

/**
 * The table as one player sees it ( the player view, never the live game ): per Methuselah what is
 * public, and for the player itself what it holds. Numbers only, no judgement: the assessment reads it.
 */

// A card in play that is not a minion nor on one, with what its controller can do with it
export type PermanentSnapshot = {
    oid: CardOid
    name: string
    locked: boolean
    abilities: AbilitySummary[]
    // A charge is left: one that locks the card needs it unlocked, until the next unlock phase
    available: boolean
}

export type HandCard = {
    card: LibraryCard
    summary: CardSummary
}

export type MethuselahSnapshot = {
    oid: PlayerOid
    name: string
    isMe: boolean
    // With two players the other one is both
    isPrey: boolean
    isPredator: boolean
    pool: number
    victoryPoints: number
    // The minions in play: ready ( unlocked or locked ) and in torpor
    minions: MinionProfile[]
    permanents: PermanentSnapshot[]
    handSize: number
    // The cards in hand, only for the player itself ( the others' hands are unknown )
    hand: HandCard[]
    librarySize: number
    // The roles of the cards on its ash heap, which are public
    seenRoles: Partial<Record<Role, number>>
}

export type TableSnapshot = {
    me: MethuselahSnapshot
    // The others, from my prey around the ring to my predator
    others: MethuselahSnapshot[]
    prey: MethuselahSnapshot | null
    predator: MethuselahSnapshot | null
}

export function readyMinions(snapshot: MethuselahSnapshot): MinionProfile[] {
    return snapshot.minions.filter(minion => minion.state != 'torpor')
}

export function unlockedMinions(snapshot: MethuselahSnapshot): MinionProfile[] {
    return snapshot.minions.filter(minion => minion.state == 'unlocked')
}

export function everyone(table: TableSnapshot): MethuselahSnapshot[] {
    return [table.me, ...table.others]
}

// A bounce sends the bleed to another Methuselah than the acting one: with two left there is none, and
// every bounce card is dead ( to be discarded ). With more, the bouncer sends it to its own prey, which is
// never the attacker.
export function canBounce(table: TableSnapshot): boolean {
    return everyone(table).length >= 3
}

export function bounceTargetOf(
    table: TableSnapshot,
    defender: MethuselahSnapshot,
): MethuselahSnapshot | null {
    if (!canBounce(table)) {
        return null
    }
    const ring = everyone(table)
    return ring[(ring.indexOf(defender) + 1) % ring.length]
}

// Is a card of this role worth anything at this table: a bounce is not with two Methuselahs
export function isRoleLive(table: TableSnapshot, role: Role): boolean {
    return role != 'bounce' || canBounce(table)
}

function snapshotPermanent(card: Card): PermanentSnapshot | null {
    if (!(card instanceof LibraryCard) || isAttached(card)) {
        return null
    }
    const summary = summarizeCard(card)
    const abilities = summary?.plays.find(play => play.abilities.length > 0)?.abilities ?? []
    if (abilities.length == 0) {
        return null
    }
    return {
        oid: card.oid,
        name: card.name,
        locked: card.isLocked,
        abilities,
        available: !abilities.some(ability => ability.locks) || !card.isLocked,
    }
}

function countRoles(cards: Card[]): Partial<Record<Role, number>> {
    const counts: Partial<Record<Role, number>> = {}
    for (const card of cards) {
        for (const role of summarizeCard(card)?.roles ?? []) {
            counts[role] = (counts[role] ?? 0) + 1
        }
    }
    return counts
}

function snapshotMethuselah(player: Player, me: Player): MethuselahSnapshot {
    const isMe = player == me
    return {
        oid: player.oid,
        name: player.name,
        isMe,
        isPrey: !isMe && me.prey == player,
        isPredator: !isMe && me.predator == player,
        pool: player.pool,
        victoryPoints: player.victoryPoints,
        minions: [...player.minionsReady, ...player.vampiresInTorpor].map(profileMinion),
        permanents: player.controlledReadyCards.flatMap(card => snapshotPermanent(card) ?? []),
        handSize: player.hand.cards.length,
        hand:
            isMe ?
                player.hand.cards.flatMap(card => {
                    const summary = summarizeCard(card)
                    return card instanceof LibraryCard && summary ? [{ card, summary }] : []
                })
            :   [],
        librarySize: player.library.cards.length,
        seenRoles: countRoles(player.ashHeap.cards),
    }
}

export function takeSnapshot(gameState: GameState, me: Player): TableSnapshot {
    const competing = gameState.competingPlayers
    // From my prey around the ring to my predator
    const start = competing.indexOf(me)
    const ring = competing.map((_, i) => competing[(start + 1 + i) % competing.length])
    const others = ring.filter(player => player != me).map(player => snapshotMethuselah(player, me))
    return {
        me: snapshotMethuselah(me, me),
        others,
        prey: others.find(other => other.isPrey) ?? null,
        predator: others.find(other => other.isPredator) ?? null,
    }
}
