/**
 * Projection of the rules engine's table ( the server's TableView ) onto the game state.
 *
 * The engine is the authority : after each of its messages, the game state is
 * brought to what the view shows. What a player would do by hand goes through
 * the usual GameMutations ( moves, counters, locks, pool, the Edge, turn and
 * phase ), so the log and the animations tell what happened. The bookkeeping
 * a player never does ( creating the cards, learning or forgetting their
 * identity, the order of a stack ) is written directly, like a resync.
 *
 * The engine identifies each physical card by a `copy` number, stable across
 * views : each copy maps to one Card. A card the view leaves unnumbered ( a
 * back ) is given a number of its seat, zone and place, stable while it stays
 * there.
 */

import { GameState } from '@/shared/state/gameState.ts'
import { Player } from '@/shared/model/Player.ts'
import { Card, CryptCard, LibraryCard, Minion } from '@/shared/model/Card.ts'
import { AnyCardRegion, CardOid, PlayerOid } from '@/shared/types/model.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { generateCardOid } from '@/shared/state/ids.ts'
import { DisciplineCode, DisciplineLevel, TurnPhase, TurnSequence } from '@/shared/const/model.ts'
import {
    CARD_HEIGHT,
    CARD_WIDTH,
    GRID_SIZE,
    PLAY_AREA_WIDTH,
    PLAYER_BAR_HEIGHT,
    TORPOR_ZONE_Y,
} from '@/shared/const/game.ts'
import {
    findFreePlayPosition,
    getCardRectangle,
    getCardRectangleAt,
    getCardScale,
} from '@/client/game/utils.ts'
import { RegionCategory } from '@/client/game/types.ts'
import { restoreStack } from '@/client/engine/stacks.ts'
import { createReferendumState } from '@/shared/state/referendumState.ts'
import {
    BlockingDecision,
    DisciplineUse,
    MinionAction,
    MinionActionType,
    NO_BLOCK,
    VoteCount,
    VoteSide,
} from '@/shared/types/state.ts'
import { useEngineStore } from '@/client/store/engine.ts'
import { type EngineChip, minionMarkers } from '@/client/engine/labels.ts'
import { nextTick } from 'vue'
import Phaser from 'phaser'
import type {
    ActionView,
    Card as ViewCard,
    InPlayView,
    MinionView,
    Mode,
    OptionView,
    Phase,
    SlotRef,
    TableView,
    Target,
} from '@/client/engine/api.ts'

// Where new cards land in the ready region, in three rows : the cards in play on no minion
// on the top one ( below the player's bar and its pool ), the minions on the bottom one,
// the middle one for more of both ( the minions from the left, the others from the
// right ). The cards being played in the middle.
const ROW_MARGIN = GRID_SIZE / 2
const COLUMN_GAP = 4
const LIMBO_ROW_Y = 10 * GRID_SIZE
const CARD_SPACING_X = 9 * GRID_SIZE
// A card on another rises above it, its name strip ( the card image's top 60 / 500 ) showing
const TITLE_RATIO = 60 / CARD_HEIGHT

enum Row {
    Top,
    Middle,
    Bottom,
}

const PHASES: Record<Phase, TurnPhase | null> = {
    unlock: TurnPhase.Unlock,
    master: TurnPhase.Master,
    minion: TurnPhase.Minion,
    influence: TurnPhase.Influence,
    discard: TurnPhase.Discard,
    over: null,
    unknown: null,
}

// A card as placed : always numbered ( a back gets a number of its place )
type Seen = { copy: number; id: number | null; crypt: boolean }

// What an option names on the table, by role
export type Roles = {
    card?: Card // the card played, used, moved ; the uncontrolled vampire influenced
    minion?: Card // the minion it is about ( a minion's action : its menu )
    actor?: Card // the minion playing the card, using the ability
    target?: Card | Player
}

enum Spot {
    Stack, // an ordered region : hand, library, crypt, ash heap, removed
    Minion,
    Attached, // on a minion, or stored on a card in play
    InPlay,
    Limbo,
    Torpor,
    Uncontrolled,
}

// Where a copy is, and in which state, according to the view
type Placement = {
    card: Seen
    player: Player
    region: AnyCardRegion
    spot: Spot
    host?: number // copy of the card it is on
    rank: number // order among its siblings ( slot, attachment rank )
    blood: number
    greenCounter: number
    // A minion's other marks, as SC's markers ( short labels ) : a disease, a contested title, a
    // lasting effect without counters on it
    markers?: string[]
    // Its counted markers : hostage, nightmare and torture counters, a lasting effect's counters
    chips?: EngineChip[]
    isLocked: boolean
    isFlipped: boolean
    // A minion : the view's ( its kind : a vampire, an ally, a created vampire, a token )
    minion?: MinionView
    // Stored on a card in play ( Fleshforge Chamber ), not attached to it
    stored?: boolean
}

