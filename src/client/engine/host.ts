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
    Joined,
    OptionView,
    Out,
    SpecError,
    TableView,
    Window,
} from '@/client/engine/api.ts'
import { DeckList } from '@/shared/types/gateway.ts'

/**
 * One step of the game for the driver : a decision of the user's, a decision taken ( by anyone, the
 * table after it ), or the end ; with the events told since the previous step, and whether an action
 * ended among them.
 */
export type EngineOut =
    | ({ type: 'decision'; events: Event[]; actionEnded: boolean } & Decision)
    | {
          type: 'decided'
          decision: number
          seat: number
          window: Window
          // The option taken ( a pass, when it passed by itself )
          choice: OptionView
          // The event telling it ( `decided`, `auto_passed` )
          event: Event
          events: Event[]
          actionEnded: boolean
          // Taken while an action is under way ( its declaration included )
          duringAction: boolean
          // The table right after this decision : the events told with it, before it, may end an
          // action this view is past ( the next one declared )
          view: TableView
      }
    | { type: 'over'; vps: number[]; events: Event[]; actionEnded: boolean; view: TableView }

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

// The game the server no longer holds ( it ended a while ago, or the server restarted )
export class EngineGone extends Error {
    constructor() {
        super('The engine server ended the game')
    }
}

// The seat joined from another tab ( a duplicated tab shares its seat ) : the game plays there now,
// never joined again from here ; a refresh takes it back
export class EngineTaken extends Error {
    constructor() {
        super('The game was opened in another tab : it plays there now')
    }
}

// The seat of the game under way, kept for the tab : a page refreshed joins it again
const SEAT_STORAGE_KEY = 'engine-seat'
type Seat = { game: string; token: string }

export function savedEngineSeat(): Seat | null {
    try {
        const saved = sessionStorage.getItem(SEAT_STORAGE_KEY)
        return saved ? (JSON.parse(saved) as Seat) : null
    } catch {
        return null
    }
}

function saveSeat(seat: Seat) {
    try {
        sessionStorage.setItem(SEAT_STORAGE_KEY, JSON.stringify(seat))
    } catch {
        // No storage ( a private window ) : a refresh loses the game
    }
}

// Only this game's : another may have started since
function forgetSeat(game: string) {
    try {
        if (savedEngineSeat()?.game == game) {
            sessionStorage.removeItem(SEAT_STORAGE_KEY)
        }
    } catch {
        // No storage
    }
}

// How long to wait before sending again a command refused as too many in a second
const RATE_LIMITED_RETRY = 1000

// The waits before each try to join again a game whose connection dropped ( a sleep, a network
// change ) : the game fails after the last, a minute on ( the server keeps the seat longer )
const REJOIN_DELAYS = [500, 1000, 2000, 4000, 8000, 15000, 30000]

// What the server sends while a command is answered, then the decision or the end
type Waiter = () => void

// How long a report waits for the server's `noted` : past it, lost ( the connection dropped, too
// many commands that second ), the user sends it again
const FEEDBACK_TIMEOUT = 10000

// A report sent, by its command's id : told when the server notes it, or refuses it
type Report = { resolve: (decision: number) => void; reject: (error: Error) => void }

