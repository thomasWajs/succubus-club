/**
 * Where the rules engine runs : a server ( zvtes-server on engine.krcg.org, docs/protocol.md of
 * zero-vtes ) ; a game created over HTTP, played over a WebSocket. The server's messages ( ./api.ts,
 * generated from its schema ) are told to the driver in its own terms ( ./protocol.ts ) : one message
 * per decision taken, the table after it, the user's decisions, the end. Copies stand for the
 * engine's ids : a minion is its card's copy, a card in play its copy.
 */

import type {
    Decision,
    Event,
    GameSpec,
    OptionView,
    Out,
    SpecError,
    TableView,
    Window,
} from '@/client/engine/api.ts'
import { DeckList } from '@/shared/types/gateway.ts'

/**
 * One step of the game for the driver : a decision of the user's, a decision taken ( by anyone, the
 * table after it ), or the end ; with the events told since the previous step.
 */
export type EngineOut =
    | ({ type: 'decision'; events: string[] } & Decision)
    | {
          type: 'decided'
          decision: number
          seat: number
          window: Window
          // The option taken ( a pass, when it passed by itself )
          choice: OptionView
          events: string[]
          view: TableView
      }
    | { type: 'over'; vps: number[]; events: string[]; view: TableView }

// The engine server : engine.krcg.org, or another one in development ( a local zvtes-server )
export const ENGINE_SERVER = import.meta.env.VITE_ENGINE_SERVER ?? 'https://engine.krcg.org'

// The decks the engine ships : [name, deck list]
export async function engineCatalog(): Promise<[string, DeckList][]> {
    const res = await fetch(`${ENGINE_SERVER}/catalog`)
    if (!res.ok) {
        throw new Error(`The engine server cannot be reached : ${res.status}`)
    }
    return res.json()
}

// A game the server refuses to create ( a deck it cannot play... )
export class EngineRefused extends Error {
    constructor(
        public refusal: SpecError | null,
        message: string,
    ) {
        super(message)
    }
}

// How long to wait before sending again a command refused as too many in a second
const RATE_LIMITED_RETRY = 1000

// What the server sends while a command is answered, then the decision or the end
type Waiter = () => void

export class EngineHost {
    private queue: EngineOut[] = []
    private waiting: Waiter[] = []
    // Events told since the last message given to the driver
    private told: string[] = []
    private view: TableView | null = null
    private lastDecision = -1
    private answered = true
    // Told when the pending human decision was taken without its answer ( the server passes it by
    // itself once the opportunities are off ) : `advance` goes on
    onWithdrawn?: (decision: number) => void
    private failure: Error | null = null
    // The last command sent : sent again when the server refuses it as too many
    private sent: string | null = null

    private constructor(
        private game: string,
        private token: string,
        private ws: WebSocket,
    ) {}

    // A game created on the server, the user's seat joined
    static async create(spec: GameSpec): Promise<EngineHost> {
        const res = await fetch(`${ENGINE_SERVER}/games`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(spec),
        })
        if (!res.ok) {
            const text = await res.text()
            let refusal: SpecError | null = null
            try {
                refusal = JSON.parse(text) as SpecError
            } catch {
                // Not a spec refused : the server is full, too many games this hour
            }
            throw new EngineRefused(refusal, `The engine server refused the game : ${text}`)
        }
        const { game, token } = await res.json()
        const ws = new WebSocket(`${ENGINE_SERVER.replace(/^http/, 'ws')}/games/${game}/ws`)
        const host = new EngineHost(game, token, ws)
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
        this.sent = JSON.stringify(command)
        this.ws.send(this.sent)
    }

    private receive(m: Out) {
        switch (m.type) {
            case 'joined':
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
                this.push({ ...m, events: this.take() })
                break
            }
            case 'over':
                this.view = m.view
                this.push({
                    type: 'over',
                    vps: m.vp_halves.map(v => v / 2),
                    events: this.take(),
                    view: m.view,
                })
                break
            case 'error':
                // Too many commands this second : refused, so sent again a moment later
                if (m.error == 'rate_limited') {
                    const sent = this.sent
                    setTimeout(() => sent && this.ws.send(sent), RATE_LIMITED_RETRY)
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
                // The user's pending decision, taken without them ( passed by itself once the
                // opportunities are off ) : no answer to wait for
                if (e.decision == this.lastDecision && !this.answered) {
                    this.answered = true
                    this.onWithdrawn?.(e.decision)
                }
                const choice: OptionView =
                    e.kind == 'decided' ?
                        { ...e.choice, text: e.text ?? e.choice.text ?? '' }
                    :   { index: 0, kind: 'pass', text: 'Pass' }
                this.push({
                    type: 'decided',
                    decision: e.decision,
                    seat: e.seat,
                    window: e.window,
                    choice,
                    events: this.take(),
                    view: this.view as TableView,
                })
                continue
            }
            if (e.text) {
                this.told.push(e.text)
            }
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

    // The next message : a decision for the human, a decision taken by a bot, or the end of the game
    async advance(): Promise<EngineOut> {
        return this.next()
    }

    // Answer the pending human decision
    async answer(decision: number, index: number): Promise<EngineOut> {
        // A decision the server took already ( passed by itself ) : the answer is moot, the game
        // goes on
        if (decision == this.lastDecision && !this.answered) {
            this.send({ type: 'answer', decision, option: index })
        }
        return this.next()
    }

    // Answer the allocation under way at once ( a decision's `allocation` ), in its recipients' order :
    // one decision taken per step the engine asked
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

    // Cast all the votes one way ( a decision's `votes` ) : this one now, the others as their turn
    // comes in this polling ( `advance` takes them )
    async voteAll(decision: number, favor: boolean): Promise<EngineOut> {
        this.send({ type: 'vote_all', decision, favor })
        return this.next()
    }

    // Take back the previous step of the multi-step choice under way ( when a decision says `undo` )
    async undo(): Promise<void> {
        this.send({ type: 'undo', decision: this.lastDecision })
        await this.settled()
    }

    // Whether the user is asked on their opportunities ( on by default ) : off, a wake only on their
    // prey's or predator's actions or one directed at them, an ability usable at any time only where
    // the decision pauses anyway, and a decision left with a pass alone passes by itself
    async setOpportunities(on: boolean): Promise<void> {
        const answered = this.answered
        this.send({ type: 'settings', opportunities: on })
        this.answered = answered
    }

    // The game's record ( the server keeps it two years ), as the export
    async replay(): Promise<string> {
        const res = await fetch(`${ENGINE_SERVER}/games/${this.game}/record`, {
            headers: { authorization: `Bearer ${this.token}` },
        })
        return res.text()
    }
}