export class Projection {
    private cards = new Map<number, CardOid>()
    // The order of the stacks, as the view shows them
    private stacks: { region: AnyCardRegion; copies: number[] }[] = []
    // The viewer's seat
    private viewer: number | undefined
    // Where each copy was in the previous view ( spot and host ) : a card that
    // changes spot without changing region is moved too ( played, then attached )
    private spots = new Map<number, string>()
    // Where each copy is in the last view
    private placements = new Map<number, Placement>()
    // The library cards made minions here ( a created vampire, a token ) : unmade once no more
    private madeMinions = new Set<number>()

    // playersOid : by engine seat. The players are always read through the
    // game state, to stay reactive.
    constructor(
        private gameState: GameState,
        private playersOid: PlayerOid[],
    ) {}

    // The card of a copy, if on the table
    card(copy: number | null | undefined): Card | undefined {
        if (copy === null || copy === undefined) {
            return undefined
        }
        const oid = this.cards.get(copy)
        return oid ? this.gameState.cards[oid] : undefined
    }

    // The card or Methuselah a target names
    target(target: Target | null | undefined): Card | Player | undefined {
        return (
            target?.kind == 'card' ? this.card(target.copy)
            : target?.kind == 'seat' ? this.player(target.seat)
            : undefined
        )
    }

    // A card an option names : a card on the table by its copy ; a card in hand by its id
    // ( copies alike in hand are one option : the first of them ), or stored on a card in play
    cardRef(ref: OptionView['card']): Card | undefined {
        if (!ref) {
            return undefined
        }
        if (ref.copy != null) {
            return this.card(ref.copy)
        }
        for (const [copy, at] of this.placements) {
            const there =
                ref.from != null ?
                    at.stored && at.host == ref.from
                :   at.spot == Spot.Stack &&
                    at.region.is.hand &&
                    at.player.oid == this.viewerPlayer()?.oid
            if (there && at.card.id == ref.id) {
                return this.card(copy)
            }
        }
        return undefined
    }

    private viewerPlayer(): Player | undefined {
        return this.viewer === undefined ? undefined : this.player(this.viewer)
    }

    /**
     * What an option names, by role, as SC's table reads it : the uncontrolled vampire a transfer
     * goes to is its card ; the minion taking an action is the option's minion ( its menu ) ; a
     * minion or a card chosen is its target.
     */
    roles(option: OptionView): Roles {
        const roles: Roles = {
            card: this.cardRef(option.card),
            minion: this.card(option.minion),
            actor: this.card(option.actor),
            target: this.target(option.target),
        }
        switch (option.kind) {
            case 'take_action':
                return { ...roles, minion: roles.actor, actor: undefined }
            case 'choose_minion':
                return { ...roles, minion: undefined, target: roles.minion }
            case 'choose_card':
                return { ...roles, target: roles.card }
            case 'transfer':
            case 'withdraw':
            case 'influence_out':
            case 'merge':
            case 'allocate_to_card':
            case 'slot':
                return (
                    option.target?.kind == 'card' ?
                        { ...roles, card: this.card(option.target.copy), target: undefined }
                    : option.slot ?
                        { ...roles, card: this.uncontrolled(option.slot), target: undefined }
                    :   roles
                )
        }
        return roles
    }

    // An uncontrolled vampire by its place : another seat's is face down, unnamed
    private uncontrolled(slot: SlotRef): Card | undefined {
        const player = this.player(slot.seat)
        for (const [copy, at] of this.placements) {
            if (
                at.spot == Spot.Uncontrolled &&
                at.player.oid == player.oid &&
                at.rank == slot.slot
            ) {
                return this.card(copy)
            }
        }
        return undefined
    }

    /**
     * The cards alike to this one, itself included : the copies of the same
     * card in the same hand, or stored on the same card. The engine offers one
     * choice for them all, about the first copy ( any of them is the same ).
     */
    alike(card: Card): Card[] {
        const copy = this.copyOf(card)
        const placement = copy === undefined ? undefined : this.placements.get(copy)
        const id = placement?.card.id
        if (!placement || id === null || id === undefined) {
            return [card]
        }
        const inHand = placement.spot == Spot.Stack && placement.region.is.hand
        if (!inHand && !placement.stored) {
            return [card]
        }
        const alike: Card[] = []
        for (const [other, at] of this.placements) {
            if (
                at.card.id == id &&
                at.region.oid == placement.region.oid &&
                at.spot == placement.spot &&
                !!at.stored == !!placement.stored &&
                at.host == placement.host
            ) {
                const otherCard = this.card(other)
                if (otherCard) {
                    alike.push(otherCard)
                }
            }
        }
        return alike.length > 0 ? alike : [card]
    }

