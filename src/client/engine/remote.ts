/**
 * The rules engine on a server ( zvtes-server, docs/protocol.md of zero-vtes ) : a game created
 * over HTTP, played over a WebSocket. The server's messages ( ./api.ts, generated from its schema )
 * are told to the driver as the in-browser engine's ( ./protocol.ts ) : one message per decision
 * taken, the table after it, the user's decisions, the end. Copies stand for the engine's ids :
 * a minion is its card's copy, a card in play its copy.
 */

import type {
    Card as ApiCard,
    CardRef,
    Decision,
    Event,
    GameSpec,
    InPlayView,
    MinionView,
    Mode,
    OptionView,
    Out,
    TableView,
    Target,
} from '@/client/engine/api.ts'
import { EngineHost } from '@/client/engine/host.ts'
import {
    EngineAllocation,
    EngineCard,
    EngineGameSpec,
    EngineInPlay,
    EngineMinion,
    EngineMode,
    EngineOption,
    EngineOut,
    EngineTarget,
    EngineView,
} from '@/client/engine/protocol.ts'

// A window as the driver names it
const WINDOWS: Record<string, string> = {
    unlock_abilities: 'Unlock phase',
    master_phase: 'Master phase',
    play_terms: 'Terms of the play',
    rider_terms: 'Paying an effect',
    phase_impulse: 'End of phase',
    card_as_played: 'As the card is played',
    minion_phase: 'Minion phase',
    action_as_announced: 'As the action is announced',
    action_block: 'Block attempts',
    action_after_resolution: 'After resolution',
    action_would_be_successful: 'Action would be successful',
    action_blocks_declined: 'Blocks declined',
    action_blocked: 'Action blocked',
    action_after_combat: 'After combat',
    torpor_block: 'Blocked leave torpor',
    rescue_cost: 'Rescue cost',
    entry_effect: 'Entering play',
    resolution_choice: 'Resolving an effect',
    block_toll: 'Block toll',
    distribution: 'Distributing blood',
    blood_hunt_polling: 'Blood hunt',
    referendum_terms: 'Referendum terms',
    referendum_polling: 'Referendum',
    discard_down: 'Discard down to hand size',
    action_terms: 'Terms of the action',
    library_search: 'Library search',
    action_exchange: 'Exchange',
    draw: 'Draw',
    bottom_cards: "Cards to the library's bottom",
    influence_transfers: 'Influence phase',
    discard_phase: 'Discard phase',
    combat_before_range: 'Combat: before range',
    combat_determine_range: 'Combat: range',
    combat_before_strikes: 'Combat: before strikes',
    combat_strike: 'Combat: strike',
    combat_before_resolution: 'Combat: before resolution',
    combat_prevention: 'Combat: damage prevention',
    combat_prevention_allocation: 'Combat: aggravated damage prevented',
    combat_additional_strikes: 'Combat: additional strikes',
    combat_press: 'Combat: press',
    combat_end_of_round: 'Combat: end of round',
}

// An action as the driver names it
const ACTIONS: Record<string, string> = {
    bleed: 'bleed',
    hunt: 'hunt',
    leave_torpor: 'leave torpor',
    rescue: 'rescue',
    diablerie: 'diablerie',
    employ: 'employ',
    recruit: 'recruit',
    political: 'political action',
    card: 'action',
    burn_card: 'burn card',
    steal_card: 'steal card',
    equip: 'equip',
    equip_from: 'equip from a minion',
    equip_found: 'equip from the library',
    ability: 'action',
    become_anarch: 'become Anarch',
    red_list_hunt: 'enter combat with a Red List minion',
}

const windowName = (w: string) => WINDOWS[w] ?? w
const actionName = (a: string) => ACTIONS[a] ?? a.replace(/_/g, ' ')

// What the server sends while a command is answered, then the decision or the end
type Waiter = () => void

export class RemoteEngineHost implements EngineHost {
    private queue: EngineOut[] = []
    private waiting: Waiter[] = []
    // Events told since the last message given to the driver
    private told: string[] = []
    private view: TableView | null = null
    private names: string[] = []
    private lastDecision = -1
    private answered = true
    private failure: Error | null = null