export class EngineHost {
    private queue: EngineOut[] = []
    private waiting: Waiter[] = []
    // Events told since the last message given to the driver
    private told: Event[] = []
    // An action ended among the events told since the last message given to the driver
    private actionEnded = false
    // An action under way, from its `action_starts` to its `action_ends` ( a view may be past them ) ;
    // from the view where no events tell it : the game joined, a position an undo went back to
    private acting = false
    private undone = false
    private view: TableView | null = null
    private lastDecision = -1
    private answered = true
    // Told when the pending human decision was taken without its answer ( the server passes it by
    // itself once the opportunities are off ) : `advance` goes on
    onWithdrawn?: (decision: number) => void
    private failure: Error | null = null
    // The last command sent : sent again when the server refuses it as too many, or after joining
    // again while the server has not answered it ( the dropped connection may have lost it )
    private sent: string | null = null
    // The last message's number : a game joined again resumes after it
    private seq = 0
    private over = false
    // The last command sent again after joining again : refused as stale when the server had it
    private resent = false
    // Told when the connection drops ( true ) and when the game is joined again ( false )
    onConnection?: (lost: boolean) => void
    // The seat taken : its game's seats, and the table as it stands
    private joined: Joined | null = null
    // A failure that says nothing of the game ( the server out of reach ) : its seat kept
    private unreachable = false
    // Joined again from a refreshed page ( resume ), not yet seated
    private resuming = false
    // The reports sent and not yet noted, by their command's id ( beside the one command in flight )
    private reports = new Map<number, Report>()
    private reportId = 0

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
        const ws = await EngineHost.open(game)
        const host = new EngineHost(game, token, ws)
        host.join(ws)
        saveSeat({ game, token })
        return host
    }

    // The tab's game joined again ( the page refreshed ) : the table as it stands, the pending decision
    // next ; forgotten unless the server was out of reach ( a later refresh tries again )
    static async resume(seat: Seat): Promise<{ host: EngineHost; joined: Joined }> {
        let ws: WebSocket
        try {
            ws = await EngineHost.open(seat.game)
        } catch (e) {
            if (await EngineHost.gone(seat.game)) {
                forgetSeat(seat.game)
                throw new EngineGone()
            }
            throw e
        }
        const host = new EngineHost(seat.game, seat.token, ws)
        host.resuming = true
        host.join(ws)
        while (!host.joined) {
            if (host.failure) {
                host.over = true
                host.ws.close()
                if (!host.unreachable && !(host.failure instanceof EngineTaken)) {
                    forgetSeat(seat.game)
                }
                throw host.failure
            }
            await new Promise<void>(resolve => host.waiting.push(resolve))
        }
        return { host, joined: host.joined }
    }

    // The game left ( another started, the table reset ) : its connection closed, never joined again
    close() {
        this.over = true
        this.ws.close()
        forgetSeat(this.game)
    }

    private static async open(game: string): Promise<WebSocket> {
        const ws = new WebSocket(`${ENGINE_SERVER.replace(/^http/, 'ws')}/games/${game}/ws`)
        await new Promise<void>((resolve, reject) => {
            ws.onopen = () => resolve()
            ws.onerror = () => reject(new Error('The engine server cannot be reached'))
        })
        return ws
    }

    // The seat taken on this connection : from the start, or after the last message received
    private join(ws: WebSocket) {
        this.ws = ws
        ws.onmessage = e => this.receive(JSON.parse(e.data) as Out)
        ws.onclose = () => void this.rejoin()
        const after = this.seq > 0 ? { after: this.seq } : {}
        ws.send(JSON.stringify({ type: 'join', token: this.token, ...after }))
    }

    // A dropped connection : the game joined again, the server sending again what followed the last
    // message received, and the last command sent again ( see resent )
    private async rejoin() {
        if (this.over || this.failure) {
            return
        }
        // A resume dropped before the seat was taken : the menu tells it at once, no table to wait on
        // ( a new game's first join is retried as any other )
        if (this.resuming && !this.joined) {
            this.unreachable = true
            this.fail(new Error('The engine server cannot be reached'))
            return
        }
        this.onConnection?.(true)
        for (const delay of REJOIN_DELAYS) {
            await new Promise(resolve => setTimeout(resolve, delay))
            // The game left meanwhile ( close )
            if (this.over) {
                return
            }
            let ws: WebSocket
            try {
                ws = await EngineHost.open(this.game)
            } catch {
                // The game gone ( the server restarted ) : no use trying again
                if (await EngineHost.gone(this.game)) {
                    forgetSeat(this.game)
                    this.fail(new EngineGone())
                    return
                }
                continue
            }
            if (this.over) {
                ws.close()
                return
            }
            this.join(ws)
            if (this.sent) {
                this.resent = true
                ws.send(this.sent)
            }
            this.onConnection?.(false)
            return
        }
        this.fail(new Error('The engine server cannot be reached'))
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

    // Whether the server answers that the game is not there any more ( false while it is out of reach )
    private static async gone(game: string): Promise<boolean> {
        try {
            const res = await fetch(`${ENGINE_SERVER}/games/${game}/ws`)
            return res.status == 404
        } catch {
            return false
        }
    }

    private send(command: object) {
        this.answered = true
        this.resent = false
        this.sent = JSON.stringify(command)
        if (this.ws.readyState == WebSocket.OPEN) {
            this.ws.send(this.sent)
        }
    }

    private receive(m: Out) {
        // Numbered : an answer to the last command, if any ( the server answers each it takes ; a
        // refusal as too many is unnumbered ). One command in flight at a time : a reply to an
        // earlier one ( a settings change just before an answer ) clears the later, which a drop
        // then would not send again
        // A report's answer ( see feedback ) : the command in flight stays, a refusal fails no game
        const reported = this.report(m)
        if (m.seq > 0) {
            this.seq = m.seq
            if (!reported) {
                this.sent = null
            }
        }
        if (reported) {
            return
        }
        switch (m.type) {
            case 'joined':
                this.view = m.view
                this.acting = !!m.view.action
                this.joined = m
                this.wake()
                break
            case 'events': {
                if (m.view) {
                    this.view = m.view
                }
                this.events(m.events)
                if (m.view && this.undone) {
                    this.acting = !!m.view.action
                    this.undone = false
                }
                break
            }
            case 'decision': {
                this.view = m.view
                if (this.undone) {
                    this.acting = !!m.view.action
                    this.undone = false
                }
                // Sent again ( a settings change, the game joined again ) : the one the user is
                // answering stays, the one answered is
                if (m.decision == this.lastDecision && (!this.answered || this.resent)) {
                    break
                }
                this.queue = this.queue.filter(
                    o => o.type != 'decision' || o.decision != m.decision,
                )
                this.lastDecision = m.decision
                this.push({ ...m, ...this.take() })
                break
            }
            case 'over':
                this.over = true
                forgetSeat(this.game)
                this.view = m.view
                this.push({
                    type: 'over',
                    vps: m.vp_halves.map(v => v / 2),
                    ...this.take(),
                    view: m.view,
                })
                break
            case 'error':
                // Too many commands this second : refused, so sent again a moment later, while still
                // unanswered ( the refused one may have been a report : unnumbered, it names none )
                if (m.error == 'rate_limited') {
                    const sent = this.sent
                    setTimeout(() => {
                        if (sent && this.sent == sent) {
                            this.sent = sent
                            if (this.ws.readyState == WebSocket.OPEN) {
                                this.ws.send(sent)
                            }
                        }
                    }, RATE_LIMITED_RETRY)
                    break
                }
                // The command sent again after joining again, which the server had taken already
                if (this.resent && m.error == 'stale') {
                    this.resent = false
                    break
                }
                // The seat joined from another tab : the server closes this connection next
                if (m.error == 'seat_taken') {
                    this.fail(new EngineTaken())
                    break
                }
                // Joined again as the game ended
                if (!this.joined && m.error == 'over') {
                    this.fail(new EngineGone())
                    break
                }
                this.fail(new Error(`The engine server refused : ${m.error}`))
                break
        }
    }

    // A report's answer ( `noted`, or an error ) told to its sender, if it still waits : whether it was
    // one. Only `feedback` carries an id, so an answer naming one is a report's, even given up
    private report(m: Out): boolean {
        if (m.reply_to == null) {
            return false
        }
        const report = this.reports.get(m.reply_to)
        this.reports.delete(m.reply_to)
        if (m.type == 'noted') {
            report?.resolve(m.decision)
        } else if (m.type == 'error') {
            report?.reject(new Error(`The engine server refused the report : ${m.error}`))
        }
        return true
    }

    private take(): { events: Event[]; actionEnded: boolean } {
        const taken = { events: this.told, actionEnded: this.actionEnded }
        this.told = []
        this.actionEnded = false
        return taken
    }

    // One step's events : those before its decision are told with it, those after with the next
    private events(events: Event[]) {
        for (const e of events) {
            if (e.kind == 'undone') {
                this.queue = []
                // Told on : the log takes back its lines
                this.told = [e]
                this.actionEnded = false
                this.undone = true
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
                // An action declared ( an action card played among its cards ) : announced next
                const declares =
                    choice.kind == 'take_action' ||
                    (choice.effects ?? []).some(
                        effect => effect.kind == 'action' && !!effect.action,
                    )
                this.push({
                    type: 'decided',
                    decision: e.decision,
                    seat: e.seat,
                    window: e.window,
                    choice,
                    event: e,
                    ...this.take(),
                    duringAction: this.acting || declares,
                    view: this.view as TableView,
                })
                continue
            }
            if (e.kind == 'action_starts') {
                this.acting = true
            }
            if (e.kind == 'action_ends') {
                this.acting = false
                this.actionEnded = true
            }
            this.told.push(e)
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

    // Take back the user's last decision ( when a decision says `undo` ) : the bots' since with it
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

    // A problem or a remark sent to the engine's authors, kept in the game's record at the pending
    // decision ( else the last one ), also once the game is over : that decision, once noted. Sent
    // beside the command in flight, never sent again : a report lost fails, for the user to send again
    feedback(text: string): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            if (this.ws.readyState != WebSocket.OPEN) {
                reject(new Error('The engine server cannot be reached'))
                return
            }
            const id = ++this.reportId
            const timeout = setTimeout(() => {
                this.reports.delete(id)
                reject(new Error('The engine server did not answer'))
            }, FEEDBACK_TIMEOUT)
            this.reports.set(id, {
                resolve: decision => {
                    clearTimeout(timeout)
                    resolve(decision)
                },
                reject: error => {
                    clearTimeout(timeout)
                    reject(error)
                },
            })
            this.ws.send(JSON.stringify({ id, type: 'feedback', text }))
        })
    }

    // The game's record ( the server keeps it two years ), as the export
    async replay(): Promise<string> {
        const res = await fetch(`${ENGINE_SERVER}/games/${this.game}/record`, {
            headers: { authorization: `Bearer ${this.token}` },
        })
        return res.text()
    }
}