    private copyOf(card: Card): number | undefined {
        for (const [copy, oid] of this.cards) {
            if (oid == card.oid) {
                return copy
            }
        }
        return undefined
    }

    player(seat: number): Player {
        return this.gameState.players[this.playersOid[seat]]
    }

    apply(view: TableView) {
        const placements = this.read(view)
        this.placements = placements

        this.removeGone(placements)
        for (const [copy, placement] of placements) {
            if (!this.cards.has(copy)) {
                this.create(copy, placement)
            }
        }
        this.learn(placements)
        this.move(placements)
        this.order()
        this.setProperties(placements)
        this.setMinions(placements)
        // The cards on their way to play : shown apart, not in play yet
        useEngineStore().limbo = [...placements]
            .filter(([, placement]) => placement.spot == Spot.Limbo)
            .flatMap(([copy]) => this.card(copy)?.oid ?? [])
        const stacks: Record<CardOid, CardOid[]> = {}
        for (const [copy, placement] of placements) {
            const host = this.card(placement.host)
            const card = this.card(copy)
            if (placement.spot == Spot.Attached && host && card) {
                ;(stacks[host.oid] ??= []).push(card.oid)
            }
        }
        useEngineStore().stacks = stacks
        useEngineStore().chips = Object.fromEntries(
            [...placements].flatMap(([copy, placement]) => {
                const oid = this.card(copy)?.oid
                return oid && placement.chips?.length ? [[oid, placement.chips]] : []
            }),
        )
        this.setSeats(view)
        this.setTurn(view)
        this.setAction(view)
        this.setReferendum(view)
    }

    // The Methuselah who has the impulse : the one the engine asks now
    setImpulse(seat: number) {
        if (this.gameState.action) {
            this.gameState.action.impulsePlayer = this.player(seat)
        }
    }

    // Dev : what differs between the game state and the view, once applied
    check(view: TableView): string[] {
        const problems: string[] = []
        for (const [copy, placement] of this.read(view)) {
            const card = this.card(copy)
            if (!card) {
                problems.push(`copy ${copy} has no card`)
                continue
            }
            const name = card.name || `copy ${copy}`
            if (card.region.oid != placement.region.oid) {
                problems.push(`${name} is in ${card.region.name}, not ${placement.region.name}`)
            } else if (card.isIn.play) {
                if (card.blood != placement.blood) {
                    problems.push(`${name} has ${card.blood} blood, not ${placement.blood}`)
                }
                if (card.isLocked != placement.isLocked) {
                    problems.push(`${name} is ${card.isLocked ? '' : 'not '}locked`)
                }
            }
            if (card.krcgId != placement.card.id?.toString()) {
                problems.push(`${name} is known as ${card.krcgId}, not ${placement.card.id}`)
            }
        }
        for (const seat of view.seats) {
            const player = this.player(seat.seat)
            const nbCards = player.allCardRegions.reduce((n, region) => n + region.length, 0)
            const nbShown =
                seat.crypt.length +
                seat.library.length +
                seat.hand.length +
                seat.ash_heap.length +
                seat.removed.length +
                seat.uncontrolled.length +
                seat.limbo.length +
                [...seat.ready, ...seat.torpor].reduce(
                    (n, minion) =>
                        n + 1 + minion.cards.reduce((m, c) => m + 1 + (c.stored?.length ?? 0), 0),
                    0,
                ) +
                seat.in_play.reduce((n, c) => n + 1 + (c.stored?.length ?? 0), 0)
            if (nbCards != nbShown) {
                problems.push(`${player.name} has ${nbCards} cards, not ${nbShown}`)
            }
            if (player.pool != Math.max(0, seat.pool)) {
                problems.push(`${player.name} has ${player.pool} pool, not ${seat.pool}`)
            }
            if (player.isOusted != seat.ousted) {
                problems.push(`${player.name} ousted : ${player.isOusted}, not ${seat.ousted}`)
            }
        }
        if (this.gameState.turnNumber != view.turn) {
            problems.push(`turn ${this.gameState.turnNumber}, not ${view.turn}`)
        }
        if (view.phase != 'over') {
            if (this.gameState.activePlayer?.oid != this.player(view.active).oid) {
                problems.push(`active player ${this.gameState.activePlayer?.name}`)
            }
            if (this.gameState.turnPhase != PHASES[view.phase]) {
                problems.push(`phase ${this.gameState.turnPhase}, not ${view.phase}`)
            }
        }
        return problems
    }

    /**
     * Read the view : where is each copy
     */

