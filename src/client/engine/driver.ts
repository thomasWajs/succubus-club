/**
 * Drives a game played with the rules engine ( GameType.Engine ) : the
 * counterpart of the bot Conductor. The engine decides what is legal and what
 * happens ; each of its messages is projected onto the game state, then either
 * narrated ( a decision taken ) or asked to the user ( a decision to take ).
 */

import { EngineHost } from '@/client/engine/host.ts'
import { Projection } from '@/client/engine/projection.ts'
import { EngineAllocation, EngineOption, EngineOut, EngineView } from '@/client/engine/protocol.ts'
import { EngineCombat, useEngineStore } from '@/client/store/engine.ts'
import { useHistoryStore } from '@/client/store/history.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { getAuthorColorRgba } from '@/shared/colors.ts'
import { Card } from '@/shared/model/Card.ts'
import * as logging from '@/client/logging.ts'
import { AnyGameMutation } from '@/shared/state/gameMutations.ts'
import { Invalid, VALID, Validity } from '@/shared/types/state.ts'
import { matchGesture, onCardLabel } from '@/client/engine/gestures.ts'
import { autoplayStaging, narrowStaging } from '@/client/engine/interaction.ts'
import { forgetCardNames, learnCardNames } from '@/client/engine/cardNames.ts'

// Dev : the user's seat is played at random and nothing pauses, to run a whole game
const AUTOPLAY = !!import.meta.env.VITE_ENGINE_AUTOPLAY
// Pause after a bot's decision, to let the user follow what happens
const BOT_DECISION_PAUSE = 450
const BOT_PASS_PAUSE = 120

// What the user answers : an option, taking back a step, a whole allocation, or all their votes one way
type Answer = { index: number } | { undo: true } | { amounts: number[] } | { favor: boolean }

type Running = {
    host: EngineHost
    projection: Projection
    answer: ((answer: Answer) => void) | null
    // A move worth several decisions ( influence 3 ) : the option to take again
    repeat: { kind: string; copy: number | null | undefined; left: number } | null
}

let running: Running | null = null
// True while the engine's view is projected : those mutations are the
// engine's, not the user's ( see dispatchMutation ).
let projecting = false

export function isEngineProjecting() {
    return projecting
}

export function stopEngine() {
    running = null
    forgetCardNames()
    useEngineStore().$reset()
}

// The user takes the pending decision
export function chooseEngineOption(index: number) {
    running?.answer?.({ index })
}

// The user takes back the previous step of the multi-step choice under way
export function undoEngineStep() {
    if (useEngineStore().pending?.undo) {
        running?.answer?.({ undo: true })
    }
}

// The user allocates the points under way at once, in the allocation's recipients' order
export function allocateEngine(amounts: number[]) {
    if (useEngineStore().pending?.allocation) {
        running?.answer?.({ amounts })
    }
}

// The user casts all their votes one way : now and as their turn comes in this polling
export function voteAllEngine(favor: boolean) {
    if (useEngineStore().pending?.votes) {
        running?.answer?.({ favor })
    }
}

// Valid amounts at random ( dev autoplay ) : a point to `min_nonzero` recipients, the rest anywhere
function randomAmounts(allocation: EngineAllocation): number[] {
    const { recipients } = allocation
    const room = (amounts: number[], i: number) => amounts[i] < (recipients[i].cap ?? Infinity)
    const amounts = recipients.map(() => 0)
    let left = allocation.points
    while (amounts.filter(n => n > 0).length < allocation.min_nonzero) {
        const i = Math.floor(Math.random() * recipients.length)
        if (amounts[i] == 0 && room(amounts, i)) {
            amounts[i] = 1
            left--
        }
    }
    while (left > 0) {
        const i = Math.floor(Math.random() * recipients.length)
        if (room(amounts, i)) {
            amounts[i]++
            left--
        }
    }
    return amounts
}

// The combat under way, by its minions' names
// `seat` : the user's, deciding
function combatOf(view: EngineView, seat: number): EngineCombat | null {
    if (!view.combat) {
        return null
    }
    const minions = view.seats.flatMap(seat => [...seat.ready, ...seat.torpor])
    const name = (id: number) => minions.find(m => m.minion == id)?.name ?? 'a minion'
    const own = (id: number) =>
        view.seats.some(
            other =>
                other.seat == seat && [...other.ready, ...other.torpor].some(m => m.minion == id),
        )
    const [acting, opposing] = view.combat.minions
    return {
        minions: [name(acting), name(opposing)],
        round: view.combat.round,
        range: view.combat.range,
        sides: (view.combat.sides ?? []).map(side => ({
            name: name(side.minion),
            own: own(side.minion),
            strike: side.strike,
            maneuvers: side.maneuvers,
            presses: side.presses,
        })),
    }
}