    private constructor(
        private server: string,
        private game: string,
        private token: string,
        private ws: WebSocket,
    ) {}

    // A game created on `server` ( https://engine.krcg.org ), the user's seat joined
    static async create(
        spec: EngineGameSpec,
        server: string,
        opportunities: boolean,
    ): Promise<RemoteEngineHost> {
        const body: GameSpec = {
            seed: spec.seed,
            time_limit: spec.time_limit ?? null,
            client: 'succubus-club',
            seats: spec.seats.map(s => ({
                name: s.name,
                deck: s.deck,
                player:
                    s.player.kind == 'human' ?
                        { type: 'human', settings: { views: 'steps', text: true, opportunities } }
                    :   { type: 'bot', profile: s.player.style },
            })),
        }
        const res = await fetch(`${server}/games`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        })
        if (!res.ok) {
            throw new Error(`The engine server refused the game : ${await res.text()}`)
        }
        const { game, token } = await res.json()
        const ws = new WebSocket(`${server.replace(/^http/, 'ws')}/games/${game}/ws`)
        const host = new RemoteEngineHost(server, game, token, ws)
        ws.onmessage = e => host.receive(JSON.parse(e.data) as Out)
        ws.onclose = () => host.fail(new Error('The engine server closed the game'))
        await new Promise<void>((resolve, reject) => {
            ws.onopen = () => resolve()
            ws.onerror = () => reject(new Error('The engine server cannot be reached'))
        })
        ws.send(JSON.stringify({ type: 'join', token }))
        return host
    }

    private fail(error: Error) {
        this.failure ??= error
        this.wake()
    }

    private wake() {
        const waiting = this.waiting
        this.waiting = []
        waiting.forEach(w => w())
    }

    private push(out: EngineOut) {
        this.queue.push(out)
        this.wake()
    }

    private async next(): Promise<EngineOut> {
        while (!this.queue.length) {
            if (this.failure) {
                throw this.failure
            }
            await new Promise<void>(resolve => this.waiting.push(resolve))
        }
        const out = this.queue.shift() as EngineOut
        if (out.type == 'decision') {
            this.answered = false
        }
        return out
    }

    private send(command: object) {
        this.answered = true
        this.ws.send(JSON.stringify(command))
    }

    private receive(m: Out) {
        switch (m.type) {
            case 'joined':
                this.names = m.seats.map(s => s.name)
                this.view = m.view
                break
            case 'events': {
                if (m.view) {
                    this.view = m.view
                }
                this.events(m.events)
                break
            }
            case 'decision': {
                this.view = m.view
                // Sent again ( a settings change ) : the one the user is answering stays
                if (m.decision == this.lastDecision && !this.answered) {
                    break
                }
                this.queue = this.queue.filter(
                    o => o.type != 'decision' || o.decision != m.decision,
                )
                this.lastDecision = m.decision
                this.push(this.decision(m))
                break
            }
            case 'over':
                this.view = m.view
                this.push({
                    type: 'over',
                    vps: m.vp_halves.map(v => v / 2),
                    events: this.take(),
                    view: this.translate(m.view),
                })
                break
            case 'error':
                if (m.error == 'rate_limited') {
                    break
                }
                this.fail(new Error(`The engine server refused : ${m.error}`))
                break
        }
    }

    private take(): string[] {
        const told = this.told
        this.told = []
        return told
    }

    // One step's events : those before its decision are told with it, those after with the next
    private events(events: Event[]) {
        for (const e of events) {
            if (e.kind == 'undone') {
                this.queue = []
                this.told = []
                continue
            }
            if (e.kind == 'decided' || e.kind == 'auto_passed') {
                const choice: EngineOption =
                    e.kind == 'decided' ?
                        { ...this.option(e.choice), text: e.text ?? e.choice.text ?? '' }
                    :   { index: 0, kind: 'pass', text: 'Pass' }
                this.push({
                    type: 'decided',
                    decision: e.decision,
                    seat: e.seat,
                    window: windowName(e.window),
                    choice,
                    events: this.take(),
                    view: this.translate(this.view as TableView),
                })
                continue
            }
            if (e.text) {
                this.told.push(e.text)
            }
        }
    }

    private decision(d: Decision): EngineOut {
        return {
            type: 'decision',
            decision: d.decision,
            seat: d.seat,
            window: windowName(d.window),
            options: d.options.map(o => this.option(o)),
            prompt: d.prompt ?? undefined,
            undo: d.undo,
            allocation: d.allocation ? this.allocation(d) : undefined,
            votes: d.votes ?? undefined,
            events: this.take(),
            view: this.translate(d.view),
        }
    }

    private allocation(d: Decision): EngineAllocation {
        const a = d.allocation as NonNullable<Decision['allocation']>
        return {
            points: a.points,
            recipients: a.recipients.map(r =>
                r.to.kind == 'seat' ?
                    { name: this.names[r.to.seat] ?? '', seat: r.to.seat, cap: r.cap ?? undefined }
                :   {
                        name: '',
                        card: { id: null, copy: r.to.copy, card_id: r.to.copy },
                        cap: r.cap ?? undefined,
                    },
            ),
            min_nonzero: a.min_nonzero,
        }
    }

    // Whether a copy is a minion's, on the last table
    private isMinion(copy: number): boolean {
        return (this.view?.seats ?? []).some(s =>
            [...s.ready, ...s.torpor].some(m => m.card.copy == copy),
        )
    }

    // An uncontrolled vampire's slot, by its copy
    private slot(copy: number): number | undefined {
        for (const s of this.view?.seats ?? []) {
            const i = s.uncontrolled.findIndex(u => u.card.copy == copy)
            if (i >= 0) {
                return i
            }
        }
        return undefined
    }

    // A card the option names by its id only ( copies alike in hand are one option ) : the first
    // copy of it in the user's hand, or stored on the card it is played from
    private copyOf(c: CardRef): number | null {
        if (c.copy != null) {
            return c.copy
        }
        const seats = this.view?.seats ?? []
        if (c.from != null) {
            const all = seats.flatMap(s => [
                ...s.in_play,
                ...[...s.ready, ...s.torpor].flatMap(m => m.cards),
            ])
            const on = all.find(p => p.card.copy == c.from)
            return on?.stored?.find(x => x.id == c.id)?.copy ?? null
        }
        const mine = seats.find(s => s.seat == this.view?.viewer)
        return mine?.hand.find(x => x.id == c.id)?.copy ?? null
    }

    private target(t: Target): EngineTarget {
        if (t.kind == 'seat') {
            return { kind: 'seat', seat: t.seat }
        }
        if (this.isMinion(t.copy)) {
            return { kind: 'minion', minion: t.copy }
        }
        const slot = this.slot(t.copy)
        return slot === undefined ?
                { kind: 'card', card_id: t.copy }
            :   { kind: 'uncontrolled', slot }
    }

    private option(o: OptionView): EngineOption {
        const k = o
        const out: EngineOption = { index: o.index, kind: k.kind, text: o.text ?? '' }
        if (k.card) {
            const copy = this.copyOf(k.card)
            out.card = { id: k.card.id ?? null, copy, card_id: copy }
        }
        if (k.minion != null) {
            out.minion = k.minion
        }
        if (k.actor != null) {
            out.actor = k.actor
        }
        if (k.target) {
            // An uncontrolled vampire influenced, transferred to : the option's card
            if (
                k.target.kind == 'card' &&
                ['transfer', 'withdraw', 'influence_out', 'merge'].includes(k.kind)
            ) {
                out.card = { id: null, copy: k.target.copy, card_id: null }
            } else {
                out.target = this.target(k.target)
            }
        }
        if (k.action) {
            out.action = actionName(k.action)
        }
        if (k.amount != null) {
            out.amount = k.amount
        }
        if (k.favor != null) {
            out.favor = k.favor
        }
        if (k.blood != null) {
            out.blood = k.blood
        }
        if (k.mode) {
            out.mode = mode(k.mode)
        }
        if (k.zone) {
            out.zone = {
                seat: k.zone.seat,
                zone: k.zone.zone as 'library' | 'ash_heap' | 'hand' | 'crypt',
            }
        }
        return out
    }

    private translate(v: TableView): EngineView {
        // A card the view leaves unnumbered ( a back ) : a number of its seat, zone and place,
        // stable while it stays there — the projection follows every card by its number
        let hidden = 0
        const back = (seat: number, zone: number, i: number) =>
            -(1 + seat * 100_000 + zone * 10_000 + i)
        const card = (c: ApiCard): EngineCard => ({
            copy: c.copy ?? -++hidden,
            id: c.id ?? null,
            crypt: c.crypt ?? false,
        })
        const pile = (seat: number, zone: number, cards: ApiCard[] | undefined): EngineCard[] =>
            (cards ?? []).map((c, i) => ({ ...card(c), copy: c.copy ?? back(seat, zone, i) }))
        const inPlay = (p: InPlayView): EngineInPlay => ({
            card_id: p.card.copy ?? -++hidden,
            card: card(p.card),
            controller: p.controller,
            locked: p.locked ?? false,
            counters: p.counters ?? 0,
            contested: p.contested ?? false,
            stored: (p.stored ?? []).map(card),
        })
        const minion = (m: MinionView): EngineMinion => ({
            minion: m.card.copy ?? -++hidden,
            card: card(m.card),
            kind: m.kind as EngineMinion['kind'],
            name: m.name,
            blood: m.blood,
            capacity: m.capacity ?? null,
            locked: m.locked ?? false,
            contested: m.contested ?? false,
            title: m.title?.id ?? null,
            owner: m.owner ?? null,
            cards: (m.cards ?? []).map(inPlay),
            markers: (m.markers ?? []).map(k => k.text ?? k.kind),
            corruption:
                (m.markers ?? [])
                    .filter(k => k.kind == 'corruption')
                    .reduce((n, k) => n + (k.n ?? 1), 0) || undefined,
        })
        const target = (t: Target | null | undefined) => (t ? this.target(t) : null)
        return {
            viewer: v.viewer ?? null,
            decision: v.decision,
            turn: v.turn,
            active: v.active,
            phase: v.phase as EngineView['phase'],
            seats: v.seats.map(s => ({
                seat: s.seat,
                pool: s.pool,
                vps: s.vp_halves / 2,
                ousted: s.ousted,
                edge: s.edge,
                prey: s.prey,
                predator: s.predator,
                crypt: pile(s.seat, 0, s.crypt),
                library: pile(s.seat, 1, s.library),
                hand: pile(s.seat, 2, s.hand),
                ash_heap: pile(s.seat, 3, s.ash_heap),
                removed: pile(s.seat, 4, s.removed),
                uncontrolled: (s.uncontrolled ?? []).map((u, i) => ({
                    card: { ...card(u.card), copy: u.card.copy ?? back(s.seat, 6, i) },
                    counters: u.counters ?? 0,
                    banished: u.banished ?? false,
                })),
                ready: (s.ready ?? []).map(minion),
                torpor: (s.torpor ?? []).map(minion),
                in_play: (s.in_play ?? []).map(inPlay),
                limbo: pile(s.seat, 5, s.limbo),
            })),
            action:
                v.action ?
                    {
                        seat: v.action.seat,
                        acting: v.action.acting,
                        kind: actionName(v.action.kind),
                        card: v.action.card?.id ?? null,
                        target: target(v.action.target),
                        bleed_target: v.action.bleed_target ?? null,
                        source: v.action.source ?? null,
                        step: v.action.step.replace(/_/g, ' '),
                        stealth: v.action.stealth,
                        bleed: v.action.bleed ?? null,
                        blocker: v.action.blocker ?? null,
                        intercept: v.action.intercept ?? null,
                        declined: v.action.declined ?? [],
                        mode: v.action.mode ? mode(v.action.mode) : undefined,
                        x: v.action.x ?? undefined,
                    }
                :   null,
            combat:
                v.combat ?
                    {
                        minions: [v.combat.minions[0], v.combat.minions[1]],
                        round: v.combat.round,
                        range: v.combat.range ?? 'close',
                        sides: v.combat.sides.map(s => ({
                            minion: s.minion,
                            strike: s.strike ? (s.strike.text ?? s.strike.kind) : undefined,
                            maneuvers: s.maneuvers,
                            presses: s.presses,
                        })),
                    }
                :   null,
            referendum:
                v.referendum ?
                    {
                        caller: v.referendum.caller,
                        calling: v.referendum.calling ?? null,
                        votes_for: v.referendum.votes_for,
                        votes_against: v.referendum.votes_against,
                        chosen: null,
                        allocated: (v.referendum.terms.allocated ?? []).flatMap(a =>
                            a.to.kind == 'seat' ? [[a.to.seat, a.points] as [number, number]] : [],
                        ),
                        seats: v.referendum.terms.seats ?? [],
                        minions: (v.referendum.terms.cards ?? []).filter(c => this.isMinion(c)),
                        clan: v.referendum.terms.clan ?? undefined,
                        cards: (v.referendum.terms.cards ?? []).filter(c => !this.isMinion(c)),
                        card_allocated: (v.referendum.terms.allocated ?? []).flatMap(a =>
                            a.to.kind == 'card' ? [[a.to.copy, a.points] as [number, number]] : [],
                        ),
                        step: v.referendum.step as 'terms' | 'polling' | 'shortfall',
                        votes: (v.referendum.votes ?? []).map(x => ({
                            seat: x.seat,
                            source: x.source as 'vampire' | 'printed' | 'edge' | 'card' | 'in_play',
                            minion:
                                x.source == 'vampire' || x.source == 'printed' ?
                                    (x.copy ?? undefined)
                                :   undefined,
                            card_id: x.source == 'in_play' ? (x.copy ?? undefined) : undefined,
                            favor: x.favor,
                            n: x.n,
                            canceled: x.canceled ?? false,
                        })),
                    }
                :   null,
        }
    }

    // The batch a command is answered with : the decision or the end it ends on
    private async settled(): Promise<void> {
        while (!this.queue.some(o => o.type != 'decided')) {
            if (this.failure) {
                throw this.failure
            }
            await new Promise<void>(resolve => this.waiting.push(resolve))
        }
    }

    async advance(): Promise<EngineOut> {
        return this.next()
    }

    async answer(decision: number, index: number): Promise<EngineOut> {
        this.send({ type: 'answer', decision, option: index })
        return this.next()
    }

    async allocate(decision: number, amounts: number[]): Promise<EngineOut[]> {
        const seat = this.view?.viewer
        this.send({ type: 'allocate', decision, amounts })
        await this.settled()
        const mine: EngineOut[] = []
        while (this.queue[0]?.type == 'decided' && this.queue[0].seat == seat) {
            mine.push(this.queue.shift() as EngineOut)
        }
        return mine
    }

    async voteAll(decision: number, favor: boolean): Promise<EngineOut> {
        this.send({ type: 'vote_all', decision, favor })
        return this.next()
    }

    async undo(): Promise<void> {
        this.send({ type: 'undo', decision: this.lastDecision })
        await this.settled()
    }

    async setOpportunities(on: boolean): Promise<void> {
        const answered = this.answered
        this.ws.send(JSON.stringify({ type: 'settings', opportunities: on }))
        this.answered = answered
    }

    // The game's record ( the server keeps it two years ), as the export
    async replay(): Promise<string> {
        const res = await fetch(`${this.server}/games/${this.game}/record`, {
            headers: { authorization: `Bearer ${this.token}` },
        })
        return res.text()
    }
}

// A mode as the driver names it : its printed tags ( 'dom' basic, 'DOM' superior, 'COMBAT' )
function mode(m: Mode): EngineMode {
    const tags = (m.disciplines ?? []).map(d =>
        d.superior ? d.discipline.toUpperCase() : d.discipline,
    )
    if (m.card_type) {
        tags.push(m.card_type.replace(/_/g, '').toUpperCase())
    }
    return { index: m.index, tags, line: m.line }
}