    private read(view: TableView): Map<number, Placement> {
        const placements = new Map<number, Placement>()
        this.stacks = []
        this.viewer = view.viewer ?? undefined
        // A card the view leaves unnumbered : a number of its seat, zone and place
        let hidden = 0
        const seen = (c: ViewCard, back?: number): Seen => ({
            copy: c.copy ?? back ?? -1_000_000 - ++hidden,
            id: c.id ?? null,
            crypt: c.crypt ?? false,
        })

        for (const seat of view.seats) {
            const player = this.player(seat.seat)
            const back = (zone: number, i: number) => -(1 + seat.seat * 100_000 + zone * 10_000 + i)
            const pile = (zone: number, cards: ViewCard[]) =>
                cards.map((c, i) => seen(c, back(zone, i)))

            const stack = (region: AnyCardRegion, cards: Seen[]) => {
                this.stacks.push({ region, copies: cards.map(c => c.copy) })
                cards.forEach((card, rank) =>
                    placements.set(card.copy, {
                        card,
                        player,
                        region,
                        spot: Spot.Stack,
                        rank,
                        blood: 0,
                        greenCounter: 0,
                        isLocked: false,
                        isFlipped: false,
                    }),
                )
            }
            // The engine lists a stack top last ; here the top is first
            stack(player.crypt, pile(0, seat.crypt).reverse())
            stack(player.library, pile(1, seat.library).reverse())
            stack(player.hand, pile(2, seat.hand))
            stack(player.ashHeap, pile(3, seat.ash_heap).reverse())
            stack(player.removed, pile(4, seat.removed).reverse())

            seat.uncontrolled.forEach((slot, rank) => {
                const card = seen(slot.card, back(6, rank))
                placements.set(card.copy, {
                    card,
                    player,
                    region: player.uncontrolled,
                    spot: Spot.Uncontrolled,
                    rank,
                    blood: slot.counters,
                    greenCounter: 0,
                    isLocked: false,
                    isFlipped: false,
                })
            })

            const inPlay = (
                inPlayCard: InPlayView,
                region: AnyCardRegion,
                rank: number,
                host?: number,
            ) => {
                const it = seen(inPlayCard.card)
                placements.set(it.copy, {
                    card: it,
                    player,
                    region,
                    spot: host === undefined ? Spot.InPlay : Spot.Attached,
                    host,
                    rank,
                    blood: 0,
                    greenCounter: inPlayCard.counters ?? 0,
                    isLocked: inPlayCard.locked,
                    isFlipped: inPlayCard.contested ?? false,
                })
                ;(inPlayCard.stored ?? [])
                    .map(c => seen(c))
                    .forEach((card, storedRank) =>
                        placements.set(card.copy, {
                            card,
                            player,
                            region,
                            spot: Spot.Attached,
                            host: it.copy,
                            rank: storedRank,
                            blood: 0,
                            greenCounter: 0,
                            isLocked: false,
                            isFlipped: card.id === null,
                            stored: true,
                        }),
                    )
            }

            const minions = (list: MinionView[], region: AnyCardRegion, spot: Spot) =>
                list.forEach((minion, rank) => {
                    const card = seen(minion.card)
                    const markers = minion.markers ?? []
                    const { chips, labels } = minionMarkers(markers)
                    placements.set(card.copy, {
                        card,
                        player,
                        region,
                        spot,
                        rank,
                        blood: minion.blood,
                        // Its corruption counters, all Methuselahs', as SC's green counter
                        greenCounter: markers
                            .filter(k => k.kind == 'corruption')
                            .reduce((n, k) => n + (k.n ?? 1), 0),
                        markers: labels,
                        chips,
                        isLocked: minion.locked,
                        isFlipped: minion.contested ?? false,
                        minion,
                    })
                    minion.cards.forEach((inPlayCard, attachedRank) =>
                        inPlay(inPlayCard, region, attachedRank, card.copy),
                    )
                })
            minions(seat.ready, player.ready, Spot.Minion)
            minions(seat.torpor, player.torpor, Spot.Torpor)

            seat.in_play.forEach((inPlayCard, rank) => inPlay(inPlayCard, player.ready, rank))

            pile(5, seat.limbo).forEach((card, rank) =>
                placements.set(card.copy, {
                    card,
                    player,
                    region: player.ready,
                    spot: Spot.Limbo,
                    rank,
                    blood: 0,
                    greenCounter: 0,
                    isLocked: false,
                    isFlipped: false,
                }),
            )
        }

        return placements
    }

    /**
     * Bookkeeping : cards, identities, order of the stacks
     */

    // A copy the view doesn't show anymore : its card left the game
    // ( an ousted player's cards, a shuffled stack re-identified )
    private removeGone(placements: Map<number, Placement>) {
        for (const [copy, oid] of this.cards) {
            if (placements.has(copy)) {
                continue
            }
            const card = this.gameState.cards[oid]
            if (card) {
                card.region.remove(card)
                // Kept as a stale card ( with what was known of it ) : the history refers to it
                this.gameState.staleCards[oid] = card
                delete this.gameState.cards[oid]
            }
            this.cards.delete(copy)
        }
    }