// Dev autoplay : an option at random, sometimes the allocation or the votes at once
function autoplay(out: EngineOut & { type: 'decision' }): Answer {
    if (out.allocation && Math.random() < 0.5) {
        return { amounts: randomAmounts(out.allocation) }
    }
    // Taken back now and then : the table must follow the game replayed to the decision before
    if (out.undo && Math.random() < 0.1) {
        return { undo: true }
    }
    if (out.votes && Math.random() < 0.3) {
        return { favor: out.votes.favor > 0 }
    }
    // A card played as the user does on the table, now and then
    const staged = Math.random() < 0.3 ? autoplayStaging(out.options) : null
    if (staged) {
        return { index: staged.index }
    }
    return { index: Math.floor(Math.random() * out.options.length) }
}

/**
 * A move of the user on the table, read as a decision ( see gestures.ts ) :
 * valid when it was taken as one. The move itself is not applied : the
 * engine's answer moves the table.
 */
export function engineGesture(gameMutation: AnyGameMutation): Validity {
    const engine = useEngineStore()
    if (!running || !engine.pending) {
        return Invalid(engine.status ? `Not your decision : ${engine.status}` : 'Not your decision')
    }
    const { pending } = engine
    const matches = matchGesture(running.projection, pending.options, gameMutation)

    if (matches.length == 0) {
        return Invalid(`Not possible now ( ${pending.window} ) : see your options in the panel`)
    }
    // Several options that read the same are the same to the user
    if (matches.length == 1 || matches.every(option => option.text == matches[0].text)) {
        const amount = Math.abs((gameMutation.params.amount as number | undefined) ?? 1)
        const option = matches[0]
        running.repeat =
            amount > 1 ? { kind: option.kind, copy: option.card?.copy, left: amount - 1 } : null
        chooseEngineOption(option.index)
        return VALID
    }
    // Several : the choice goes on as a click on the card would ( the Disciplines, the target… in
    // the central box, the candidates glowing ), not in the panel
    engine.focus = []
    narrowStaging(matches)
    return VALID
}

// The cards an option is about, to show them on the table. `seat` : the seat deciding ( the
// user's pending decision by default ), whose uncontrolled region a slot target is in
export function engineOptionCards(option: EngineOption, seat?: number): Card[] {
    if (!running) {
        return []
    }
    const { projection } = running
    const target = option.target
    const decider = seat ?? useEngineStore().pending?.seat
    return [
        projection.card(option.card?.copy) ?? projection.cardInPlay(option.card?.card_id),
        projection.minion(option.minion),
        projection.minion(option.actor),
        target?.kind == 'minion' ? projection.minion(target.minion) : undefined,
        target?.kind == 'card' ? projection.cardInPlay(target.card_id) : undefined,
        target?.kind == 'uncontrolled' ? projection.uncontrolled(decider, target.slot) : undefined,
    ].filter((card): card is Card => card !== undefined)
}

// The cards alike to this one ( itself included ) : copies of the same card in the same hand, or
// stored on the same card, which the engine offers as one choice ( see Projection.alike )
export function engineAlikeCards(card: Card): Card[] {
    return running ? running.projection.alike(card) : [card]
}

// The pending options answered by a button on a card of the table, and that card ( see onCardLabel )
export function engineCardOptions(): { card: Card; option: EngineOption; label: string }[] {
    const pending = useEngineStore().pending
    if (!running || !pending) {
        return []
    }
    return pending.options.flatMap(option => {
        const label = onCardLabel(option)
        const card = label ? engineOptionCards(option)[0] : undefined
        return label && card ? [{ card, option, label }] : []
    })
}

export async function engineReplay(): Promise<string | null> {
    return running ? running.host.replay() : null
}

function sleep(ms: number) {
    if (AUTOPLAY) {
        // Yield to the event loop without a timer ( timers are throttled in background tabs )
        return new Promise<void>(resolve => {
            const channel = new MessageChannel()
            channel.port1.onmessage = () => resolve()
            channel.port2.postMessage(null)
        })
    }
    return new Promise(resolve => setTimeout(resolve, ms))
}

function project(current: Running, out: EngineOut) {
    projecting = true
    try {
        current.projection.apply(out.view)
        // The cards the log's lines can name
        learnCardNames()
        // The cards played during the action, until it is over
        if (!out.view.action) {
            useEngineStore().played = []
        }
        if (out.type != 'over') {
            current.projection.setImpulse(out.seat)
        }
        if (AUTOPLAY) {
            const problems = current.projection.check(out.view)
            if (problems.length > 0) {
                throw new Error(
                    `decision ${out.view.decision} : ${problems.slice(0, 5).join(' ; ')}`,
                )
            }
        }
    } finally {
        projecting = false
    }
}

