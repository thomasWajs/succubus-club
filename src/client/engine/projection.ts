/**
 * Projection of the rules engine's table ( EngineView ) onto the game state.
 *
 * The engine is the authority : after each of its messages, the game state is
 * brought to what the view shows. What a player would do by hand goes through
 * the usual GameMutations ( moves, counters, locks, pool, the Edge, turn and
 * phase ), so the log and the animations tell what happened. The bookkeeping
 * a player never does ( creating the cards, learning or forgetting their
 * identity, the order of a stack ) is written directly, like a resync.
 *
 * The engine identifies each physical card by a `copy` number, stable across
 * views : each copy maps to one Card.
 */

import { GameState } from '@/shared/state/gameState.ts'
import { Player } from '@/shared/model/Player.ts'
import { Card, CryptCard, LibraryCard, Minion } from '@/shared/model/Card.ts'
import { AnyCardRegion, CardOid, PlayerOid } from '@/shared/types/model.ts'
import { gameMutations } from '@/shared/state/gameMutations.ts'
import { generateCardOid } from '@/shared/state/ids.ts'
import { DisciplineCode, DisciplineLevel, TurnPhase, TurnSequence } from '@/shared/const/model.ts'
import { GRID_SIZE, TORPOR_ZONE_Y } from '@/shared/const/game.ts'
import { findFreePlayPosition } from '@/client/game/utils.ts'
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
import { useGameBusStore } from '@/client/store/bus.ts'
import { nextTick } from 'vue'
import {
    EngineCard,
    EngineInPlay,
    EngineMinion,
    EnginePhase,
    EngineView,
} from '@/client/engine/protocol.ts'

// Where new cards land in the ready region : minions on a bottom row,
// the other cards in play on a top row, the cards being played in the middle.
const MINION_ROW_Y = 22 * GRID_SIZE
const IN_PLAY_ROW_Y = 1 * GRID_SIZE
const LIMBO_ROW_Y = 10 * GRID_SIZE
const CARD_SPACING_X = 9 * GRID_SIZE
// A card on a minion peeks out from under it, below and to the right
const ATTACHED_OFFSET_X = 2 * GRID_SIZE
const ATTACHED_OFFSET_Y = 3 * GRID_SIZE

const PHASES: Record<EnginePhase, TurnPhase | null> = {
    unlock: TurnPhase.Unlock,
    master: TurnPhase.Master,
    minion: TurnPhase.Minion,
    influence: TurnPhase.Influence,
    discard: TurnPhase.Discard,
    over: null,
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
    card: EngineCard
    player: Player
    region: AnyCardRegion
    spot: Spot
    host?: number // copy of the card it is on
    rank: number // order among its siblings ( slot, attachment rank )
    blood: number
    greenCounter: number
    // A minion's other public state, as SC's markers : its hostage and nightmare counters, the
    // counters of a lingering effect on it, whose corruption it bears, a contested title
    markers?: string[]
    isLocked: boolean
    isFlipped: boolean
    // A minion : the engine's own ( its kind : a vampire, an ally, a created vampire, a token )
    minion?: EngineMinion
    // Stored on a card in play ( Fleshforge Chamber ), not attached to it
    stored?: boolean
}

export class Projection {
    private cards = new Map<number, CardOid>()
    // The order of the stacks, as the view shows them
    private stacks: { region: AnyCardRegion; copies: number[] }[] = []
    // Copy of each minion, by the engine's minion id, and of each card in play
    private minions = new Map<number, number>()
    private inPlay = new Map<number, number>()
    // Copies in each seat's uncontrolled region, by slot
    private uncontrolledSlots = new Map<number, number[]>()
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

    // The card of a minion, by the engine's minion id
    minion(minion: number | undefined): Card | undefined {
        return minion === undefined ? undefined : this.card(this.minions.get(minion))
    }

    // The card of a card in play, by the engine's card id
    cardInPlay(cardId: number | null | undefined): Card | undefined {
        return cardId === null || cardId === undefined ?
                undefined
            :   this.card(this.inPlay.get(cardId))
    }