    private create(copy: number, placement: Placement) {
        const oid = generateCardOid()
        const { card, player, region } = placement

        // The identity must be known before the card is created, to init its attributes
        if (card.id !== null) {
            this.gameState.knownCards[oid] = card.id.toString()
        }
        this.gameState.cards[oid] =
            card.crypt ?
                new CryptCard(this.gameState.gameId, oid, player.oid)
            :   new LibraryCard(this.gameState.gameId, oid, player.oid)
        // Read it back through the game state, to stay reactive
        const created = this.gameState.cards[oid]
        region.append(created)
        this.cards.set(copy, oid)

        if (region.is.play) {
            const { x, y } = this.position(created, placement)
            created.x = x
            created.y = y
            created.blood = placement.blood
            created.greenCounter = placement.greenCounter
            created.markers = [...(placement.markers ?? [])]
            created.isLocked = placement.isLocked
            created.isFlipped = placement.isFlipped
        }
    }

    private forget(oid: CardOid) {
        if (oid in this.gameState.knownCards) {
            delete this.gameState.knownCards[oid]
        }
    }

    // A card the viewer now knows ( a card played, drawn, revealed ), or knows no more
    private learn(placements: Map<number, Placement>) {
        for (const [copy, placement] of placements) {
            const card = this.card(copy)
            if (!card) {
                continue
            }
            const krcgId = placement.card.id?.toString()
            if (card.krcgId == krcgId) {
                continue
            }
            if (krcgId === undefined) {
                this.forget(card.oid)
            } else {
                this.gameState.knownCards[card.oid] = krcgId
                card.initMinionAttrs()
            }
        }
    }

    private order() {
        for (const { region, copies } of this.stacks) {
            const oids = copies
                .map(copy => this.cards.get(copy))
                .filter((oid): oid is CardOid => oid !== undefined)
            if (oids.join() != region.cardsOid.join()) {
                region.cardsOid = oids
            }
        }
    }

    /**
     * What a player would do by hand : through mutations
     */

    private move(placements: Map<number, Placement>) {
        // Hosts first, so the cards on them land relative to where they are
        const ordered = [...placements].sort(
            ([, a], [, b]) => Number(a.host !== undefined) - Number(b.host !== undefined),
        )
        const hosts = new Set<CardOid>()
        for (const [copy, placement] of ordered) {
            const spot = `${placement.spot}:${placement.host ?? ''}`
            const before = this.spots.get(copy)
            this.spots.set(copy, spot)
            const card = this.card(copy)
            if (!card) {
                continue
            }
            const to = placement.region
            const host = this.card(placement.host)
            // Just created ( placed already ) or moved below
            // A stack moved whole ( its bearer to torpor and back ) is remounted : put in order again
            if (
                placement.spot == Spot.Attached &&
                host &&
                (before != spot || card.region.oid != to.oid)
            ) {
                hosts.add(host.oid)
            }
            if (card.region.oid == to.oid) {
                // Same region : moved only when its spot changed, the user may arrange the rest
                if (!to.is.play || before === undefined || before == spot) {
                    continue
                }
                gameMutations.moveCard.act(placement.player, {
                    card,
                    ...this.position(card, placement),
                })
            } else {
                const movement = to.is.play ? this.position(card, placement) : { position: 0 }
                gameMutations.moveCardToRegion.act(placement.player, {
                    card,
                    fromCardRegion: card.region,
                    toCardRegion: to,
                    ...movement,
                })
            }
        }
        for (const copy of [...this.spots.keys()]) {
            if (!placements.has(copy)) {
                this.spots.delete(copy)
            }
        }
        // The hosts over the cards on them, once those are on the table
        if (hosts.size) {
            void nextTick(() => hosts.forEach(restoreStack))
        }
    }