// A line of the log ; the same line again from the same author is counted, not repeated
// ( "Transfer 1 pool to … ( ×3 )" )
let lastLine: { authorName: string; text: string; times: number } | null = null

function say(authorName: string, text: string, authorColorRgba?: string) {
    const history = useHistoryStore()
    const last = history.logEntries[history.logEntries.length - 1]
    if (lastLine && last && lastLine.authorName == authorName && lastLine.text == text) {
        lastLine.times++
        history.logEntries.splice(-1, 1, { ...last, text: `${text} ( ×${lastLine.times} )` })
        return
    }
    lastLine = { authorName, text, times: 1 }
    history.addChatMessage({ text, timestamp: new Date(), authorName, authorColorRgba })
}

// What happened since the previous message : an action's or a referendum's end, pool and blood moved,
// cards drawn, combats…
function tell(out: EngineOut) {
    for (const event of out.events ?? []) {
        say('Table', event)
    }
}

// A decision, as the log tells it : its text ; a bare pass with the window it passes
function decisionLine(out: Extract<EngineOut, { type: 'decided' }>): string {
    return out.choice.text == 'Pass' ? `Pass ( ${out.window} )` : out.choice.text
}

function narrate(current: Running, out: EngineOut) {
    tell(out)
    if (out.type != 'decided') {
        return
    }
    const player = current.projection.player(out.seat)
    const text = decisionLine(out)
    say(player.name, text, getAuthorColorRgba(player.rgbaColor))
    // A card played during an action : kept in sight until the action is over
    if (out.choice.kind == 'play' && out.view.action) {
        useEngineStore().played.push({
            decision: out.decision,
            player: player.name,
            text,
            option: out.choice,
        })
    }
    const cards = engineOptionCards(out.choice, out.seat)
    if (cards.length > 0 && out.choice.kind != 'pass') {
        useGameBusStore().pingCard(cards[0].oid)
    }
}

export async function runEngine(host: EngineHost, projection: Projection) {
    const engine = useEngineStore()
    const current: Running = { host, projection, answer: null, repeat: null }
    running = current
    forgetCardNames()

    try {
        while (running === current) {
            const out = await host.advance()
            if (running !== current) {
                return
            }
            project(current, out)
            if (out.type != 'decided') {
                tell(out)
            }

            if (out.type == 'over') {
                engine.result = out.vps
                engine.status = 'Game over'
                return
            }

            if (out.type == 'decided') {
                engine.status = `${projection.player(out.seat).name} : ${out.window}`
                narrate(current, out)
                await sleep(out.choice.kind == 'pass' ? BOT_PASS_PAUSE : BOT_DECISION_PAUSE)
                continue
            }

            engine.status = ''
            engine.focus = []
            engine.staging = null
            engine.pending = {
                decision: out.decision,
                seat: out.seat,
                window: out.window,
                options: out.options,
                prompt: out.prompt,
                undo: out.undo,
                allocation: out.allocation,
                votes: out.votes,
                combat: combatOf(out.view, out.seat),
            }
            // The rest of a move worth several decisions
            const repeat = current.repeat
            const again =
                repeat ?
                    out.options.find(o => o.kind == repeat.kind && o.card?.copy == repeat.copy)
                :   undefined
            current.repeat =
                repeat && again && repeat.left > 1 ? { ...repeat, left: repeat.left - 1 } : null
            const answer = await new Promise<Answer>(resolve => {
                current.answer = resolve
                if (again) {
                    resolve({ index: again.index })
                }
                if (AUTOPLAY) {
                    sleep(0).then(() => resolve(autoplay(out)))
                }
            })
            current.answer = null
            engine.pending = null
            engine.staging = null
            if (running !== current) {
                return
            }
            if ('amounts' in answer) {
                for (const decided of await host.allocate(out.decision, answer.amounts)) {
                    narrate(current, decided)
                }
                continue
            }
            if ('favor' in answer) {
                narrate(current, await host.voteAll(out.decision, answer.favor))
                continue
            }
            if ('undo' in answer) {
                await host.undo()
                // The decision taken back : out of the cards played too
                engine.played = engine.played.filter(p => p.decision < out.decision - 1)
                say(
                    projection.player(out.seat).name,
                    'Takes back their last decision',
                    getAuthorColorRgba(projection.player(out.seat).rgbaColor),
                )
                continue
            }
            narrate(current, await host.answer(out.decision, answer.index))
        }
    } catch (error) {
        engine.pending = null
        engine.status = `The engine stopped : ${error instanceof Error ? error.message : error}`
        logging.captureException(error)
    }
}
