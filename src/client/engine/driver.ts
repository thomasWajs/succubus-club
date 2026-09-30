/**
 * Drives a game played with the rules engine ( GameType.Engine ) : the
 * counterpart of the bot Conductor. The engine decides what is legal and what
 * happens ; each of its messages is projected onto the game state, then either
 * narrated ( a decision taken ) or asked to the user ( a decision to take ).
 */

import { EngineHost } from '@/client/engine/host.ts'
import { Projection } from '@/client/engine/projection.ts'
import { EngineOption, EngineOut } from '@/client/engine/protocol.ts'
import { useEngineStore } from '@/client/store/engine.ts'
import { useHistoryStore } from '@/client/store/history.ts'
import { useGameBusStore } from '@/client/store/bus.ts'
import { getAuthorColorRgba } from '@/shared/colors.ts'
import { Card } from '@/shared/model/Card.ts'
import * as logging from '@/client/logging.ts'
import { AnyGameMutation } from '@/shared/state/gameMutations.ts'
import { Invalid, VALID, Validity } from '@/shared/types/state.ts'
import { matchGesture } from '@/client/engine/gestures.ts'

// Dev : the user's seat is played at random and nothing pauses, to run a whole game
const AUTOPLAY = !!import.meta.env.VITE_ENGINE_AUTOPLAY
// Pause after a bot's decision, to let the user follow what happens
const BOT_DECISION_PAUSE = 450
const BOT_PASS_PAUSE = 120

type Running = {
    host: EngineHost
    projection: Projection
    answer: ((index: number) => void) | null
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
    useEngineStore().$reset()
}

// The user takes the pending decision
export function chooseEngineOption(index: number) {
    running?.answer?.(index)
}

// The user takes back the previous step of the multi-step choice under way
const UNDO = -1
export function undoEngineStep() {
    if (useEngineStore().pending?.undo) {
        running?.answer?.(UNDO)
    }
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
    engine.focus = matches.map(option => option.index)
    return Invalid(`${matches.length} ways to do this : pick one in the panel`)
}

// The cards an option is about, to show them on the table
export function engineOptionCards(option: EngineOption): Card[] {
    if (!running) {
        return []
    }
    const { projection } = running
    const target = option.target
    return [
        projection.card(option.card?.copy) ?? projection.cardInPlay(option.card?.card_id),
        projection.minion(option.minion),
        projection.minion(option.actor),
        target?.kind == 'minion' ? projection.minion(target.minion) : undefined,
        target?.kind == 'card' ? projection.cardInPlay(target.card_id) : undefined,
    ].filter((card): card is Card => card !== undefined)
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

function narrate(current: Running, out: EngineOut) {
    if (out.type != 'decided') {
        return
    }
    const player = current.projection.player(out.seat)
    useHistoryStore().addChatMessage({
        text: `[${out.window}] ${out.choice.text}`,
        timestamp: new Date(),
        authorName: player.name,
        authorColorRgba: getAuthorColorRgba(player.rgbaColor),
    })
    const cards = engineOptionCards(out.choice)
    if (cards.length > 0 && out.choice.kind != 'pass') {
        useGameBusStore().pingCard(cards[0].oid)
    }
}

export async function runEngine(host: EngineHost, projection: Projection) {
    const engine = useEngineStore()
    const current: Running = { host, projection, answer: null, repeat: null }
    running = current

    try {
        while (running === current) {
            const out = await host.advance()
            if (running !== current) {
                return
            }
            project(current, out)

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
            engine.pending = {
                decision: out.decision,
                window: out.window,
                options: out.options,
                undo: out.undo,
            }
            // The rest of a move worth several decisions
            const repeat = current.repeat
            const again =
                repeat ?
                    out.options.find(o => o.kind == repeat.kind && o.card?.copy == repeat.copy)
                :   undefined
            current.repeat =
                repeat && again && repeat.left > 1 ? { ...repeat, left: repeat.left - 1 } : null
            const index = await new Promise<number>(resolve => {
                current.answer = resolve
                if (again) {
                    resolve(again.index)
                }
                if (AUTOPLAY) {
                    sleep(0).then(() => resolve(Math.floor(Math.random() * out.options.length)))
                }
            })
            current.answer = null
            engine.pending = null
            if (running !== current) {
                return
            }
            if (index == UNDO) {
                await host.undo()
                useHistoryStore().addChatMessage({
                    text: `[${out.window}] Takes back the last step`,
                    timestamp: new Date(),
                    authorName: projection.player(out.seat).name,
                    authorColorRgba: getAuthorColorRgba(projection.player(out.seat).rgbaColor),
                })
                continue
            }
            narrate(current, await host.answer(out.decision, index))
        }
    } catch (error) {
        engine.pending = null
        engine.status = `The engine stopped : ${error instanceof Error ? error.message : error}`
        logging.captureException(error)
    }
}