    // Where a card arriving in a play region lands. Cards already there are
    // left where they are : the user may arrange them.
    private position(card: Card, placement: Placement): { x: number; y: number } {
        const { region, player, rank } = placement
        const start = GRID_SIZE + rank * CARD_SPACING_X

        switch (placement.spot) {
            case Spot.Uncontrolled: {
                // The first slot no card covers : those already there stay
                // where they are, so once one left, the rank alone placed a
                // newcomer past the row, behind the panel ( Family Gathering )
                const others = region.cards.filter(c => c.oid != card.oid).map(getCardRectangle)
                for (let slot = 0; ; slot++) {
                    const x = player.separators.verticalX + 8 * GRID_SIZE * slot
                    const rect = getCardRectangleAt(region, x, TORPOR_ZONE_Y)
                    if (!others.some(o => Phaser.Geom.Intersects.RectangleToRectangle(rect, o))) {
                        return { x, y: TORPOR_ZONE_Y }
                    }
                }
            }
            case Spot.Torpor:
                return { x: start, y: TORPOR_ZONE_Y }
            case Spot.Attached: {
                const host = this.card(placement.host)
                if (host && host.region.oid == region.oid) {
                    return this.stackPosition(card, placement, host)
                }
                return rowPosition(card, region, [Row.Top, Row.Middle], true)
            }
            case Spot.Minion:
                return rowPosition(card, region, [Row.Bottom, Row.Middle], false)
            case Spot.Limbo:
                return findFreePlayPosition(region, card, 24 * GRID_SIZE, LIMBO_ROW_Y)
            default:
                return rowPosition(card, region, [Row.Top, Row.Middle], true)
        }
    }

    // One name strip above the highest card already on the host, the first nearest it
    private stackPosition(card: Card, placement: Placement, host: Card): { x: number; y: number } {
        const title = CARD_HEIGHT * getCardScale(RegionCategory.Table, host.region) * TITLE_RATIO
        const levels = [...this.placements]
            .filter(([, other]) => other.host == placement.host)
            .flatMap(([copy]) => this.card(copy) ?? [])
            .filter(other => other.oid != card.oid && other.region.oid == host.region.oid)
            // Those the user moved elsewhere don't count
            .filter(other => other.x == host.x && other.y < host.y)
            .map(other => other.y)
        return { x: host.x, y: Math.min(host.y, ...levels) - title }
    }

    private setProperties(placements: Map<number, Placement>) {
        for (const [copy, placement] of placements) {
            const card = this.card(copy)
            if (!card || !card.isIn.play) {
                continue
            }
            const author = placement.player
            if (card.blood != placement.blood) {
                gameMutations.changeBlood.act(author, {
                    card,
                    amount: placement.blood - card.blood,
                })
            }
            if (card.greenCounter != placement.greenCounter) {
                gameMutations.changeGreenCounter.act(author, {
                    card,
                    amount: placement.greenCounter - card.greenCounter,
                })
            }
            const markers = placement.markers ?? []
            for (const marker of card.markers.filter(marker => !markers.includes(marker))) {
                gameMutations.changeMarker.act(author, { card, marker, operation: 'Remove' })
            }
            for (const marker of markers.filter(marker => !card.hasMarker(marker))) {
                gameMutations.changeMarker.act(author, { card, marker, operation: 'Add' })
            }
            if (card.isLocked != placement.isLocked) {
                gameMutations.setLock.act(author, { card, newValue: placement.isLocked })
            }
            if (card.isFlipped != placement.isFlipped) {
                gameMutations.setFlip.act(author, { card, newValue: placement.isFlipped })
            }
        }
    }

    /**
     * A library card in play as a minion is one for SC too ( its menus, its
     * blood ) : a vampire created by a card ( Childe of the Revolution ), an
     * ally, a token. Written directly, like the identity : the engine made it
     * so. Unmade once it is no longer one ( burned, to the ash heap ).
     */
    private setMinions(placements: Map<number, Placement>) {
        for (const [copy, placement] of placements) {
            const card = this.card(copy)
            const minion = placement.minion
            if (!card || card instanceof CryptCard) {
                continue
            }
            if (minion && minion.kind != 'vampire') {
                if (minion.kind == 'created') {
                    card.becomeVampire()
                } else {
                    card.becomeMinion()
                }
                if (minion.capacity != null && card.isMinion()) {
                    card.minionAttrs.capacity = minion.capacity
                }
                this.madeMinions.add(copy)
            } else if (this.madeMinions.delete(copy)) {
                card.minionAttrs = undefined
                card.vampireAttrs = undefined
                // An ally is a minion anywhere for SC ( see LibraryCard.initMinionAttrs )
                card.initMinionAttrs()
            }
        }
        for (const copy of [...this.madeMinions]) {
            if (!placements.has(copy)) {
                this.madeMinions.delete(copy)
            }
        }
    }

    private setSeats(view: TableView) {
        for (const seat of view.seats) {
            const player = this.player(seat.seat)
            const pool = Math.max(0, seat.pool)
            if (player.pool != pool) {
                gameMutations.changePool.act(player, { player, amount: pool - player.pool })
            }
        }

        const edge = view.seats.find(seat => seat.edge)
        const edgeController = edge ? this.player(edge.seat) : undefined
        if (this.gameState.theEdgeControllerOid != edgeController?.oid) {
            gameMutations.changeTheEdgeControl.act(edgeController ?? this.player(view.active), {
                theEdgeController: edgeController,
            })
        }

        // The engine knows the victory points and who is ousted ( a pool at 0
        // is not always an oust, an oust not always a point to the predator )
        for (const seat of view.seats) {
            const player = this.player(seat.seat)
            player.isOusted = seat.ousted
            player.victoryPoints = seat.vp_halves / 2
        }
    }