    // The card in a seat's uncontrolled region, by the engine's slot
    uncontrolled(seat: number | undefined, slot: number): Card | undefined {
        return seat === undefined ? undefined : this.card(this.uncontrolledSlots.get(seat)?.[slot])
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

    apply(view: EngineView) {
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
    check(view: EngineView): string[] {
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
                        n + 1 + minion.cards.reduce((m, c) => m + 1 + c.stored.length, 0),
                    0,
                ) +
                seat.in_play.reduce((n, c) => n + 1 + c.stored.length, 0)
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

    private read(view: EngineView): Map<number, Placement> {
        const placements = new Map<number, Placement>()
        this.stacks = []
        this.minions.clear()
        this.inPlay.clear()
        this.uncontrolledSlots.clear()

        for (const seat of view.seats) {
            const player = this.player(seat.seat)

            const stack = (region: AnyCardRegion, cards: EngineCard[]) => {
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
            stack(player.crypt, [...seat.crypt].reverse())
            stack(player.library, [...seat.library].reverse())
            stack(player.hand, seat.hand)
            stack(player.ashHeap, [...seat.ash_heap].reverse())
            stack(player.removed, [...seat.removed].reverse())

            this.uncontrolledSlots.set(
                seat.seat,
                seat.uncontrolled.map(slot => slot.card.copy),
            )
            seat.uncontrolled.forEach((slot, rank) =>
                placements.set(slot.card.copy, {
                    card: slot.card,
                    player,
                    region: player.uncontrolled,
                    spot: Spot.Uncontrolled,
                    rank,
                    blood: slot.counters,
                    greenCounter: 0,
                    isLocked: false,
                    isFlipped: false,
                }),
            )

            const inPlay = (
                inPlayCard: EngineInPlay,
                region: AnyCardRegion,
                rank: number,
                host?: number,
            ) => {
                this.inPlay.set(inPlayCard.card_id, inPlayCard.card.copy)
                placements.set(inPlayCard.card.copy, {
                    card: inPlayCard.card,
                    player,
                    region,
                    spot: host === undefined ? Spot.InPlay : Spot.Attached,
                    host,
                    rank,
                    blood: 0,
                    greenCounter: inPlayCard.counters,
                    isLocked: inPlayCard.locked,
                    isFlipped: inPlayCard.contested,
                })
                inPlayCard.stored.forEach((card, storedRank) =>
                    placements.set(card.copy, {
                        card,
                        player,
                        region,
                        spot: Spot.Attached,
                        host: inPlayCard.card.copy,
                        rank: storedRank,
                        blood: 0,
                        greenCounter: 0,
                        isLocked: false,
                        isFlipped: card.id === null,
                        stored: true,
                    }),
                )
            }

            const minions = (list: EngineMinion[], region: AnyCardRegion, spot: Spot) =>
                list.forEach((minion, rank) => {
                    this.minions.set(minion.minion, minion.card.copy)
                    placements.set(minion.card.copy, {
                        card: minion.card,
                        player,
                        region,
                        spot,
                        rank,
                        blood: minion.blood,
                        // Its corruption counters, as SC's green counter
                        greenCounter: minion.corruption ?? 0,
                        markers: minion.markers,
                        isLocked: minion.locked,
                        isFlipped: minion.contested,
                        minion,
                    })
                    minion.cards.forEach((inPlayCard, attachedRank) =>
                        inPlay(inPlayCard, region, attachedRank, minion.card.copy),
                    )
                })
            minions(seat.ready, player.ready, Spot.Minion)
            minions(seat.torpor, player.torpor, Spot.Torpor)

            seat.in_play.forEach((inPlayCard, rank) => inPlay(inPlayCard, player.ready, rank))

            seat.limbo.forEach((card, rank) =>
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
            if (placement.spot == Spot.Attached && host && before != spot) {
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
            void nextTick(() => {
                const gameBus = useGameBusStore()
                hosts.forEach(oid => gameBus.cardsInGame[oid]?.bringToTop())
            })
        }
    }

    // Where a card arriving in a play region lands. Cards already there are
    // left where they are : the user may arrange them.
    private position(card: Card, placement: Placement): { x: number; y: number } {
        const { region, player, rank } = placement
        const start = GRID_SIZE + rank * CARD_SPACING_X

        switch (placement.spot) {
            case Spot.Uncontrolled:
                return { x: player.separators.verticalX + 8 * GRID_SIZE * rank, y: TORPOR_ZONE_Y }
            case Spot.Torpor:
                return { x: start, y: TORPOR_ZONE_Y }
            case Spot.Attached: {
                const host = this.card(placement.host)
                if (host && host.region.oid == region.oid) {
                    return {
                        x: host.x + ATTACHED_OFFSET_X * (rank + 1),
                        y: host.y + ATTACHED_OFFSET_Y,
                    }
                }
                return findFreePlayPosition(region, card, start, IN_PLAY_ROW_Y)
            }
            case Spot.Minion:
                return findFreePlayPosition(region, card, start, MINION_ROW_Y)
            case Spot.Limbo:
                return findFreePlayPosition(region, card, 24 * GRID_SIZE, LIMBO_ROW_Y)
            default:
                return findFreePlayPosition(region, card, start, IN_PLAY_ROW_Y)
        }
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
                if (minion.capacity !== null && card.isMinion()) {
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

    private setSeats(view: EngineView) {
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
            player.victoryPoints = seat.vps
        }
    }

    private setTurn(view: EngineView) {
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
    private setAction(view: EngineView) {
        const action = view.action
        const acting = action ? this.minion(action.acting) : undefined
        if (!action || !acting?.isMinion()) {
            this.gameState.action = null
            return
        }
        const target =
            action.target?.kind == 'minion' ? this.minion(action.target.minion)
            : action.target?.kind == 'card' ? this.cardInPlay(action.target.card_id)
            : action.target?.kind == 'seat' ? this.player(action.target.seat)
            : undefined
        const minionAction = this.minionAction(view, action, acting, target)
        const blocker = this.minion(action.blocker ?? undefined)
        const decisions: BlockingDecision[] = action.declined.map(seat => ({
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
        view: EngineView,
        action: NonNullable<EngineView['action']>,
        acting: Minion,
        target: Card | Player | undefined,
    ): MinionAction {
        const base = { actingMinion: acting, target } as const
        // An action card, on its way to play ( limbo ) : played from hand, with its Disciplines and X
        const played =
            action.card === null ?
                undefined
            :   view.seats[action.seat].limbo.find(card => card.id == action.card)
        const card = played ? this.card(played.copy) : undefined
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
                    disciplines: disciplineUses(action.mode?.tags ?? []),
                    x: action.x,
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
            case 'leave torpor':
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
            card: this.cardInPlay(action.source) ?? acting,
        } as MinionAction
    }

    /**
     * The referendum under way, as SC's referendum panel and vote boxes show
     * it : the votes of each vampire, the others per Methuselah ( the Edge, a
     * political action card, a card in play ). Written directly, for display.
     */
    /**
     * What the referendum is about, for its panel : the card calling it,
     * and the terms chosen so far ( Methuselahs, minions, a clan, cards,
     * points ).
     */
    private referendumTerms(view: EngineView): string[] {
        const referendum = view.referendum
        if (!referendum) {
            return []
        }
        const lines: string[] = []
        const action = view.action
        const played =
            action?.card != null ?
                view.seats[action.seat].limbo.find(card => card.id == action.card)
            :   undefined
        const card =
            (played ? this.card(played.copy) : undefined) ?? this.cardInPlay(action?.source)
        const calling = this.minion(referendum.calling ?? undefined)
        if (card || calling) {
            lines.push(
                [card?.name, calling && `called by ${calling.name}`].filter(Boolean).join(', '),
            )
        }
        const seat = (s: number) => this.player(s).name
        const chosen = [
            ...(referendum.chosen !== null ? [referendum.chosen] : []),
            ...referendum.seats,
        ]
        if (chosen.length > 0) {
            lines.push(`Methuselah${chosen.length > 1 ? 's' : ''} : ${chosen.map(seat).join(', ')}`)
        }
        const minions = referendum.minions.map(m => this.minion(m)?.name ?? '?')
        if (minions.length > 0) {
            lines.push(`Minion${minions.length > 1 ? 's' : ''} : ${minions.join(', ')}`)
        }
        if (referendum.clan) {
            lines.push(`Clan : ${referendum.clan}`)
        }
        const cards = referendum.cards.map(c => this.cardInPlay(c)?.name ?? '?')
        if (cards.length > 0) {
            lines.push(`Card${cards.length > 1 ? 's' : ''} : ${cards.join(', ')}`)
        }
        const points = [
            ...referendum.allocated.map(([s, n]) => `${seat(s)} ${n}`),
            ...referendum.card_allocated.map(([c, n]) => `${this.cardInPlay(c)?.name ?? '?'} ${n}`),
        ]
        if (points.length > 0) {
            lines.push(`Points : ${points.join(', ')}`)
        }
        return lines
    }

    private setReferendum(view: EngineView) {
        const referendum = view.referendum
        useEngineStore().terms = this.referendumTerms(view)
        if (!referendum) {
            this.gameState.referendum = null
            return
        }
        const state = createReferendumState()
        const side = (favor: boolean) => (favor ? VoteSide.InFavour : VoteSide.Against)
        for (const vote of referendum.votes.filter(v => !v.canceled)) {
            const vampire = vote.source == 'vampire' ? this.minion(vote.minion) : undefined
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

// A mode's printed tags as Disciplines used ( 'dom' basic, 'DOM' superior ) : the other tags dropped
export function disciplineUses(tags: string[]): DisciplineUse[] {
    return tags
        .filter(tag => DisciplineCode[tag.toLowerCase()])
        .map(tag => ({
            discipline: DisciplineCode[tag.toLowerCase()],
            level: tag == tag.toLowerCase() ? DisciplineLevel.INFERIOR : DisciplineLevel.SUPERIOR,
        }))
}