    private setTurn(view: TableView) {
        const active = this.player(view.active)

        if (this.gameState.turnNumber != view.turn) {
            gameMutations.goToTurn.act(active, { index: view.turn })
        }
        const activeIndex = this.gameState.competingPlayers.indexOf(active)
        if (activeIndex >= 0 && this.gameState.activePlayerIndex != activeIndex) {
            this.gameState.activePlayerIndex = activeIndex
        }

        const phase = PHASES[view.phase]
        if (phase && this.gameState.turnPhase != phase) {
            gameMutations.goToTurnPhase.act(active, { index: TurnSequence.indexOf(phase) })
        }
    }

    /**
     * The action under way, as SC's action panel shows it ( ActionInfos ) :
     * written directly, for display. The engine plays it out : SC's own
     * action flow never runs.
     */
    private setAction(view: TableView) {
        const action = view.action
        // The bleed's amount, whatever bleeds ( a minion, an action card ) ; the transfers left
        useEngineStore().bleed = action?.bleed ?? null
        useEngineStore().transfers = view.transfers ?? null
        const acting = action ? this.card(action.acting) : undefined
        if (!action || !acting?.isMinion()) {
            this.gameState.action = null
            return
        }
        const minionAction = this.minionAction(action, acting, this.target(action.target))
        const blocker = this.card(action.blocker)
        const decisions: BlockingDecision[] = (action.declined ?? []).map(seat => ({
            player: this.player(seat),
            block: NO_BLOCK,
        }))
        if (blocker?.isMinion()) {
            decisions.push({ player: blocker.controller, block: blocker })
        }
        const impulse = this.gameState.action?.impulsePlayer ?? acting.controller
        this.gameState.action = {
            minionAction,
            blockingDecisions: decisions,
            stealth: action.stealth,
            intercept: action.intercept ?? 0,
            bleed: action.bleed ?? 0,
            hunt: 0,
            impulsePlayer: impulse,
        }
    }

    private minionAction(
        action: ActionView,
        acting: Minion,
        target: Card | Player | undefined,
    ): MinionAction {
        const base = { actingMinion: acting, target } as const
        // An action card, on its way to play : played from hand, with its Disciplines and X
        const card = this.card(action.card?.copy)
        if (card) {
            const bled =
                action.kind == 'bleed' ? this.player(action.bleed_target ?? action.seat) : undefined
            return {
                ...base,
                target: bled ?? target,
                type: MinionActionType.ActionCardFromHand,
                card,
                usage: {
                    target: bled ?? target,
                    disciplines: disciplineUses(action.mode),
                    x: action.x ?? undefined,
                },
            } as MinionAction
        }
        switch (action.kind) {
            case 'bleed':
                return {
                    ...base,
                    type: MinionActionType.Bleed,
                    target: this.player(action.bleed_target ?? action.seat),
                } as MinionAction
            case 'hunt':
                return { ...base, type: MinionActionType.Hunt } as MinionAction
            case 'leave_torpor':
                return { ...base, type: MinionActionType.LeaveTorpor } as MinionAction
            case 'rescue':
                return { ...base, type: MinionActionType.RescueFromTorpor } as MinionAction
            case 'diablerie':
                return { ...base, type: MinionActionType.Diablerize } as MinionAction
        }
        // Granted by a card in play, or by the minion itself
        return {
            ...base,
            type: MinionActionType.ActionInPlay,
            card: this.card(action.source) ?? acting,
        } as MinionAction
    }

    /**
     * What the referendum is about, for its panel : the card calling it,
     * and the terms chosen so far ( Methuselahs, minions, a clan, cards,
     * points ).
     */
    private referendumTerms(view: TableView): string[] {
        const referendum = view.referendum
        if (!referendum) {
            return []
        }
        const lines: string[] = []
        const card = this.referendumCard(view)
        const calling = this.card(referendum.calling)
        if (card || calling) {
            lines.push(
                [card?.name, calling && `called by ${calling.name}`].filter(Boolean).join(', '),
            )
        }
        const terms = referendum.terms
        const seat = (s: number) => this.player(s).name
        const chosen = terms.seats ?? []
        if (chosen.length > 0) {
            lines.push(`Methuselah${chosen.length > 1 ? 's' : ''} : ${chosen.map(seat).join(', ')}`)
        }
        const named = (terms.cards ?? []).map(c => this.card(c))
        const minions = named.filter(c => c?.isMinion()).map(c => c?.name ?? '?')
        if (minions.length > 0) {
            lines.push(`Minion${minions.length > 1 ? 's' : ''} : ${minions.join(', ')}`)
        }
        if (terms.clan) {
            lines.push(`Clan : ${terms.clan}`)
        }
        const cards = named.filter(c => !c?.isMinion()).map(c => c?.name ?? '?')
        if (cards.length > 0) {
            lines.push(`Card${cards.length > 1 ? 's' : ''} : ${cards.join(', ')}`)
        }
        const points = (terms.allocated ?? []).map(
            a =>
                `${a.to.kind == 'seat' ? seat(a.to.seat) : (this.card(a.to.copy)?.name ?? '?')} ${a.points}`,
        )
        if (points.length > 0) {
            lines.push(`Points : ${points.join(', ')}`)
        }
        return lines
    }

    // The card calling the referendum : the action card played, or the card in play granting it
    private referendumCard(view: TableView): Card | undefined {
        const action = view.action
        return this.card(action?.card?.copy) ?? this.card(action?.source)
    }

    private setReferendum(view: TableView) {
        const referendum = view.referendum
        useEngineStore().terms = this.referendumTerms(view)
        // What passing does : the card's text
        useEngineStore().referendumText = referendum ? (this.referendumCard(view)?.text ?? '') : ''
        if (!referendum) {
            this.gameState.referendum = null
            return
        }
        const state = createReferendumState()
        const side = (favor: boolean) => (favor ? VoteSide.InFavour : VoteSide.Against)
        for (const vote of referendum.votes.filter(v => !v.canceled)) {
            const vampire = vote.source == 'vampire' ? this.card(vote.copy) : undefined
            if (vampire) {
                const cast = state.votes[vampire.oid]
                state.votes[vampire.oid] = {
                    side: side(vote.favor),
                    amount: (cast?.amount ?? 0) + vote.n,
                }
                continue
            }
            const player = this.player(vote.seat)
            const votes: VoteCount = state.playerVotes[player.oid] ?? {
                [VoteSide.InFavour]: 0,
                [VoteSide.Against]: 0,
            }
            votes[side(vote.favor)] += vote.n
            state.playerVotes[player.oid] = votes
        }
        this.gameState.referendum = state
    }
}

// A mode's Disciplines as SC's uses ( level inferior or superior )
export function disciplineUses(mode: Mode | null | undefined): DisciplineUse[] {
    return (mode?.disciplines ?? [])
        .filter(d => DisciplineCode[d.discipline])
        .map(d => ({
            discipline: DisciplineCode[d.discipline],
            level: d.superior ? DisciplineLevel.SUPERIOR : DisciplineLevel.INFERIOR,
        }))
}

// The rows of a seat's ready region, for cards of its scale : under the player's bar,
// above its separator, and halfway
function rows(region: AnyCardRegion, cardHeight: number): Record<Row, number> {
    const top = PLAYER_BAR_HEIGHT + ROW_MARGIN
    const separatorY = region.owner?.separators.horizontalY ?? TORPOR_ZONE_Y
    const bottom = Math.max(top, separatorY - ROW_MARGIN - cardHeight)
    return { [Row.Top]: top, [Row.Middle]: (top + bottom) / 2, [Row.Bottom]: bottom }
}

// The first free slot of the rows, in order, from the left ( from the right on the middle row
// for the cards in play on no minion ). Past them, the nearest spot free enough.
function rowPosition(
    card: Card,
    region: AnyCardRegion,
    order: Row[],
    fromRight: boolean,
): { x: number; y: number } {
    const scale = getCardScale(RegionCategory.Table, region)
    const width = CARD_WIDTH * scale
    const area = width * CARD_HEIGHT * scale
    const ys = rows(region, CARD_HEIGHT * scale)
    // A slot holds the card locked ( turned from its top left corner, as wide as it is tall )
    const height = CARD_HEIGHT * scale
    const step = Math.ceil(height) + COLUMN_GAP
    const slots = Math.max(1, Math.floor((PLAY_AREA_WIDTH - GRID_SIZE - height) / step) + 1)
    const others = region.cards.filter(c => c.oid != card.oid).map(getCardRectangle)
    for (const row of order) {
        for (let i = 0; i < slots; i++) {
            const slot = row == Row.Middle && fromRight ? slots - 1 - i : i
            const x = GRID_SIZE + slot * step
            const rect = getCardRectangleAt(region, x, ys[row])
            // Rows touch : a shared edge is no overlap
            const free = others.every(
                other =>
                    Phaser.Geom.Rectangle.Area(Phaser.Geom.Rectangle.Intersection(rect, other)) <
                    area / 100,
            )
            if (free) {
                return { x, y: ys[row] }
            }
        }
    }
    return findFreePlayPosition(region, card, GRID_SIZE, ys[order[0]])
}
